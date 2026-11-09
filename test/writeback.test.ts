import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createPlayTracker, PLAY_AFTER_MS, sceneIdOf } from '../src/writeback.ts'

/** A clock and timers to move by hand. */
function manualClock() {
  let now = 0
  let timers: { at: number, fn: () => void, id: number }[] = []
  let next = 1
  return {
    now: () => now,
    setTimeout: (fn: () => void, ms: number) => {
      const id = next++
      timers.push({ at: now + ms, fn, id })
      return id
    },
    clearTimeout: (id: unknown) => {
      timers = timers.filter(t => t.id !== id)
    },
    advance(ms: number) {
      now += ms
      for (const t of timers.filter(t => t.at <= now)) {
        timers = timers.filter(x => x !== t)
        t.fn()
      }
    },
  }
}

describe('which scene plays', () => {
  it('is read from playhound\'s name for a provided video', () => {
    assert.equal(sceneIdOf('phstash:42', 'phstash'), '42')
    assert.equal(sceneIdOf('phstash:', 'phstash'), null)
    assert.equal(sceneIdOf('clip.mp4', 'phstash'), null)
    assert.equal(sceneIdOf('other:42', 'phstash'), null)
    assert.equal(sceneIdOf(null, 'phstash'), null)
  })
})

describe('counting plays', () => {
  it('counts a scene once it has played long enough, pauses not counting', () => {
    const clock = manualClock()
    const played: string[] = []
    const t = createPlayTracker(id => played.push(id), clock)
    t.update('1', true)
    clock.advance(PLAY_AFTER_MS - 4000)
    t.update('1', false)
    clock.advance(60_000)
    assert.deepEqual(played, [])
    t.update('1', true)
    clock.advance(3999)
    assert.deepEqual(played, [])
    clock.advance(1)
    assert.deepEqual(played, ['1'])
    // Once per time it's put on.
    t.update('1', false)
    t.update('1', true)
    clock.advance(PLAY_AFTER_MS * 2)
    assert.deepEqual(played, ['1'])
  })

  it('starts over for another scene, and ignores what isn\'t one', () => {
    const clock = manualClock()
    const played: string[] = []
    const t = createPlayTracker(id => played.push(id), clock)
    t.update('1', true)
    clock.advance(PLAY_AFTER_MS - 1)
    t.update('2', true)
    clock.advance(PLAY_AFTER_MS - 1)
    t.update(null, true)
    clock.advance(PLAY_AFTER_MS * 3)
    assert.deepEqual(played, [])
    t.update('2', true)
    clock.advance(PLAY_AFTER_MS)
    assert.deepEqual(played, ['2'])
  })

  it('stops when disposed', () => {
    const clock = manualClock()
    const played: string[] = []
    const t = createPlayTracker(id => played.push(id), clock)
    t.update('1', true)
    t.dispose()
    clock.advance(PLAY_AFTER_MS * 2)
    assert.deepEqual(played, [])
  })
})
