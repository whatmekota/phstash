/**
 * What phstash asks Stash, as GraphQL. Everything here is plain data in and
 * out, so the tests can check it without a server.
 *
 * Schema references (stashapp/stash, v0.32.0):
 * - graphql/schema/schema.graphql: findScenes, findTags, findSavedFilters,
 *   findSavedFilter, version; the sceneAddO / sceneAddPlay mutations (0.25+).
 * - graphql/schema/types/scene.graphql: Scene (files, scene_markers, tags,
 *   performers, studio, o_counter, play_count, rating100, interactive).
 * - graphql/schema/types/scene-marker.graphql: SceneMarker.end_seconds (0.28+).
 * - graphql/schema/types/filters.graphql: FindFilterType, SceneFilterType,
 *   HierarchicalMultiCriterionInput, SavedFilter.object_filter.
 */

/** The oldest Stash phstash works with: sceneAddO / sceneAddPlay arrived in 0.25.0. */
export const MIN_STASH: Version = [0, 25, 0]
/** SceneMarker.end_seconds arrived in 0.28.0. */
const MARKER_END: Version = [0, 28, 0]

export type Version = [number, number, number]

/** "v0.32.0", "0.32.0-12-gabcdef" → [0, 32, 0]; null when it doesn't say (a development build). */
export function parseVersion(v: unknown): Version | null {
  const m = typeof v === 'string' ? /(\d+)\.(\d+)(?:\.(\d+))?/.exec(v) : null
  return m ? [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)] : null
}

export function atLeast(v: Version, min: Version): boolean {
  for (let i = 0; i < 3; i++) {
    if (v[i] !== min[i])
      return v[i] > min[i]
  }
  return true
}

export const versionText = (v: Version) => `v${v.join('.')}`

/** What the connected Stash can be asked. An unknown version is taken as the newest. */
export interface Features {
  markerEnd: boolean
}

export function featuresOf(v: Version | null): Features {
  return { markerEnd: !v || atLeast(v, MARKER_END) }
}

// ─── Queries ─────────────────────────────────────────────────────────────────

export const VERSION_QUERY = 'query PhstashVersion { version { version } }'

export function scenesQuery(f: Features): string {
  return `query PhstashScenes($filter: FindFilterType, $scene_filter: SceneFilterType) {
  findScenes(filter: $filter, scene_filter: $scene_filter) {
    count
    scenes {
      id
      title
      date
      interactive
      interactive_speed
      o_counter
      play_count
      rating100
      updated_at
      files { basename duration format video_codec }
      scene_markers { title seconds${f.markerEnd ? ' end_seconds' : ''} primary_tag { name } }
      tags { name }
      performers { name }
      studio { name }
    }
  }
}`
}

export const COUNT_QUERY = `query PhstashCount($filter: FindFilterType, $scene_filter: SceneFilterType) {
  findScenes(filter: $filter, scene_filter: $scene_filter) { count }
}`

export const TAGS_QUERY = `query PhstashTags {
  findTags(filter: { per_page: -1, sort: "name", direction: ASC }) {
    tags { id name }
  }
}`

export const SAVED_FILTERS_QUERY = `query PhstashSavedFilters {
  findSavedFilters(mode: SCENES) { id name }
}`

export const SAVED_FILTER_QUERY = `query PhstashSavedFilter($id: ID!) {
  findSavedFilter(id: $id) { id name mode find_filter { q } object_filter }
}`

export const ADD_O_MUTATION = `mutation PhstashAddO($id: ID!) {
  sceneAddO(id: $id) { count }
}`

export const ADD_PLAY_MUTATION = `mutation PhstashAddPlay($id: ID!) {
  sceneAddPlay(id: $id) { count }
}`

// ─── The scenes' shape ───────────────────────────────────────────────────────

export interface StashScene {
  id: string
  title: string | null
  date?: string | null
  interactive: boolean
  interactive_speed?: number | null
  o_counter?: number | null
  play_count?: number | null
  rating100?: number | null
  updated_at?: string | null
  files: { basename: string, duration: number, format: string, video_codec: string }[]
  scene_markers: { title: string, seconds: number, end_seconds?: number | null, primary_tag?: { name: string } | null }[]
  tags: { name: string }[]
  performers: { name: string }[]
  studio: { name: string } | null
}

// ─── Which scenes ────────────────────────────────────────────────────────────

export type Scope = 'all' | 'tag' | 'filter'

export interface Selection {
  scope: Scope
  /** For 'tag'. */
  tagId?: string
  /** For 'tag': its sub-tags count too. */
  subTags?: boolean
  /** Only scenes with a funscript (Stash's "interactive"). */
  interactiveOnly: boolean
  /** For 'filter': the saved filter, as findSavedFilter gives it. */
  saved?: { object_filter?: unknown, find_filter?: { q?: string | null } | null } | null
}

