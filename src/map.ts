import type { StashScene } from './graphql'
import type { ProvidedVideo } from './types'

/**
 * A Stash scene as a video in playhound's library.
 *
 * The URLs are built here from the server's address, not taken from the
 * scene's `paths`: with an API key set, Stash writes the key into
 * paths.stream and paths.funscript as `?apikey=` (internal/api/urlbuilders/
 * scene.go, GetStreamURL / GetFunscriptURL), and a key in a URL ends up in
 * logs, history and anything that copies the link. The key goes in the
 * `ApiKey` header instead; playhound sends it through its local proxy for
 * the stream and with the script requests.
 *
 * Routes (internal/api/routes_scene.go): /scene/{id}/stream (the file, with
 * Range), /scene/{id}/stream.m3u8 (converted, as HLS), /scene/{id}/funscript,
 * /scene/{id}/screenshot; the scene's page in Stash's UI is /scenes/{id}.
 */

/**
 * 'auto': the file itself when a browser plays it, else converted by Stash.
 * Converted means HLS (stream.m3u8): a VOD playlist of the whole length, its
 * segments converted as they're asked for, so the length is known and seeking
 * works. Stash's stream.mp4 is converted as one stream, whose length grows as it
 * plays and which can't seek ahead (seen with a real Stash 0.32).
 */
export type StreamMode = 'auto' | 'direct' | 'convert'

export interface MapOptions {
  server: string
  /** The API key header, when there is a key. */
  headers?: Record<string, string>
  stream: StreamMode
  /** Performers and the studio go in the tags too. */
  peopleAsTags: boolean
  /** Screenshots already fetched (with the key), by scene id: data: URLs. */
  thumbs?: ReadonlyMap<string, string>
}

const CONTAINERS = new Set(['mp4', 'm4v', 'mov', 'webm', 'mkv', 'matroska'])
const CODECS = new Set(['h264', 'avc1', 'hevc', 'h265', 'vp8', 'vp9', 'av1'])

/** Whether Chromium plays the file as it is. Unknown formats are given the benefit of the doubt. */
export function playsDirectly(file: StashScene['files'][number] | undefined): boolean {
  if (!file || (!file.format && !file.video_codec))
    return true
  const format = (file.format ?? '').toLowerCase()
  const codec = (file.video_codec ?? '').toLowerCase()
  return (!format || CONTAINERS.has(format)) && (!codec || CODECS.has(codec))
}

export function streamOf(server: string, s: StashScene, mode: StreamMode): { url: string, kind: 'file' | 'hls' } {
  const convert = mode === 'convert' || (mode === 'auto' && !playsDirectly(s.files?.[0]))
  const base = `${server}/scene/${encodeURIComponent(s.id)}`
  return convert ? { url: `${base}/stream.m3u8`, kind: 'hls' } : { url: `${base}/stream`, kind: 'file' }
}

/** Stash's screenshot, which loads without headers only on a Stash with no password. */
export function screenshotUrl(server: string, s: StashScene): string {
  const t = s.updated_at ? Math.floor(Date.parse(s.updated_at) / 1000) : Number.NaN
  return `${server}/scene/${encodeURIComponent(s.id)}/screenshot${Number.isFinite(t) ? `?t=${t}` : ''}`
}

export function sceneTitle(s: StashScene): string {
  const t = s.title?.trim()
  if (t)
    return t
  const base = s.files?.[0]?.basename?.trim()
  return base ? base.replace(/\.[^.]{1,5}$/, '') : `Scene ${s.id}`
}

export function sceneTags(s: StashScene, peopleAsTags: boolean): string[] {
  const names = [
    ...(s.tags ?? []).map(t => t?.name),
    ...(peopleAsTags ? [...(s.performers ?? []).map(p => p?.name), s.studio?.name] : []),
  ]
  const out: string[] = []
  for (const n of names) {
    const t = typeof n === 'string' ? n.trim() : ''
    if (t && !out.some(x => x.toLowerCase() === t.toLowerCase()))
      out.push(t)
  }
  return out
}

export function sceneChapters(s: StashScene): NonNullable<ProvidedVideo['chapters']> {
  return (s.scene_markers ?? [])
    .filter(m => m && Number.isFinite(m.seconds) && m.seconds >= 0)
    .map(m => ({
      name: m.title?.trim() || m.primary_tag?.name?.trim() || 'Marker',
      start: m.seconds,
      ...(typeof m.end_seconds === 'number' && m.end_seconds > m.seconds ? { end: m.end_seconds } : {}),
    }))
    .sort((a, b) => a.start - b.start)
}

export function sceneToVideo(s: StashScene, o: MapOptions): ProvidedVideo {
  const id = encodeURIComponent(s.id)
  const duration = s.files?.[0]?.duration
  const thumbnail = o.headers ? o.thumbs?.get(s.id) : screenshotUrl(o.server, s)
  return {
    id: s.id,
    title: sceneTitle(s),
    ...streamOf(o.server, s, o.stream),
    ...(o.headers ? { headers: { ...o.headers } } : {}),
    // Stash pairs one funscript with a scene (video.GetFunscriptPath): the stroke.
    scripts: s.interactive ? [{ url: `${o.server}/scene/${id}/funscript` }] : [],
    tags: sceneTags(s, o.peopleAsTags),
    chapters: sceneChapters(s),
    ...(thumbnail ? { thumbnail } : {}),
    ...(typeof duration === 'number' && duration > 0 ? { duration } : {}),
    sourceUrl: `${o.server}/scenes/${id}`,
  }
}
