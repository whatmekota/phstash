import type { Selection, StashScene, Version } from './graphql'
import type { PanelView, Phase } from './panel'
import type { Config } from './settings'
import type { LibrarySourceHandle, PluginContext, ProvidedVideo, SelectOption } from './types'
import { ADD_O_MUTATION, ADD_PLAY_MUTATION, COUNT_QUERY, featuresOf, pageFilter, SAVED_FILTERS_QUERY, sceneVariables, SelectionError, TAGS_QUERY, versionText } from './graphql'
import { sceneToVideo } from './map'
import { renderPanel } from './panel'
import { fields, readConfig, selectionKey } from './settings'
import { checkVersion, createClient, fetchAllScenes, normaliseServer, resolveSelection, StashError } from './stash'
import { CSS } from './style'
import { createThumbs } from './thumbs'
import { createPlayTracker, sceneIdOf } from './writeback'

/**
 * Stash: the user's Stash (stashapp) collection as a library source. The
 * scenes the settings pick (by default the ones with a funscript) show in
 * playhound's library with a "Stash" badge and stream from Stash, with their
 * script, tags, performers, markers as chapters and screenshot.
 *
 * When Stash can't be reached, the scenes last seen stay in the library
 * under "Stash (offline)" rather than vanishing: playlists, stars and the
 * queue keep pointing at them, and a Stash that restarts or sleeps comes back
 * without the library emptying and filling. They're kept across restarts
 * (the plugin's storage), but only for the same server address.
 */

const LABEL = 'Stash'
const LABEL_OFFLINE = 'Stash (offline)'
/** While Stash is offline, look again this often whatever the setting says. */
const OFFLINE_RETRY_MS = 2 * 60_000

const ICON = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true"><path d="M2 5.5 8 2.5l6 3-6 3-6-3Z"/><path d="M2 8.5l6 3 6-3"/><path d="M2 11.5l6 3 6-3"/></svg>'

