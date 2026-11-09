import type { StashScene } from './graphql'
import type { FetchFn } from './stash'

/**
 * Screenshots for a Stash with a password. playhound loads a provided
 * video's thumbnail without headers, and Stash answers a screenshot request
 * without the key with its login page, so with a key they are fetched here
 * (with the key in the header), made small, and handed over as data: images.
 * They are kept in the plugin's storage by scene and its last change, so each
 * is fetched once.
 *
 * Without a key none of this runs: the screenshot's own URL loads as it is.
 */

const WIDTH = 480
const WORKERS = 3

interface Stored { t: string, url: string }

export interface Storage {
  get: <T = unknown>(key: string) => Promise<T | undefined>
  set: (key: string, value: unknown) => Promise<void>
}

export interface Thumbs {
  /** Scene id → data: URL, for the scenes done so far. */
  readonly map: ReadonlyMap<string, string>
  /** Fetch what's missing for these scenes; a later call replaces an earlier one. */
  run: (server: string, headers: Record<string, string>, scenes: readonly StashScene[]) => Promise<void>
  stop: () => void
  clear: () => void
}

export function createThumbs(o: { fetch: FetchFn, storage: Storage, onProgress: () => void }): Thumbs {
  const map = new Map<string, string>()
  const stamps = new Map<string, string>()
  let gen = 0
  let mapServer = ''

  async function one(server: string, headers: Record<string, string>, s: StashScene, my: number) {
    const stamp = s.updated_at ?? ''
    if (map.has(s.id) && stamps.get(s.id) === stamp)
      return
    const key = `thumb:${server}|${s.id}`
    const kept = await o.storage.get<Stored>(key).catch(() => undefined)
    if (my !== gen)
      return
    if (kept && kept.t === stamp && typeof kept.url === 'string') {
      map.set(s.id, kept.url)
      stamps.set(s.id, stamp)
      o.onProgress()
      return
    }
    try {
      const res = await o.fetch(`${server}/scene/${encodeURIComponent(s.id)}/screenshot`, { headers })
      // A missing screenshot, or the login page: nothing to show.
      if (!res.ok || !/^image\//i.test(res.headers.get('content-type') ?? ''))
        return
      const url = await shrink(await res.blob())
      if (!url || my !== gen)
        return
      map.set(s.id, url)
      stamps.set(s.id, stamp)
      await o.storage.set(key, { t: stamp, url } satisfies Stored).catch(() => {})
      o.onProgress()
    }
    catch {}
  }

  return {
    map,
    async run(server, headers, scenes) {
      const my = ++gen
      if (server !== mapServer) {
        map.clear()
        stamps.clear()
        mapServer = server
      }
      const queue = [...scenes]
      await Promise.all(Array.from({ length: WORKERS }, async () => {
        while (queue.length && my === gen)
          await one(server, headers, queue.shift()!, my)
      }))
    },
    stop() {
      gen++
    },
    clear() {
      gen++
      map.clear()
      stamps.clear()
    },
  }
}

/** A picture made small enough to keep thousands of: JPEG, 480 px wide. */
async function shrink(blob: Blob): Promise<string | null> {
  try {
    const bmp = await createImageBitmap(blob)
    const scale = Math.min(1, WIDTH / bmp.width)
    const w = Math.max(1, Math.round(bmp.width * scale))
    const h = Math.max(1, Math.round(bmp.height * scale))
    const canvas = new OffscreenCanvas(w, h)
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, w, h)
    bmp.close()
    return await dataUrl(await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 }))
  }
  catch {
    return blob.size < 300_000 ? dataUrl(blob) : null
  }
}

function dataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })
}
