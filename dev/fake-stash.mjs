// A fake Stash for trying phstash without one: a few synthetic scenes, a
// generated test-pattern video, generated funscripts and screenshots, and
// just enough of Stash's GraphQL API (the operations phstash sends, by name).
//
//   node dev/fake-stash.mjs [--port 9998] [--api-key KEY] [--version v0.32.0] [--scenes 6]
//
// With --api-key it behaves like a Stash with a password: GraphQL without the
// key (or with a wrong one) is 401, and a screenshot without it redirects to
// the login page. It logs every request, and warns loudly if a key ever
// arrives in a URL. The video needs ffmpeg on the PATH (made once, in
// dev/media/); everything else is made here.

import { execFileSync } from 'node:child_process'
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import http from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

const here = dirname(fileURLToPath(import.meta.url))
const arg = (name, d) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : d
}
const PORT = Number(arg('port', 9998))
const API_KEY = arg('api-key', '')
const VERSION = arg('version', 'v0.32.0')
const SCENE_COUNT = Number(arg('scenes', 6))
const VIDEO_S = 20

// ─── Media ───────────────────────────────────────────────────────────────────
const mediaDir = join(here, 'media')
const videoPath = join(mediaDir, 'pattern.mp4')
if (!existsSync(videoPath)) {
  mkdirSync(mediaDir, { recursive: true })
  console.log('making the test video with ffmpeg...')
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `testsrc2=size=640x360:rate=30:duration=${VIDEO_S}`, '-f', 'lavfi', '-i', `sine=frequency=440:duration=${VIDEO_S}`, '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-crf', '30', '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', videoPath])
}

// Stash converts a file a browser can't play to HLS (/scene/{id}/stream.m3u8, segments at
// /scene/{id}/stream.m3u8/{n}.ts): the same video cut into segments stands in for that.
const hlsDir = join(mediaDir, 'hls')
if (!existsSync(join(hlsDir, 'index.m3u8'))) {
  mkdirSync(hlsDir, { recursive: true })
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', videoPath, '-c', 'copy', '-f', 'hls', '-hls_time', '2', '-hls_playlist_type', 'vod', '-hls_segment_filename', join(hlsDir, '%d.ts'), join(hlsDir, 'index.m3u8')])
}

// Stash answers a scene with no cover with its own play icon, an SVG.
const NO_COVER = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path d="M73 39c-14.8-9.1-33.4-9.4-48.5-.9S0 62.6 0 80V432c0 17.4 9.4 33.4 24.5 41.9s33.7 8.1 48.5-.9L361 297c14.3-8.7 23-24.2 23-41s-8.7-32.2-23-41L73 39z"/></svg>'