interface Cache {
  server: string
  at: number
  version: Version | null
  total: number
  scenes: StashScene[]
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`

function asStashError(err: unknown): StashError {
  if (err instanceof StashError)
    return err
  if (err instanceof SelectionError)
    return new StashError('query', err.message)
  return new StashError('query', err instanceof Error ? err.message : String(err))
}

function selectionOf(c: Config): Selection {
  return { scope: c.scope, tagId: c.tag || undefined, subTags: c.subTags, interactiveOnly: c.interactiveOnly }
}

export default async function activate(ctx: PluginContext) {
  ctx.ui.style(CSS)
  let cfg = readConfig(ctx.settings.all())
  let disposed = false

  // â”€â”€â”€ State, and who wants to hear about it â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  let phase: Phase = 'idle'
  let scenes: StashScene[] = []
  /** The server `scenes` came from (normalised). */
  let sceneServer = ''
  let version: Version | null = null
  let total = 0
  let lastOk: number | null = null
  let error: string | null = null
  let progress: { got: number, total: number } | null = null
  let test: PanelView['test'] = null
  let nextAt: number | null = null
  let problems: string[] = []
  let tagNames = new Map<string, string>()
  let filterNames = new Map<string, string>()

  const listeners = new Set<() => void>()
  const changed = () => listeners.forEach(fn => fn())

  const client = () => createClient({ server: cfg.server, apiKey: cfg.apiKey, fetch: ctx.net.fetch })
  const currentServer = () => {
    try {
      return normaliseServer(cfg.server)
    }
    catch {
      return ''
    }
  }

  // â”€â”€â”€ The library source â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const thumbs = createThumbs({
    fetch: ctx.net.fetch,
    storage: ctx.storage,
    onProgress: () => scheduleRemap(1500),
  })

  function videos(): ProvidedVideo[] {
    const headers = cfg.apiKey ? { ApiKey: cfg.apiKey } : undefined
    const out: ProvidedVideo[] = []
    for (const s of scenes) {
      try {
        out.push(sceneToVideo(s, { server: sceneServer, headers, stream: cfg.stream, peopleAsTags: cfg.peopleAsTags, thumbs: thumbs.map }))
      }
      catch (err) {
        ctx.log('scene left out:', s?.id, err)
      }
    }
    return out
  }

  let handle: LibrarySourceHandle | null = null
  let shownLabel = ''
  /** One change to the library at a time. */
  let chain: Promise<unknown> = Promise.resolve()

  function show(label: string | null): Promise<void> {
    const step = chain.then(async () => {
      if (disposed)
        return
      if (!label || !scenes.length) {
        handle?.remove()
        handle = null
        shownLabel = ''
        problems = []
        return
      }
      if (handle && shownLabel === label) {
        await handle.refresh()
      }
      else {
        // Another label is another source; its videos keep their ids, so stars and stats stay.
        handle = await ctx.library.provide({ label, videos })
        shownLabel = label
      }
      problems = handle.problems
      if (problems.length)
        ctx.log(`${problems.length} left out:`, problems.slice(0, 5))
    }).catch((err) => {
      ctx.log('library.provide failed:', err)
    })
    chain = step
    return step
  }

  let remapTimer: ReturnType<typeof setTimeout> | null = null
  function scheduleRemap(ms: number) {
    if (remapTimer || !handle)
      return
    remapTimer = setTimeout(() => {
      remapTimer = null
      void show(shownLabel || null).then(changed)
    }, ms)
  }

  // â”€â”€â”€ Fetching â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  let syncing: Promise<void> | null = null
  let again = false
  let wasOnline = false
  let lastError: StashError | null = null

  function sync(manual = false): Promise<void> {
    if (syncing) {
      again = true
      return syncing
    }
    syncing = (async () => {
      do {
        again = false
        await syncOnce(manual)
      } while (again && !disposed)
    })().finally(() => {
      syncing = null
      schedule()
    })
    return syncing
  }

  async function syncOnce(manual: boolean) {
    const key = selectionKey(cfg)
    phase = 'syncing'
    progress = null
    changed()
    try {
      const c = client()
      const v = await checkVersion(c)
      const sel = await resolveSelection(c, selectionOf(cfg), cfg.savedFilter)
      const got = await fetchAllScenes(c, sel, featuresOf(v), {
        onPage: (n, of) => {
          progress = { got: n, total: of }
          changed()
        },
      })
      if (disposed)
        return
      if (key !== selectionKey(cfg)) {
        // The settings changed while it looked: look again with the new ones.
        again = true
        return
      }
      if (c.server !== sceneServer)
        thumbs.clear()
      scenes = got.scenes
      sceneServer = c.server
      version = v
      total = got.total
      lastOk = Date.now()
      error = null
      phase = 'online'
      progress = null
      wasOnline = true
      await ctx.storage.set('cache', { server: sceneServer, at: lastOk, version, total, scenes } satisfies Cache).catch(err => ctx.log('cache not kept:', err))
      await show(LABEL)
      if (manual)
        ctx.ui.toast(`Stash: ${plural(scenes.length, 'scene')}`, { tone: 'success', detail: total > scenes.length ? `The first ${scenes.length.toLocaleString('en-US')} of ${total.toLocaleString('en-US')}: playhound takes up to 20,000 from one source.` : undefined })
      if (c.headers) {
        void thumbs.run(c.server, c.headers, scenes).then(() => scheduleRemap(0))
      }
      else {
        thumbs.stop()
      }
    }
    catch (err) {
      if (disposed)
        return
      const e = asStashError(err)
      error = e.message
      progress = null
      ctx.log('could not fetch scenes:', e.kind, e.message)
      if (scenes.length && sceneServer === currentServer()) {
        // Kept, marked: see the top of this file.
        phase = 'offline'
        await show(LABEL_OFFLINE)
      }
      else {
        phase = 'error'
        if (scenes.length) {
          // Another server's scenes: they'd stream from the wrong place.
          scenes = []
          sceneServer = ''
          total = 0
          lastOk = null
          version = null
          await show(null)
        }
      }
      if (manual || wasOnline)
        ctx.ui.toast(phase === 'offline' ? 'Stash is offline' : 'Couldn\'t get scenes from Stash', { tone: 'error', detail: e.message })
      wasOnline = false
      lastError = e
    }
    changed()
  }

  // â”€â”€â”€ The timer â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  let timer: ReturnType<typeof setTimeout> | null = null
  function schedule() {
    if (timer)
      clearTimeout(timer)
    timer = null
    nextAt = null
    if (disposed)
      return
    let ms = cfg.refreshMin > 0 ? cfg.refreshMin * 60_000 : 0
    if (phase === 'offline' || (phase === 'error' && lastError?.offline))
      ms = ms ? Math.min(ms, OFFLINE_RETRY_MS) : OFFLINE_RETRY_MS
    if (ms) {
      nextAt = Date.now() + ms
      timer = setTimeout(() => void sync(), ms)
    }
    changed()
  }

  // â”€â”€â”€ Testing the connection â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  async function runTest() {
    test = { busy: true }
    changed()
    try {
      const c = client()
      const v = await checkVersion(c)
      const sel = await resolveSelection(c, selectionOf(cfg), cfg.savedFilter)
      const { scene_filter, q } = sceneVariables(sel)
      const data = await c.gql<{ findScenes: { count: number } }>(COUNT_QUERY, { filter: pageFilter(1, 1, q), ...(scene_filter ? { scene_filter } : {}) })
      const count = Number(data?.findScenes?.count) || 0
      test = {
        busy: false,
        ok: true,
        text: `It works: Stash ${v ? versionText(v) : '(a development build)'}${c.headers ? ', and the API key is right' : ''}. ${plural(count, 'scene matches', 'scenes match')} the settings.`,
      }
    }
    catch (err) {
      test = { busy: false, ok: false, text: asStashError(err).message }
    }
    changed()
  }

  // â”€â”€â”€ Settings â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  async function options(query: string, pick: (data: any) => { id: string, name: string }[], empty: string): Promise<SelectOption[]> {
    let list: { id: string, name: string }[]
    try {
      list = pick(await client().gql(query))
    }
    catch (err) {
      // playhound shows this under the field: "Couldn't load the list: …".
      throw new Error(asStashError(err).message)
    }
    if (!list.length)
      return [{ value: '', label: empty }]
    return list.map(x => ({ value: String(x.id), label: x.name }))
  }
  ctx.ui.settings(fields({
    tags: async () => {
      const list = await options(TAGS_QUERY, d => d?.findTags?.tags ?? [], '(No tags in Stash)')
      tagNames = new Map(list.filter(o => o.value).map(o => [o.value, o.label]))
      return list
    },
    savedFilters: async () => {
      const list = await options(SAVED_FILTERS_QUERY, d => d?.findSavedFilters ?? [], '(No saved scene filters in Stash)')
      filterNames = new Map(list.filter(o => o.value).map(o => [o.value, o.label]))
      return list
    },
  }))

  let settingsTimer: ReturnType<typeof setTimeout> | null = null
  ctx.settings.onChange((values) => {
    const before = cfg
    cfg = readConfig(values)
    if (selectionKey(before) !== selectionKey(cfg)) {
      // Typing an address or a key changes it at every key: wait for a pause.
      if (settingsTimer)
        clearTimeout(settingsTimer)
      settingsTimer = setTimeout(() => {
        settingsTimer = null
        test = null
        void sync()
      }, 1200)
    }
    else if (before.stream !== cfg.stream || before.peopleAsTags !== cfg.peopleAsTags) {
      scheduleRemap(300)
    }
    if (before.refreshMin !== cfg.refreshMin && !syncing)
      schedule()
  })

  function which(): string {
    const base = cfg.scope === 'tag'
      ? `With the tag ${tagNames.get(cfg.tag) ? `"${tagNames.get(cfg.tag)}"` : cfg.tag ? `#${cfg.tag}` : '(none picked)'}${cfg.subTags ? ' or its sub-tags' : ''}`
      : cfg.scope === 'filter'
        ? `The saved filter ${filterNames.get(cfg.savedFilter) ? `"${filterNames.get(cfg.savedFilter)}"` : cfg.savedFilter ? `#${cfg.savedFilter}` : '(none picked)'}`
        : 'All scenes'
    return `${base}${cfg.interactiveOnly ? ', with a script' : ''}`
  }

  // â”€â”€â”€ The panel and the command â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  ctx.ui.panel({
    title: 'Stash',
    icon: ICON,
    mount(el) {
      const draw = () => renderPanel(el, {
        phase,
        server: sceneServer || currentServer() || cfg.server,
        version: version ? versionText(version) : null,
        count: shownLabel ? scenes.length : 0,
        total,
        which: which(),
        lastOk,
        nextAt,
        progress,
        error,
        problems,
        thumbs: cfg.apiKey && scenes.length ? { done: thumbs.map.size, of: scenes.length } : null,
        test,
      }, {
        refresh: () => void sync(true),
        test: () => void runTest(),
        settings: () => ctx.ui.openSettings(),
      })
      draw()
      listeners.add(draw)
      // "2 min ago" moves on by itself.
      const tick = setInterval(draw, 30_000)
      return () => {
        listeners.delete(draw)
        clearInterval(tick)
      }
    },
  })

  ctx.commands.register({
    id: 'refresh',
    title: 'Look for new scenes in Stash',
    hint: 'Fetch the scene list from Stash again',
    icon: ICON,
    run: () => void sync(true),
  })

  // â”€â”€â”€ Telling Stash (off by default) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  async function tell(mutation: string, sceneId: string, what: 'play' | 'o') {
    if (!sceneServer || sceneServer !== currentServer())
      return
    try {
      const data = await client().gql<Record<string, { count?: number }>>(mutation, { id: sceneId })
      const count = Object.values(data ?? {})[0]?.count
      ctx.log(`told Stash: ${what} for scene ${sceneId}`, count)
      if (what === 'o')
        ctx.ui.toast('Counted in Stash', { tone: 'success', detail: typeof count === 'number' ? `O counter: ${count}` : undefined })
    }
    catch (err) {
      ctx.ui.toast(what === 'o' ? 'Stash didn\'t take the O' : 'Stash didn\'t take the play', { tone: 'error', detail: asStashError(err).message })
    }
  }

  const tracker = createPlayTracker((sceneId) => {
    if (cfg.writePlays)
      void tell(ADD_PLAY_MUTATION, sceneId, 'play')
  })
  const followPlayer = (s: { title: string | null, playing: boolean }) => tracker.update(sceneIdOf(s.title, ctx.manifest.id), s.playing)
  followPlayer(ctx.player.state())
  ctx.player.onChange(followPlayer)
  ctx.session.onFinish(() => {
    if (!cfg.writeOs)
      return
    const id = sceneIdOf(ctx.player.state().title, ctx.manifest.id)
    if (id)
      void tell(ADD_O_MUTATION, id, 'o')
  })

  // â”€â”€â”€ Start: what was kept, then a fresh look â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const cache = await ctx.storage.get<Cache>('cache').catch(() => undefined)
  if (cache && Array.isArray(cache.scenes) && cache.server === currentServer()) {
    scenes = cache.scenes
    sceneServer = cache.server
    version = cache.version ?? null
    total = cache.total ?? cache.scenes.length
    lastOk = cache.at ?? null
    if (cfg.apiKey)
      void thumbs.run(sceneServer, { ApiKey: cfg.apiKey }, scenes).then(() => scheduleRemap(0))
    await show(LABEL)
  }
  void sync()

  return () => {
    disposed = true
    for (const t of [timer, remapTimer, settingsTimer]) {
      if (t)
        clearTimeout(t)
    }
    thumbs.stop()
    tracker.dispose()
    listeners.clear()
  }
}
