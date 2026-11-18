/**
 * The plugin's own achievements (plugin API 7), in Stats → Achievements
 * under its name: bringing Stash in, playing its scenes, and telling Stash.
 * Worked out from a few counts kept in the plugin's storage, and synced at
 * start and after each change. A scene list kept from before 0.2.0 counts
 * as brought in; plays are counted from 0.2.0 on.
 */

import type { PluginAchievement, PluginContext } from './types'

export const ACHIEVEMENTS: PluginAchievement[] = [
  { id: 'linked-up', title: 'Stash on board', description: 'Bring your Stash scenes into playhound\'s library', icon: '📦', tier: 1 },
  { id: 'scenes-10', title: 'Stash regular', description: 'Play 10 different scenes from Stash', icon: '🎬', target: 10, tier: 1 },
  { id: 'scenes-50', title: 'Deep in the stash', description: 'Play 50 different scenes from Stash', icon: '🍿', target: 50, tier: 2 },
  { id: 'scenes-200', title: 'Seen it all', description: 'Play 200 different scenes from Stash', icon: '🏛️', target: 200, tier: 3 },
  { id: 'wrote-play', title: 'Keeping score', description: 'Have a play counted in Stash', icon: '📝', tier: 1 },
  { id: 'wrote-o', title: 'On the record', description: 'Have an O counted in Stash', icon: '💦', tier: 1 },
]

/** The counts kept for them. */
export interface Feats {
  /** Stash's scenes have reached the library. */
  linked: boolean
  /** Scenes played for 10 seconds or more, each once. */
  played: string[]
  /** Plays and O's that Stash took. */
  plays: number
  os: number
}

export const emptyFeats = (): Feats => ({ linked: false, played: [], plays: 0, os: 0 })

/** A stored value read back as feats, whatever it holds. */
export function readFeats(raw: unknown): Feats {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const count = (v: unknown) => (Number.isFinite(v) && (v as number) > 0 ? Math.floor(v as number) : 0)
  return {
    linked: r.linked === true,
    played: Array.isArray(r.played) ? [...new Set(r.played.filter((id): id is string => typeof id === 'string'))] : [],
    plays: count(r.plays),
    os: count(r.os),
  }
}

const targetOf = new Map(ACHIEVEMENTS.filter(a => a.target).map(a => [a.id, a.target!]))

/** The count for each counted achievement (at most its target), and the others that are earned. */
export function standing(f: Feats): { progress: Record<string, number>, earned: string[] } {
  const counts: Record<string, number> = {
    'scenes-10': f.played.length,
    'scenes-50': f.played.length,
    'scenes-200': f.played.length,
  }
  const progress: Record<string, number> = {}
  for (const [id, n] of Object.entries(counts))
    progress[id] = Math.min(n, targetOf.get(id) ?? n)
  const done: Record<string, boolean> = {
    'linked-up': f.linked,
    'wrote-play': f.plays > 0,
    'wrote-o': f.os > 0,
  }
  return { progress, earned: Object.keys(done).filter(id => done[id]) }
}

/**
 * Declares the achievements, and sync() hands over only what changed since
 * it last did. A failure is logged, never thrown: achievements must not get
 * in the way of the library.
 */
export function createTrophies(api: PluginContext['achievements'] | undefined, log: (...args: unknown[]) => void = () => {}) {
  if (!api)
    return { sync: (_f: Feats) => {} }
  try {
    api.define(ACHIEVEMENTS)
  }
  catch (err) {
    log('declaring the achievements failed', err)
  }
  const sent = new Map<string, number>()
  return {
    sync(f: Feats) {
      const now = standing(f)
      try {
        for (const [id, n] of Object.entries(now.progress)) {
          if (sent.get(id) !== n) {
            sent.set(id, n)
            api.progress(id, n)
          }
        }
        for (const id of now.earned) {
          if (!sent.has(id)) {
            sent.set(id, 1)
            api.unlock(id)
          }
        }
      }
      catch (err) {
        log('updating the achievements failed', err)
      }
    },
  }
}
