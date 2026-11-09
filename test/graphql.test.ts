import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { atLeast, featuresOf, pageFilter, parseVersion, sceneVariables, scenesQuery, SelectionError } from '../src/graphql.ts'

describe('versions', () => {
  it('reads Stash\'s version strings', () => {
    assert.deepEqual(parseVersion('v0.32.0'), [0, 32, 0])
    assert.deepEqual(parseVersion('v0.28.1-4-gabc123'), [0, 28, 1])
    assert.deepEqual(parseVersion('0.25'), [0, 25, 0])
    assert.equal(parseVersion(null), null)
    assert.equal(parseVersion(''), null)
  })

  it('compares them', () => {
    assert.equal(atLeast([0, 25, 0], [0, 25, 0]), true)
    assert.equal(atLeast([0, 24, 3], [0, 25, 0]), false)
    assert.equal(atLeast([1, 0, 0], [0, 25, 0]), true)
    assert.equal(atLeast([0, 25, 1], [0, 26, 0]), false)
  })

  it('asks for marker ends only from 0.28, and from a build that doesn\'t say', () => {
    assert.match(scenesQuery(featuresOf([0, 28, 0])), /seconds end_seconds/)
    assert.match(scenesQuery(featuresOf(null)), /end_seconds/)
    assert.doesNotMatch(scenesQuery(featuresOf([0, 27, 1])), /end_seconds/)
  })
})

describe('the scenes query', () => {
  it('is one named query taking a find filter and a scene filter', () => {
    const q = scenesQuery({ markerEnd: true })
    assert.match(q, /^query PhstashScenes\(\$filter: FindFilterType, \$scene_filter: SceneFilterType\)/)
    for (const field of ['count', 'interactive', 'files { basename duration format video_codec }', 'tags { name }', 'performers { name }', 'studio { name }', 'updated_at'])
      assert.ok(q.includes(field), field)
    // The URLs are built by phstash; paths would carry the API key.
    assert.doesNotMatch(q, /paths/)
  })

  it('pages in a stable order', () => {
    assert.deepEqual(pageFilter(3, 250), { page: 3, per_page: 250, sort: 'id', direction: 'ASC' })
    assert.deepEqual(pageFilter(1, 50, 'beach'), { page: 1, per_page: 50, sort: 'id', direction: 'ASC', q: 'beach' })
  })
})

describe('which scenes', () => {
  it('takes only the ones with a script by default', () => {
    assert.deepEqual(sceneVariables({ scope: 'all', interactiveOnly: true }), { scene_filter: { interactive: true } })
  })

  it('takes everything with no filter at all', () => {
    assert.deepEqual(sceneVariables({ scope: 'all', interactiveOnly: false }), {})
  })

  it('takes a tag, with or without its sub-tags', () => {
    assert.deepEqual(sceneVariables({ scope: 'tag', tagId: '12', subTags: true, interactiveOnly: true }), {
      scene_filter: { tags: { value: ['12'], modifier: 'INCLUDES', depth: -1 }, interactive: true },
    })
    assert.deepEqual(sceneVariables({ scope: 'tag', tagId: '12', subTags: false, interactiveOnly: false }), {
      scene_filter: { tags: { value: ['12'], modifier: 'INCLUDES', depth: 0 } },
    })
  })

  it('says so when no tag or filter is picked', () => {
    assert.throws(() => sceneVariables({ scope: 'tag', interactiveOnly: true }), SelectionError)
    assert.throws(() => sceneVariables({ scope: 'filter', interactiveOnly: true }), /saved filter/)
  })

  it('takes a saved filter\'s criteria and search, and still only scenes with a script', () => {
    const v = sceneVariables({
      scope: 'filter',
      interactiveOnly: true,
      saved: {
        find_filter: { q: ' beach ' },
        object_filter: { organized: { modifier: 'EQUALS', value: 'true' } },
      },
    })
    assert.deepEqual(v, { scene_filter: { organized: true, interactive: true }, q: 'beach' })
  })
})
