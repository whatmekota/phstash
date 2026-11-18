import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ACHIEVEMENTS, emptyFeats, readFeats, standing } from '../src/achievements.ts'

describe('achievements', () => {
  it('are well formed', () => {
    const ids = ACHIEVEMENTS.map(a => a.id)
    assert.equal(new Set(ids).size, ids.length)
    for (const a of ACHIEVEMENTS) {
      assert.match(a.id, /^[a-z0-9-]+$/)
      assert.ok(a.icon && a.title && !a.description.endsWith('.'), a.id)
    }
    // standing() counts exactly the counted ones, and with everything done earns exactly the rest.
    const counted = ACHIEVEMENTS.filter(a => a.target).map(a => a.id).sort()
    const all = standing({ linked: true, played: ['1'], plays: 1, os: 1 })
    assert.deepEqual(Object.keys(all.progress).sort(), counted)
    assert.deepEqual(all.earned.sort(), ids.filter(id => !counted.includes(id)).sort())
    assert.deepEqual(standing(emptyFeats()).earned, [])
  })

  it('count different scenes played, up to each target', () => {
    const played = Array.from({ length: 60 }, (_, i) => String(i))
    assert.deepEqual(standing({ ...emptyFeats(), played }).progress, { 'scenes-10': 10, 'scenes-50': 50, 'scenes-200': 60 })
  })

  it('read back whatever was stored', () => {
    assert.deepEqual(readFeats(undefined), emptyFeats())
    assert.deepEqual(readFeats({ linked: true, played: ['4', '4', 7, '9'], plays: 3.5, os: -1 }), { linked: true, played: ['4', '9'], plays: 3, os: 0 })
  })
})
