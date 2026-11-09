import type { StashScene } from '../src/graphql.ts'
import type { FetchFn } from '../src/stash.ts'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { featuresOf } from '../src/graphql.ts'
import { checkVersion, createClient, fetchAllScenes, normaliseServer, resolveSelection, StashError } from '../src/stash.ts'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

/** A fetch that answers with `fn`, and keeps what it was asked. */
function fake(fn: (body: any, init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string, body: any, headers: Record<string, string> }[] = []
  const f: FetchFn = async (url, init = {}) => {
    const body = JSON.parse(String(init.body ?? '{}'))
    calls.push({ url, body, headers: init.headers as Record<string, string> })
    return fn(body, init)
  }
  return { f, calls }
}

async function rejectsKind(p: Promise<unknown>, kind: string, re?: RegExp) {
  await assert.rejects(p, (err: unknown) => {
    assert.ok(err instanceof StashError, String(err))
    assert.equal(err.kind, kind)
    if (re)
      assert.match(err.message, re)
    return true
  })
}

describe('the address', () => {
  it('is made a base URL', () => {
    assert.equal(normaliseServer('localhost:9999'), 'http://localhost:9999')
    assert.equal(normaliseServer(' https://stash.example.com/stash/ '), 'https://stash.example.com/stash')
    assert.equal(normaliseServer('http://10.0.0.5:9999/?x=1#y'), 'http://10.0.0.5:9999')
  })

  it('says what\'s wrong with one that isn\'t', () => {
    assert.throws(() => normaliseServer(''), /address/)
    assert.throws(() => normaliseServer('ftp://x'), /http:\/\//)
    assert.throws(() => normaliseServer('http://'), /isn't an address/)
  })
})

describe('talking to Stash', () => {
  it('posts GraphQL with the key in the ApiKey header, not the URL', async () => {
    const { f, calls } = fake(() => json({ data: { version: { version: 'v0.32.0' } } }))
    const c = createClient({ server: 'http://localhost:9999', apiKey: ' k3y ', fetch: f })
    assert.deepEqual(await checkVersion(c), [0, 32, 0])
    assert.equal(calls[0].url, 'http://localhost:9999/graphql')
    assert.equal(calls[0].headers.ApiKey, 'k3y')
    assert.equal(calls[0].body.operationName, 'PhstashVersion')
    assert.ok(!calls[0].url.includes('k3y'))
  })

  it('sends no key header without a key', async () => {
    const { f, calls } = fake(() => json({ data: { version: { version: null } } }))
    assert.equal(await checkVersion(createClient({ server: 'localhost:9999', fetch: f })), null)
    assert.equal(calls[0].headers.ApiKey, undefined)
  })

  it('says when nothing answers', async () => {
    const f: FetchFn = async () => {
      throw new TypeError('Failed to fetch')
    }
    await rejectsKind(checkVersion(createClient({ server: 'localhost:9999', fetch: f })), 'unreachable', /Can't reach Stash at http:\/\/localhost:9999\. Is it running/)
  })

  it('says when it takes too long', async () => {
    const f: FetchFn = (_url, init) => new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))
    await rejectsKind(checkVersion(createClient({ server: 'localhost:9999', fetch: f, timeoutMs: 30 })), 'timeout', /didn't answer/)
  })

  it('tells a missing key from a wrong one', async () => {
    const { f } = fake(() => new Response('', { status: 401 }))
    await rejectsKind(checkVersion(createClient({ server: 'localhost:9999', fetch: f })), 'needs-key', /has a password/)
    await rejectsKind(checkVersion(createClient({ server: 'localhost:9999', apiKey: 'nope', fetch: f })), 'bad-key', /turned down the API key/)
  })

  it('explains Stash turning away a public address', async () => {
    const { f } = fake(() => json({ error: 'Access denied: Stash cannot be accessed from public IPs when authentication is not configured' }, 403))
    await rejectsKind(checkVersion(createClient({ server: 'stash.example.com', fetch: f })), 'forbidden', /outside your network/)
  })

  it('says when the address is something else', async () => {
    const html = fake(() => new Response('<html>router login</html>', { status: 200, headers: { 'Content-Type': 'text/html' } }))
    await rejectsKind(checkVersion(createClient({ server: 'localhost:80', fetch: html.f })), 'not-stash', /isn't Stash/)
    const missing = fake(() => new Response('404 page not found', { status: 404 }))
    await rejectsKind(checkVersion(createClient({ server: 'localhost:80', fetch: missing.f })), 'not-stash', /no GraphQL API/)
  })

  it('calls an old Stash old, by its version or by a field it doesn\'t know', async () => {
    const v = fake(() => json({ data: { version: { version: 'v0.24.3' } } }))
    await rejectsKind(checkVersion(createClient({ server: 'localhost:9999', fetch: v.f })), 'old', /v0\.24\.3; phstash needs v0\.25\.0/)
    const field = fake(() => json({ errors: [{ message: 'Cannot query field "end_seconds" on type "SceneMarker".' }], data: null }, 422))
    await rejectsKind(checkVersion(createClient({ server: 'localhost:9999', fetch: field.f })), 'old', /too old/)
  })

  it('reads a 400 with the errors in the body, as Stash 0.29+ answers, and says where', async () => {
    // As a real Stash 0.32 answered a performer criterion with a depth.
    const { f } = fake(() => new Response(JSON.stringify({ errors: [{ message: 'unknown field', path: ['variable', 'scene_filter', 'performers', 'depth'], extensions: { code: 'GRAPHQL_VALIDATION_FAILED' } }], data: null }), { status: 400, headers: { 'Content-Type': 'application/graphql-response+json' } }))
    await rejectsKind(checkVersion(createClient({ server: 'localhost:9999', fetch: f })), 'query', /unknown field \(at performers\.depth\)/)
    const old = fake(() => new Response(JSON.stringify({ errors: [{ message: 'Cannot query field "end_seconds" on type "SceneMarker".', locations: [{ line: 1, column: 3 }] }], data: null }), { status: 400 }))
    await rejectsKind(checkVersion(createClient({ server: 'localhost:9999', fetch: old.f })), 'old')
  })

  it('passes on Stash\'s other errors, and server trouble', async () => {
    const q = fake(() => json({ errors: [{ message: 'invalid tag id' }], data: null }))
    await rejectsKind(checkVersion(createClient({ server: 'localhost:9999', fetch: q.f })), 'query', /invalid tag id/)
    const s = fake(() => new Response('database is locked', { status: 500 }))
    const err = await checkVersion(createClient({ server: 'localhost:9999', fetch: s.f })).catch(e => e)
    assert.equal(err.kind, 'server')
    assert.equal(err.offline, true)
    assert.match(err.message, /database is locked/)
  })
})

describe('saved filters', () => {
  it('fetches the one picked and refuses one that is gone or not for scenes', async () => {
    const { f } = fake(b => json({ data: { findSavedFilter: b.variables.id === '1' ? { id: '1', mode: 'SCENES', object_filter: {} } : b.variables.id === '2' ? { id: '2', mode: 'PERFORMERS' } : null } }))
    const c = createClient({ server: 'localhost:9999', fetch: f })
    const sel = await resolveSelection(c, { scope: 'filter', interactiveOnly: true }, '1')
    assert.equal(sel.saved?.object_filter && typeof sel.saved.object_filter, 'object')
    await rejectsKind(resolveSelection(c, { scope: 'filter', interactiveOnly: true }, '2'), 'query', /isn't a scene filter/)
    await rejectsKind(resolveSelection(c, { scope: 'filter', interactiveOnly: true }, '3'), 'query', /gone/)
    // Not a filter: nothing asked.
    assert.deepEqual(await resolveSelection(c, { scope: 'all', interactiveOnly: true }, '1'), { scope: 'all', interactiveOnly: true })
  })
})

describe('paging', () => {
  const all: StashScene[] = Array.from({ length: 23 }, (_, i) => ({ id: String(i + 1), title: `s${i + 1}`, interactive: true, files: [], scene_markers: [], tags: [], performers: [], studio: null }))
  function server(list = all) {
    return fake((b) => {
      const { page, per_page } = b.variables.filter
      return json({ data: { findScenes: { count: list.length, scenes: list.slice((page - 1) * per_page, page * per_page) } } })
    })
  }

  it('fetches every page, in order, with the filter on each', async () => {
    const { f, calls } = server()
    const seen: [number, number][] = []
    const got = await fetchAllScenes(createClient({ server: 'localhost:9999', fetch: f }), { scope: 'all', interactiveOnly: true }, featuresOf(null), { perPage: 10, onPage: (n, t) => seen.push([n, t]) })
    assert.equal(got.total, 23)
    assert.deepEqual(got.scenes.map(s => s.id), all.map(s => s.id))
    assert.equal(calls.length, 3)
    assert.deepEqual(calls.map(c => c.body.variables.filter.page), [1, 2, 3])
    assert.ok(calls.every(c => c.body.variables.scene_filter.interactive === true))
    assert.deepEqual(seen, [[10, 23], [20, 23], [23, 23]])
  })

  it('stops at a limit', async () => {
    const { f, calls } = server()
    const got = await fetchAllScenes(createClient({ server: 'localhost:9999', fetch: f }), { scope: 'all', interactiveOnly: false }, featuresOf(null), { perPage: 10, max: 15 })
    assert.equal(got.scenes.length, 15)
    assert.equal(got.total, 23)
    assert.equal(calls.length, 2)
    assert.equal(calls[0].body.variables.scene_filter, undefined)
  })

  it('drops a scene that shows up twice when the list shifts while paging', async () => {
    let n = 0
    const { f } = fake((b) => {
      n++
      const { page } = b.variables.filter
      const list = page === 1 ? all.slice(0, 10) : all.slice(9, 19)
      return json({ data: { findScenes: { count: 19, scenes: list } } })
    })
    const got = await fetchAllScenes(createClient({ server: 'localhost:9999', fetch: f }), { scope: 'all', interactiveOnly: true }, featuresOf(null), { perPage: 10 })
    assert.equal(n, 2)
    assert.equal(got.scenes.length, 19)
    assert.equal(new Set(got.scenes.map(s => s.id)).size, 19)
  })

  it('handles an empty collection in one call', async () => {
    const { f, calls } = server([])
    const got = await fetchAllScenes(createClient({ server: 'localhost:9999', fetch: f }), { scope: 'all', interactiveOnly: true }, featuresOf(null))
    assert.deepEqual(got, { scenes: [], total: 0 })
    assert.equal(calls.length, 1)
  })

  it('stops with an error mid-way rather than half a list', async () => {
    const { f } = fake((b) => {
      if (b.variables.filter.page === 2)
        return new Response('', { status: 502 })
      return json({ data: { findScenes: { count: 23, scenes: all.slice(0, 10) } } })
    })
    await rejectsKind(fetchAllScenes(createClient({ server: 'localhost:9999', fetch: f }), { scope: 'all', interactiveOnly: true }, featuresOf(null), { perPage: 10 }), 'server')
  })
})