/** A 320×180 PNG: a diagonal gradient in the scene's hue with a few bars, made by hand. */
function screenshot(seed) {
  const w = 320
  const h = 180
  const hue = (seed * 67) % 360
  const rgb = (hh, s, l) => {
    const k = n => (n + hh / 30) % 12
    const a = s * Math.min(l, 1 - l)
    const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))
    return [f(0), f(8), f(4)].map(x => Math.round(x * 255))
  }
  const raw = Buffer.alloc((w * 3 + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0
    for (let x = 0; x < w; x++) {
      const t = (x / w + y / h) / 2
      let [r, g, b] = rgb(hue + t * 40, 0.55, 0.28 + t * 0.3)
      // Script-like bars along the bottom.
      const bar = Math.abs(Math.sin((x + seed * 13) / 9)) * 40
      if (y > h - 10 - bar && y < h - 8 && x % 12 < 8)
        [r, g, b] = rgb(hue + 180, 0.7, 0.75)
      const o = y * (w * 3 + 1) + 1 + x * 3
      raw[o] = r
      raw[o + 1] = g
      raw[o + 2] = b
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(td))
    return Buffer.concat([len, td, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
function crc32(buf) {
  let c = ~0
  for (const b of buf) {
    c ^= b
    for (let k = 0; k < 8; k++)
      c = (c >>> 1) ^ (0xEDB88320 & -(c & 1))
  }
  return (~c) >>> 0
}

/** Strokes at a tempo of its own, for the length of the video. */
function funscript(seed) {
  const period = 300 + (seed % 4) * 150
  const actions = []
  for (let at = 0, up = false; at <= VIDEO_S * 1000; at += period / 2, up = !up)
    actions.push({ at: Math.round(at), pos: up ? 90 - (seed % 3) * 10 : 10 })
  return { version: '1.0', inverted: false, range: 100, actions }
}

// ─── Data ────────────────────────────────────────────────────────────────────
const TAGS = [
  { id: '1', name: 'Test pattern' },
  { id: '2', name: 'Slow' },
  { id: '3', name: 'Fast' },
  { id: '4', name: 'Fast > Very fast', parent: '3' },
  { id: '5', name: 'No script' },
]
const PERFORMERS = ['Ava Synth', 'Bo Pixel', 'Cy Raster']
const TITLES = ['Colour bars at dawn', 'Gradient drift', 'The 440 Hz session', 'Pixel rain', 'Untitled pattern', 'Calibration loop', 'Signal and noise', 'Night test card']
const created = Date.parse('2026-10-01T12:00:00Z')

const scenes = Array.from({ length: SCENE_COUNT }, (_, i) => {
  const n = i + 1
  const interactive = n % 5 !== 0
  const tagIds = ['1', interactive ? (n % 2 ? '2' : '3') : '5', ...(n === 4 ? ['4'] : [])]
  return {
    id: String(n),
    // Stash gives an untitled scene an empty title, not null.
    title: n === 5 ? '' : TITLES[i % TITLES.length],
    date: '2026-10-0' + ((n % 9) + 1),
    interactive,
    interactive_speed: interactive ? 120 + n * 20 : null,
    o_counter: 0,
    play_count: 0,
    rating100: n % 3 ? 80 : null,
    updated_at: new Date(created + n * 3600_000).toISOString(),
    // Scene 3 claims to be a WMV, so phstash asks for Stash's conversion (HLS).
    files: [n === 3 ? { basename: 'pattern_03.wmv', duration: VIDEO_S, format: 'wmv', video_codec: 'wmv2' } : { basename: `pattern_${String(n).padStart(2, '0')}.mp4`, duration: VIDEO_S, format: 'mp4', video_codec: 'h264' }],
    scene_markers: interactive
      ? [
          { title: 'Warm-up', seconds: 0, end_seconds: 6, primary_tag: { name: 'Slow' } },
          { title: '', seconds: 7.5, end_seconds: 14, primary_tag: { name: 'Fast' } },
          { title: 'Finish', seconds: 15, end_seconds: null, primary_tag: { name: 'Test pattern' } },
        ]
      : [],
    tags: tagIds.map(id => ({ name: TAGS.find(t => t.id === id).name })),
    tagIds,
    performers: [{ name: PERFORMERS[i % PERFORMERS.length] }, ...(n % 2 ? [] : [{ name: PERFORMERS[(i + 1) % PERFORMERS.length] }])],
    studio: n % 3 ? { name: 'Test Card Studio' } : null,
  }
})

const SAVED = [
  { id: '1', mode: 'SCENES', name: 'Fast ones', find_filter: { q: null }, object_filter: { tags: { modifier: 'INCLUDES', value: { items: [{ id: '3', label: 'Fast' }], excluded: [], depth: -1 } } } },
  { id: '2', mode: 'SCENES', name: 'Search: pixel', find_filter: { q: 'pixel' }, object_filter: {} },
  // As Stash 0.32's UI saves a performer criterion: { items, excluded }, no depth.
  { id: '4', mode: 'SCENES', name: 'Ava Synth', find_filter: { q: '', sort: 'date', direction: 'ASC', per_page: 40 }, object_filter: { performers: { modifier: 'INCLUDES', value: { excluded: [], items: [{ id: '1', label: 'Ava Synth' }] } } } },
  { id: '3', mode: 'PERFORMERS', name: 'Favourite performers', find_filter: null, object_filter: { filter_favorites: { modifier: 'EQUALS', value: 'true' } } },
]

// ─── GraphQL, by operation name ──────────────────────────────────────────────
const verParts = (/(\d+)\.(\d+)/.exec(VERSION) ?? [0, 0, 99]).slice(1).map(Number)
const knowsMarkerEnd = verParts[0] > 0 || verParts[1] >= 28

/** Tags with their sub-tags, for depth -1. */
function withChildren(ids) {
  const out = new Set(ids)
  let grew = true
  while (grew) {
    grew = false
    for (const t of TAGS) {
      if (t.parent && out.has(t.parent) && !out.has(t.id)) {
        out.add(t.id)
        grew = true
      }
    }
  }
  return out
}

function matches(s, f = {}, q) {
  if (f.interactive !== undefined && s.interactive !== f.interactive)
    return false
  if (f.organized !== undefined && f.organized)
    return false
  if (f.tags) {
    const want = f.tags.depth === -1 ? withChildren(f.tags.value) : new Set(f.tags.value)
    const has = s.tagIds.some(id => want.has(id))
    if (f.tags.modifier === 'INCLUDES' && !has)
      return false
    if (f.tags.modifier === 'EXCLUDES' && has)
      return false
    if ((f.tags.excludes ?? []).some(id => s.tagIds.includes(id)))
      return false
  }
  if (f.performers && !s.performers.some(p => f.performers.value.includes(String(PERFORMERS.indexOf(p.name) + 1))))
    return false
  if (q && !(s.title || s.files[0].basename).toLowerCase().includes(q.toLowerCase()))
    return false
  return true
}

function graphql(body) {
  const op = body.operationName
  const v = body.variables ?? {}
  switch (op) {
    case 'PhstashVersion':
      return { data: { version: { version: VERSION } } }
    case 'PhstashScenes':
    case 'PhstashCount': {
      if (!knowsMarkerEnd && /end_seconds/.test(body.query))
        return { status: 400, body: { errors: [{ message: 'Cannot query field "end_seconds" on type "SceneMarker".', extensions: { code: 'GRAPHQL_VALIDATION_FAILED' } }], data: null } }
      // Stash refuses a depth on performers (MultiCriterionInput), as a real 0.32 did.
      if (v.scene_filter?.performers && 'depth' in v.scene_filter.performers)
        return { status: 400, body: { errors: [{ message: 'unknown field', path: ['variable', 'scene_filter', 'performers', 'depth'], extensions: { code: 'GRAPHQL_VALIDATION_FAILED' } }], data: null } }
      const filter = v.filter ?? {}
      const list = scenes.filter(s => matches(s, v.scene_filter, filter.q)).sort((a, b) => Number(a.id) - Number(b.id))
      const per = filter.per_page === -1 ? list.length : (filter.per_page ?? 25)
      const page = filter.page ?? 1
      const pageList = list.slice((page - 1) * per, page * per).map(({ tagIds, ...s }) => ({
        ...s,
        scene_markers: s.scene_markers.map(m => knowsMarkerEnd ? m : (({ end_seconds, ...rest }) => rest)(m)),
      }))
      return { data: { findScenes: op === 'PhstashCount' ? { count: list.length } : { count: list.length, scenes: pageList } } }
    }
    case 'PhstashTags':
      return { data: { findTags: { tags: TAGS.map(({ id, name }) => ({ id, name })) } } }
    case 'PhstashSavedFilters':
      return { data: { findSavedFilters: SAVED.filter(f => f.mode === 'SCENES').map(({ id, name }) => ({ id, name })) } }
    case 'PhstashSavedFilter':
      return { data: { findSavedFilter: SAVED.find(f => f.id === String(v.id)) ?? null } }
    case 'PhstashAddO':
    case 'PhstashAddPlay': {
      const s = scenes.find(x => x.id === String(v.id))
      if (!s)
        return { data: null, errors: [{ message: `scene ${v.id} not found` }] }
      const field = op === 'PhstashAddO' ? 'o_counter' : 'play_count'
      s[field]++
      console.log(`  → ${field} of scene ${s.id} is now ${s[field]}`)
      return { data: { [op === 'PhstashAddO' ? 'sceneAddO' : 'sceneAddPlay']: { count: s[field] } } }
    }
    default:
      return { data: null, errors: [{ message: `fake-stash doesn't know the operation ${op ?? '(unnamed)'}` }] }
  }
}

// ─── HTTP ────────────────────────────────────────────────────────────────────
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, HEAD, OPTIONS', 'Access-Control-Allow-Headers': '*', 'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges' }

function send(res, status, body, headers = {}) {
  const buf = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)
  res.writeHead(status, { ...CORS, ...(typeof body === 'object' && !Buffer.isBuffer(body) ? { 'Content-Type': 'application/json' } : {}), ...headers })
  res.end(buf)
}

function serveFile(req, res, path, type) {
  const size = statSync(path).size
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? '')
  let start = 0
  let end = size - 1
  if (m) {
    start = m[1] ? Number(m[1]) : size - Number(m[2])
    end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1
  }
  res.writeHead(m ? 206 : 200, { ...CORS, 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, ...(m ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}) })
  if (req.method === 'HEAD')
    return res.end()
  createReadStream(path, { start, end }).pipe(res)
}

http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)
  const headerKey = req.headers.apikey
  const queryKey = url.searchParams.get('apikey')
  console.log(`${new Date().toISOString().slice(11, 19)} ${req.method} ${url.pathname}${url.search}${headerKey ? '  [ApiKey header]' : ''}`)
  if (queryKey)
    console.log('  !!! WARNING: an API key arrived in a URL')
  if (req.method === 'OPTIONS')
    return send(res, 204, '')

  // Auth, as Stash does it (internal/api/authentication.go).
  if (API_KEY) {
    const key = headerKey ?? queryKey
    if (key && key !== API_KEY)
      return send(res, 401, '')
    if (!key && url.pathname !== '/login') {
      if (url.pathname === '/graphql')
        return send(res, 401, '')
      res.writeHead(302, { ...CORS, Location: `/login?returnURL=${encodeURIComponent(url.pathname)}` })
      return res.end()
    }
  }

  if (url.pathname === '/graphql' && req.method === 'POST') {
    let raw = ''
    req.on('data', c => (raw += c))
    req.on('end', () => {
      let body
      try {
        body = JSON.parse(raw)
      }
      catch {
        return send(res, 400, { errors: [{ message: 'bad JSON' }] })
      }
      console.log(`  op ${body.operationName}`, body.variables?.filter ? JSON.stringify(body.variables.filter) : '', body.variables?.scene_filter ? JSON.stringify(body.variables.scene_filter) : '')
      const out = graphql(body)
      if (out.status)
        return send(res, out.status, out.body)
      send(res, 200, out)
    })
    return
  }

  let m = /^\/scene\/(\d+)\/(stream|stream\.mp4|stream\.m3u8|stream\.m3u8\/(\d+)\.ts|funscript|screenshot)$/.exec(url.pathname)
  if (m) {
    const s = scenes.find(x => x.id === m[1])
    if (!s)
      return send(res, 404, 'not found')
    if (m[2] === 'stream' || m[2] === 'stream.mp4')
      return serveFile(req, res, videoPath, 'video/mp4')
    if (m[2] === 'stream.m3u8') {
      // Segment addresses from the root, as Stash writes them (no key in them).
      const list = readFileSync(join(hlsDir, 'index.m3u8'), 'utf8').replace(/^(\d+)\.ts$/gm, `/scene/${s.id}/stream.m3u8/$1.ts`)
      return send(res, 200, list, { 'Content-Type': 'application/vnd.apple.mpegurl' })
    }
    if (m[3] !== undefined)
      return existsSync(join(hlsDir, `${m[3]}.ts`)) ? serveFile(req, res, join(hlsDir, `${m[3]}.ts`), 'video/MP2T') : send(res, 404, 'no segment')
    if (m[2] === 'funscript')
      return s.interactive ? send(res, 200, funscript(Number(s.id))) : send(res, 404, 'no funscript')
    if (Number(s.id) % 6 === 0)
      return send(res, 200, NO_COVER, { 'Content-Type': 'image/svg+xml' })
    return send(res, 200, screenshot(Number(s.id)), { 'Content-Type': 'image/png', 'Cache-Control': 'no-cache' })
  }
  m = /^\/scenes\/(\d+)$/.exec(url.pathname)
  if (m)
    return send(res, 200, `<!doctype html><title>Scene ${m[1]} - fake Stash</title><h1>Fake Stash: scene ${m[1]}</h1>`, { 'Content-Type': 'text/html' })
  if (url.pathname === '/login')
    return send(res, 200, '<!doctype html><title>Login</title><h1>Fake Stash login</h1>', { 'Content-Type': 'text/html' })
  if (url.pathname === '/')
    return send(res, 200, `<!doctype html><title>Fake Stash</title><h1>Fake Stash ${VERSION}</h1><p>${scenes.length} scenes${API_KEY ? ', with a password' : ''}.</p>`, { 'Content-Type': 'text/html' })
  send(res, 404, '404 page not found')
}).listen(PORT, '127.0.0.1', () => {
  console.log(`fake Stash ${VERSION} on http://127.0.0.1:${PORT}: ${scenes.length} scenes (${scenes.filter(s => s.interactive).length} with a script)${API_KEY ? `, API key required` : ''}`)
})
