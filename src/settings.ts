import type { Scope } from './graphql'
import type { StreamMode } from './map'
import type { SelectOption, SettingField } from './types'

export const DEFAULT_SERVER = 'http://localhost:9999'

export interface Config {
  server: string
  apiKey: string
  scope: Scope
  tag: string
  subTags: boolean
  savedFilter: string
  interactiveOnly: boolean
  stream: StreamMode
  peopleAsTags: boolean
  /** Minutes between refreshes; 0 for never. */
  refreshMin: number
  writePlays: boolean
  writeOs: boolean
}

const str = (v: unknown, d: string) => (typeof v === 'string' ? v : d)
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d)
const oneOf = <T extends string>(v: unknown, list: readonly T[], d: T): T => (list.includes(v as T) ? v as T : d)

export function readConfig(v: Record<string, unknown>): Config {
  const refresh = Number(v.refreshMin ?? 30)
  return {
    server: str(v.server, DEFAULT_SERVER).trim() || DEFAULT_SERVER,
    apiKey: str(v.apiKey, '').trim(),
    scope: oneOf(v.scope, ['all', 'tag', 'filter'] as const, 'all'),
    tag: str(v.tag, ''),
    subTags: bool(v.subTags, true),
    savedFilter: str(v.savedFilter, ''),
    interactiveOnly: bool(v.interactiveOnly, true),
    stream: oneOf(v.stream, ['auto', 'direct', 'mp4'] as const, 'auto'),
    peopleAsTags: bool(v.peopleAsTags, true),
    refreshMin: Number.isFinite(refresh) && refresh > 0 ? refresh : 0,
    writePlays: bool(v.writePlays, false),
    writeOs: bool(v.writeOs, false),
  }
}

/** What decides which scenes come, and from where: a change to any of these fetches again. */
export function selectionKey(c: Config): string {
  return JSON.stringify([c.server, c.apiKey, c.scope, c.scope === 'tag' ? [c.tag, c.subTags] : c.scope === 'filter' ? c.savedFilter : null, c.interactiveOnly])
}

export function fields(opts: { tags: () => Promise<SelectOption[]>, savedFilters: () => Promise<SelectOption[]> }): SettingField[] {
  return [
    { type: 'heading', label: 'Stash' },
    { key: 'server', type: 'text', label: 'Address', placeholder: DEFAULT_SERVER, default: DEFAULT_SERVER, hint: 'Where Stash runs, as you open it in a browser. Test it from the Stash panel.' },
    { key: 'apiKey', type: 'password', label: 'API key', default: '', hint: 'Only if your Stash has a password: in Stash, Settings → Security → API Key. It is sent as a header, never in an address.' },

    { type: 'heading', label: 'Which scenes' },
    {
      key: 'scope',
      type: 'select',
      label: 'Scenes',
      default: 'all',
      options: [
        { value: 'all', label: 'All of them' },
        { value: 'tag', label: 'With a tag' },
        { value: 'filter', label: 'A saved filter' },
      ],
    },
    { key: 'tag', type: 'select', label: 'Tag', default: '', options: opts.tags, when: v => v.scope === 'tag' },
    { key: 'subTags', type: 'switch', label: 'Its sub-tags too', default: true, when: v => v.scope === 'tag' },
    { key: 'savedFilter', type: 'select', label: 'Saved filter', default: '', options: opts.savedFilters, hint: 'A scene filter saved in Stash. Its sort order is left to playhound.', when: v => v.scope === 'filter' },
    { key: 'interactiveOnly', type: 'switch', label: 'Only scenes with a script', default: true, hint: 'The ones Stash marks interactive: a .funscript next to the video.' },
    {
      key: 'refreshMin',
      type: 'select',
      label: 'Look again',
      default: '30',
      options: [
        { value: '0', label: 'Only when I ask' },
        { value: '5', label: 'Every 5 minutes' },
        { value: '15', label: 'Every 15 minutes' },
        { value: '30', label: 'Every 30 minutes' },
        { value: '60', label: 'Every hour' },
      ],
    },

    { type: 'heading', label: 'In the library' },
    {
      key: 'stream',
      type: 'select',
      label: 'Stream',
      default: 'auto',
      options: [
        { value: 'auto', label: 'The file, or an MP4 when it won\'t play' },
        { value: 'direct', label: 'Always the file' },
        { value: 'mp4', label: 'Always an MP4 (Stash converts it)' },
      ],
      hint: 'Stash converts as it streams, so seeking in a converted video starts it again from the beginning.',
    },
    { key: 'peopleAsTags', type: 'switch', label: 'Performers and studio as tags', default: true },

    { type: 'heading', label: 'Tell Stash', hint: 'Off unless you switch them on.' },
    { key: 'writePlays', type: 'switch', label: 'Count plays', default: false, hint: 'Adds a play in Stash once a scene has played for 10 seconds.' },
    { key: 'writeOs', type: 'switch', label: 'Count O\'s', default: false, hint: 'Adds to the scene\'s O counter in Stash when you mark "I came" during it.' },
  ]
}
