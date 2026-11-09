/**
 * Telling Stash what happened, when the user switched it on: a play once a
 * scene has played for a while, and an O when they mark "I came" during it
 * (Stash's sceneAddPlay and sceneAddO, 0.25+).
 *
 * playhound names a provided video `<plugin id>:<source id>` while it plays
 * (player.state().title), which is how a play is matched to its scene.
 */

/** A play counts after this much playing (not paused), like a glance shouldn't. */
export const PLAY_AFTER_MS = 10_000

/** The scene id of what plays, if it's one of ours. */
export function sceneIdOf(title: string | null | undefined, pluginId: string): string | null {
  const prefix = `${pluginId}:`
  return title && title.startsWith(prefix) && title.length > prefix.length ? title.slice(prefix.length) : null
}

interface Clock {
  now: () => number
  setTimeout: (fn: () => void, ms: number) => unknown
  clearTimeout: (t: unknown) => void
}

const realClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: t => clearTimeout(t as ReturnType<typeof setTimeout>),
}

/**
 * Counts how long each scene plays, and calls `onPlayed(id)` once per time
 * it is put on, when it has played PLAY_AFTER_MS.
 */
export function createPlayTracker(onPlayed: (sceneId: string) => void, clock: Clock = realClock) {
  let scene: string | null = null
  let playedMs = 0
  let since: number | null = null
  let counted = false
  let timer: unknown = null

  function stopTimer() {
    if (timer !== null)
      clock.clearTimeout(timer)
    timer = null
  }

  function fire() {
    timer = null
    if (counted || !scene)
      return
    counted = true
    onPlayed(scene)
  }

  return {
    /** What the player says: which scene (or null for something else) and whether it plays. */
    update(next: string | null, playing: boolean) {
      if (next !== scene) {
        stopTimer()
        scene = next
        playedMs = 0
        since = null
        counted = false
      }
      if (!scene || counted)
        return
      if (playing && since === null) {
        since = clock.now()
        timer = clock.setTimeout(fire, Math.max(0, PLAY_AFTER_MS - playedMs))
      }
      else if (!playing && since !== null) {
        playedMs += clock.now() - since
        since = null
        stopTimer()
      }
    },
    dispose() {
      stopTimer()
      scene = null
    },
  }
}
