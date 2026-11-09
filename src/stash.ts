import type { Features, Selection, StashScene, Version } from './graphql'
import { atLeast, featuresOf, MIN_STASH, pageFilter, parseVersion, SAVED_FILTER_QUERY, sceneVariables, scenesQuery, VERSION_QUERY, versionText } from './graphql'

/**
 * Talking to Stash: one GraphQL call, the errors in plain words, and paging
 * through findScenes.
 *
 * Auth (stashapp/stash v0.32.0, pkg/session/session.go Authenticate): the API
 * key goes in the `ApiKey` header (a query parameter `apikey` works too, but
 * phstash never puts the key in a URL). A wrong key is 401; with a password
 * set and no key, /graphql is 401 too (internal/api/authentication.go). With
 * no password, Stash turns away public addresses with a 403.
 * CORS: Stash allows every origin (internal/api/server.go, cors.AllowAll).
 */

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>

export type StashErrorKind
  = | 'address' // the address isn't one
    | 'unreachable' // nothing answers
    | 'timeout'
    | 'needs-key' // it has a password and we sent no key
    | 'bad-key' // the key we sent was refused
    | 'forbidden' // it refuses this computer (no password, public address)
    | 'not-stash' // something answers, but not Stash
    | 'old' // too old for phstash
    | 'server' // a 5xx
    | 'query' // Stash didn't like the query (a saved filter it can't take…)

export class StashError extends Error {
  constructor(readonly kind: StashErrorKind, message: string) {
    super(message)
  }

  /** Stash isn't there right now (as opposed to being set up wrong). */
  get offline(): boolean {
    return this.kind === 'unreachable' || this.kind === 'timeout' || this.kind === 'server'
  }
}

/** The address as typed, made into a base URL: "localhost:9999/" → "http://localhost:9999". */
export function normaliseServer(raw: string): string {
  const text = String(raw ?? '').trim()
  if (!text)
    throw new StashError('address', 'Type your Stash\'s address in the settings, like http://localhost:9999.')
  let url: URL
  try {
    url = new URL(/^[a-z][\w+.-]*:\/\//i.test(text) ? text : `http://${text}`)
  }
  catch {
    throw new StashError('address', `"${text}" isn't an address. Try http://localhost:9999.`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new StashError('address', `Stash's address starts with http:// or https://, not ${url.protocol}//.`)
  url.search = ''
  url.hash = ''
  return url.href.replace(/\/+$/, '')
}

export interface ClientOptions {
  server: string
  apiKey?: string
  fetch: FetchFn
  /** ms; default 20 s. */
  timeoutMs?: number
}

export interface StashClient {
  readonly server: string
  /** The headers Stash wants on everything (the API key), or undefined without one. */
  readonly headers: Record<string, string> | undefined
  gql: <T>(query: string, variables?: Record<string, unknown>) => Promise<T>
}

export function createClient(o: ClientOptions): StashClient {
  const server = normaliseServer(o.server)
  const key = o.apiKey?.trim()
  const headers = key ? { ApiKey: key } : undefined
  const timeoutMs = o.timeoutMs ?? 20_000

  async function gql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const opName = /^\s*(?:query|mutation)\s+(\w+)/.exec(query)?.[1]
    let res: Response
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      res = await o.fetch(`${server}/graphql`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', ...headers },
        body: JSON.stringify({ operationName: opName, query, variables: variables ?? {} }),
        signal: ctrl.signal,
      })
    }
    catch (err) {
      if (ctrl.signal.aborted)
        throw new StashError('timeout', `Stash at ${server} didn't answer within ${Math.round(timeoutMs / 1000)} s.`)
      throw new StashError('unreachable', `Can't reach Stash at ${server}. Is it running, and is the address right?${detail(err)}`)
    }
    finally {
      clearTimeout(timer)
    }
    return readAnswer<T>(res, server, !!key)
  }

  return { server, headers, gql }
}

function detail(err: unknown): string {
  const m = err instanceof Error ? err.message : ''
  // fetch's own "Failed to fetch" says nothing more.
  return m && !/^(?:Failed to fetch|fetch failed|Load failed|NetworkError.*)$/i.test(m) ? ` (${m.replace(/^Failed to fetch: /, '')})` : ''
}

