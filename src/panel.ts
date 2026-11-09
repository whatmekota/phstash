/** The Stash panel: where things stand, and the buttons. Plain DOM, drawn again on every change. */

export type Phase = 'idle' | 'syncing' | 'online' | 'offline' | 'error'

export interface PanelView {
  phase: Phase
  server: string
  version: string | null
  /** Scenes in the library now. */
  count: number
  /** Scenes the selection matches in Stash (more than `count` past playhound's limit). */
  total: number
  which: string
  lastOk: number | null
  nextAt: number | null
  progress: { got: number, total: number } | null
  error: string | null
  problems: string[]
  thumbs: { done: number, of: number } | null
  test: { busy: boolean, ok?: boolean, text?: string } | null
}

export interface PanelActions {
  refresh: () => void
  test: () => void
  settings: () => void
}

const ICON_REFRESH = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13.5 8a5.5 5.5 0 1 1-1.7-4"/><path d="M12.5 1.5v3h-3"/></svg>'
const ICON_TEST = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8.5l3 3 7-7"/></svg>'
const ICON_OPEN = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 2.5h4.5V7M13.5 2.5 7 9"/><path d="M12 9.5v3a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3"/></svg>'
const ICON_SETTINGS = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M2.5 4.5h11M2.5 11.5h11"/><circle cx="6" cy="4.5" r="1.6" fill="var(--bg-850)"/><circle cx="10.5" cy="11.5" r="1.6" fill="var(--bg-850)"/></svg>'

const n = (x: number) => x.toLocaleString('en-US')

/** "just now", "4 min ago", "2 h ago", or the date. */
export function ago(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000))
  if (s < 45)
    return 'just now'
  if (s < 3600)
    return `${Math.max(1, Math.round(s / 60))} min ago`
  if (s < 86_400)
    return `${Math.round(s / 3600)} h ago`
  return new Date(at).toLocaleString()
}

export function until(at: number, now: number): string {
  const m = Math.max(0, Math.round((at - now) / 60_000))
  return m < 1 ? 'in under a minute' : m < 60 ? `in ${m} min` : `in ${Math.round(m / 60)} h`
}

/** The headline and the line under it. */
export function headline(v: PanelView, now: number): { title: string, sub: string } {
  switch (v.phase) {
    case 'syncing':
      return {
        title: 'Looking at Stash…',
        sub: v.progress && v.progress.total ? `${n(v.progress.got)} of ${n(v.progress.total)} scenes` : v.server,
      }
    case 'online':
      return { title: `Connected${v.version ? ` to Stash ${v.version}` : ''}`, sub: v.server }
    case 'offline':
      return {
        title: 'Stash is offline',
        sub: v.count ? `Its ${n(v.count)} scenes stay in the library, marked offline, from ${v.lastOk ? ago(v.lastOk, now) : 'before'}. They play again once it's back.` : v.server,
      }
    case 'error':
      return { title: 'Not connected', sub: v.server }
    default:
      return { title: 'Not connected yet', sub: v.server }
  }
}

function button(label: string, icon: string, onClick: () => void, opts: { primary?: boolean, disabled?: boolean } = {}) {
  const b = document.createElement('button')
  b.type = 'button'
  b.className = 'phs-btn'
  b.innerHTML = icon
  b.append(label)
  if (opts.primary)
    b.dataset.primary = ''
  b.disabled = !!opts.disabled
  b.addEventListener('click', onClick)
  return b
}

export function renderPanel(el: HTMLElement, v: PanelView, act: PanelActions, now = Date.now()) {
  const root = document.createElement('div')
  root.className = 'phs'

  const status = document.createElement('div')
  status.className = 'phs-status'
  status.dataset.state = v.phase
  status.setAttribute('role', 'status')
  const dot = document.createElement('span')
  dot.className = 'phs-dot'
  const text = document.createElement('div')
  text.className = 'phs-status-text'
  const h = headline(v, now)
  const b = document.createElement('b')
  b.textContent = h.title
  const sub = document.createElement('span')
  sub.textContent = h.sub
  text.append(b, sub)
  status.append(dot, text)
  root.append(status)

  if (v.error) {
    const err = document.createElement('p')
    err.className = 'phs-error'
    err.setAttribute('role', 'alert')
    const t = document.createElement('b')
    t.textContent = v.phase === 'offline' ? 'Can\'t reach it' : 'What went wrong'
    err.append(t, v.error)
    root.append(err)
  }

  const facts = document.createElement('dl')
  facts.className = 'phs-facts'
  const fact = (k: string, val: string) => {
    const dt = document.createElement('dt')
    dt.textContent = k
    const dd = document.createElement('dd')
    dd.textContent = val
    facts.append(dt, dd)
  }
  fact('Scenes', v.count === v.total || !v.total ? `${n(v.count)} in the library` : `${n(v.count)} in the library, of ${n(v.total)}`)
  fact('Which', v.which)
  fact('Last looked', v.lastOk ? ago(v.lastOk, now) : 'never')
  fact('Next', v.nextAt ? until(v.nextAt, now) : 'when you ask')
  if (v.thumbs && v.thumbs.done < v.thumbs.of)
    fact('Pictures', `${n(v.thumbs.done)} of ${n(v.thumbs.of)}`)
  root.append(facts)

  if (v.problems.length) {
    const p = document.createElement('p')
    p.className = 'phs-problems'
    p.textContent = `${n(v.problems.length)} left out by playhound: ${v.problems.slice(0, 2).join('; ')}${v.problems.length > 2 ? '…' : ''}`
    root.append(p)
  }

  const actions = document.createElement('div')
  actions.className = 'phs-actions'
  actions.append(
    button(v.phase === 'syncing' ? 'Looking…' : 'Look again', ICON_REFRESH, act.refresh, { primary: true, disabled: v.phase === 'syncing' }),
    button(v.test?.busy ? 'Testing…' : 'Test connection', ICON_TEST, act.test, { disabled: !!v.test?.busy }),
  )
  if (/^https?:\/\//.test(v.server)) {
    const a = document.createElement('a')
    a.className = 'phs-btn'
    a.href = v.server
    a.target = '_blank'
    a.rel = 'noopener noreferrer'
    a.innerHTML = ICON_OPEN
    a.append('Open Stash')
    actions.append(a)
  }
  actions.append(button('Settings', ICON_SETTINGS, act.settings))
  root.append(actions)

  if (v.test && !v.test.busy && v.test.text) {
    const t = document.createElement('p')
    t.className = 'phs-note'
    t.dataset.tone = v.test.ok ? 'ok' : 'bad'
    t.textContent = v.test.text
    root.append(t)
  }

  el.replaceChildren(root)
}