/** A choice in the settings that can't make a query (no tag picked…). */
export class SelectionError extends Error {}

/** The variables for findScenes, less the page: the scene filter and a search term. */
export function sceneVariables(sel: Selection): { scene_filter?: Record<string, unknown>, q?: string } {
  let filter: Record<string, unknown> = {}
  let q: string | undefined
  if (sel.scope === 'tag') {
    if (!sel.tagId)
      throw new SelectionError('Pick a tag in the settings, or show all scenes.')
    filter.tags = { value: [sel.tagId], modifier: 'INCLUDES', depth: sel.subTags ? -1 : 0 }
  }
  else if (sel.scope === 'filter') {
    if (!sel.saved)
      throw new SelectionError('Pick a saved filter in the settings, or show all scenes.')
    filter = translateSavedFilter(sel.saved.object_filter)
    q = sel.saved.find_filter?.q?.trim() || undefined
  }
  if (sel.interactiveOnly)
    filter.interactive = true
  return { ...(Object.keys(filter).length ? { scene_filter: filter } : {}), ...(q ? { q } : {}) }
}

/** One page of findScenes, in a stable order (by id) so pages don't overlap. */
export function pageFilter(page: number, perPage: number, q?: string) {
  return { page, per_page: perPage, sort: 'id', direction: 'ASC', ...(q ? { q } : {}) }
}

// ─── Saved filters ───────────────────────────────────────────────────────────
// Stash keeps a saved filter's criteria the way its UI holds them, not as the
// SceneFilterType that findScenes takes (ui/v2.5/src/models/list-filter/
// criteria/criterion.ts: applyToSavedCriterion vs toCriterionInput). This does
// the UI's translation for the kinds of criterion it saves.

/** SceneFilterType fields that are a plain Boolean (BooleanCriterion saves "true"/"false"). */
const BOOLEANS = new Set(['organized', 'performer_favorite', 'interactive'])
/** SceneFilterType fields that are a plain String. */
const PLAIN_STRINGS = new Set(['has_markers', 'is_missing'])

const RESOLUTIONS: Record<string, string> = {
  '144p': 'VERY_LOW',
  '240p': 'LOW',
  '360p': 'R360P',
  '480p': 'STANDARD',
  '540p': 'WEB_HD',
  '720p': 'STANDARD_HD',
  '1080p': 'FULL_HD',
  '1440p': 'QUAD_HD',
  '1920p': 'VR_HD',
  '4k': 'FOUR_K',
  '5k': 'FIVE_K',
  '6k': 'SIX_K',
  '7k': 'SEVEN_K',
  '8k': 'EIGHT_K',
  '8k+': 'HUGE',
  'huge': 'HUGE',
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const idOf = (x: unknown) => String(isObj(x) ? x.id : x)

/** A saved filter's object_filter as a SceneFilterType. */
export function translateSavedFilter(obj: unknown): Record<string, unknown> {
  if (!isObj(obj))
    return {}
  const out: Record<string, unknown> = {}
  for (const [key, c] of Object.entries(obj))
    out[key] = translateCriterion(key, c)
  return out
}

function translateCriterion(key: string, c: unknown): unknown {
  // Not a saved criterion ({ modifier, value }): taken as already being one for the query.
  if (!isObj(c) || typeof c.modifier !== 'string')
    return c
  const { modifier, value } = c
  if (BOOLEANS.has(key))
    return value === true || value === 'true'
  if (PLAIN_STRINGS.has(key))
    return String(value ?? '')
  if (key === 'resolution')
    return { modifier, value: RESOLUTIONS[String(value).toLowerCase()] ?? String(value).toUpperCase() }
  if (key === 'orientation')
    return { value: (Array.isArray(value) ? value : [value]).map(v => String(v).toUpperCase()) }
  // Tags, studios, groups…: { items: [{ id, label }], excluded, depth }.
  if (isObj(value) && Array.isArray(value.items)) {
    return {
      value: value.items.map(idOf),
      excludes: Array.isArray(value.excluded) ? value.excluded.map(idOf) : [],
      modifier,
      // An "equals" can't reach into sub-tags.
      depth: modifier === 'EQUALS' ? 0 : Number(value.depth ?? 0),
    }
  }
  // Performers, galleries: [{ id, label }].
  if (Array.isArray(value) && value.every(v => isObj(v) && 'id' in v))
    return { value: value.map(idOf), modifier }
  // Numbers, durations and dates: { value, value2 }.
  if (isObj(value) && 'value' in value)
    return { modifier, value: value.value, ...(value.value2 !== undefined && value.value2 !== null ? { value2: value.value2 } : {}) }
  if (value === undefined || value === null)
    return { modifier, value: '' }
  return { modifier, value }
}