/** Stash's answer, or the error it means. */
export async function readAnswer<T>(res: Response, server: string, sentKey: boolean): Promise<T> {
  const text = await res.text().catch(() => '')
  if (res.status === 401) {
    throw sentKey
      ? new StashError('bad-key', 'Stash turned down the API key. Copy it again from Stash: Settings → Security → API Key.')
      : new StashError('needs-key', 'This Stash has a password. Add its API key in the settings (in Stash: Settings → Security → API Key).')
  }
  if (res.status === 403) {
    throw /public IP/i.test(text)
      ? new StashError('forbidden', 'Stash refuses connections from outside your network while it has no password. Give it a username and password (Settings → Security), then use its API key here.')
      : new StashError('forbidden', `Stash refused the request (403).${snippet(text)}`)
  }
  if (res.status === 404 || res.status === 405)
    throw new StashError('not-stash', `Something answers at ${server}, but it isn't Stash: there's no GraphQL API at ${server}/graphql.`)
  if (res.status >= 500)
    throw new StashError('server', `Stash had a problem (HTTP ${res.status}).${snippet(text)}`)

  // Stash 0.29+ answers application/graphql-response+json, and a request it
  // won't take with HTTP 400 and the errors in the body, so the body is read
  // whatever the type and status.
  let body: { data?: T, errors?: { message?: string, path?: unknown[] }[] } | null = null
  try {
    body = JSON.parse(text)
  }
  catch {}
  if (!body || typeof body !== 'object' || (!('data' in body) && !('errors' in body)))
    throw new StashError('not-stash', `Something answers at ${server}, but it isn't Stash (HTTP ${res.status}, not a GraphQL answer).`)
  const errors = Array.isArray(body.errors) ? body.errors.map(errorText).filter(Boolean) : []
  if (errors.length) {
    // A field or argument this Stash doesn't know: it's older than what phstash asks for.
    if (errors.some(m => /Cannot query field|Unknown argument|Unknown type|Cannot query/i.test(m)))
      throw new StashError('old', `This Stash is too old for phstash, which needs ${versionText(MIN_STASH)} or newer. Update Stash. (${errors[0]})`)
    throw new StashError('query', `Stash answered with an error: ${errors.slice(0, 2).join('; ')}`)
  }
  if (!res.ok)
    throw new StashError('server', `Stash answered HTTP ${res.status}.${snippet(text)}`)
  return body.data as T
}

/** "unknown field (at performers.depth)": where in what phstash sent, when Stash says. */
export function errorText(e: { message?: string, path?: unknown[] } | null | undefined): string {
  const message = String(e?.message ?? '').trim()
  if (!message || !Array.isArray(e?.path) || !e.path.length)
    return message
  // ["variable", "scene_filter", "performers", "depth"]: the part inside the variable.
  const path = e.path[0] === 'variable' ? e.path.slice(2) : e.path
  return path.length ? `${message} (at ${path.join('.')})` : message
}

function snippet(text: string): string {
  const t = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140)
  return t ? ` ${t}` : ''
}

/** Its version, checked against the oldest phstash takes. Null when it doesn't say (a development build). */
export async function checkVersion(c: StashClient): Promise<Version | null> {
  const data = await c.gql<{ version?: { version?: string | null } }>(VERSION_QUERY)
  const v = parseVersion(data?.version?.version)
  if (v && !atLeast(v, MIN_STASH))
    throw new StashError('old', `This Stash is ${versionText(v)}; phstash needs ${versionText(MIN_STASH)} or newer. Update Stash.`)
  return v
}

/** The selection's saved filter, fetched when it is one. */
export async function resolveSelection(c: StashClient, sel: Selection, savedFilterId: string): Promise<Selection> {
  if (sel.scope !== 'filter' || !savedFilterId)
    return sel
  const data = await c.gql<{ findSavedFilter: Selection['saved'] & { mode?: string } | null }>(SAVED_FILTER_QUERY, { id: savedFilterId })
  const saved = data?.findSavedFilter
  if (!saved)
    throw new StashError('query', 'That saved filter is gone from Stash. Pick another in the settings.')
  if (saved.mode && saved.mode !== 'SCENES')
    throw new StashError('query', 'That saved filter isn\'t a scene filter. Pick another in the settings.')
  return { ...sel, saved }
}

export interface FetchScenesOptions {
  perPage?: number
  /** At most this many (playhound takes up to 20,000 from a source). */
  max?: number
  onPage?: (got: number, total: number) => void
}

/** Every scene the selection matches, a page at a time. */
export async function fetchAllScenes(c: StashClient, sel: Selection, features: Features, o: FetchScenesOptions = {}): Promise<{ scenes: StashScene[], total: number }> {
  const perPage = o.perPage ?? 250
  const max = o.max ?? 20_000
  const { scene_filter, q } = sceneVariables(sel)
  const query = scenesQuery(features)
  const scenes: StashScene[] = []
  const seen = new Set<string>()
  let total = 0
  for (let page = 1; ; page++) {
    const data = await c.gql<{ findScenes: { count: number, scenes: StashScene[] } }>(query, {
      filter: pageFilter(page, perPage, q),
      ...(scene_filter ? { scene_filter } : {}),
    })
    const got = data?.findScenes
    if (!got || !Array.isArray(got.scenes))
      throw new StashError('not-stash', 'Stash\'s answer to findScenes had no scenes in it.')
    total = Number(got.count) || 0
    for (const s of got.scenes) {
      // A scene added while paging can shift one onto the next page twice.
      if (s && s.id != null && !seen.has(String(s.id)) && scenes.length < max) {
        seen.add(String(s.id))
        scenes.push({ ...s, id: String(s.id) })
      }
    }
    o.onPage?.(scenes.length, total)
    if (got.scenes.length < perPage || page * perPage >= total || scenes.length >= max)
      break
    // A guard against a server that never says it's done.
    if (page >= Math.ceil(max / perPage) + 5)
      break
  }
  return { scenes, total }
}

export { featuresOf }
