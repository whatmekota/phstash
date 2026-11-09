import type { StashScene } from '../src/graphql.ts'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { playsDirectly, sceneTitle, sceneToVideo } from '../src/map.ts'

const SERVER = 'http://stash.lan:9999'

function scene(over: Partial<StashScene> = {}): StashScene {
  return {
    id: '42',
    title: 'Sunset run',
    interactive: true,
    updated_at: '2026-11-01T10:00:00Z',
    files: [{ basename: 'sunset_run.mp4', duration: 754.2, format: 'mp4', video_codec: 'h264' }],
    scene_markers: [
      { title: 'Finale', seconds: 600, end_seconds: 700, primary_tag: { name: 'Climax' } },
      { title: '', seconds: 30, primary_tag: { name: 'Intro' } },
    ],
    tags: [{ name: 'Outdoor' }, { name: 'POV' }],
    performers: [{ name: 'Ava' }, { name: 'pov' }],
    studio: { name: 'Synthetic Studio' },
    ...over,
  }
}

describe('a scene as a library video', () => {
  it('maps everything a video needs', () => {
    const v = sceneToVideo(scene(), { server: SERVER, stream: 'auto', peopleAsTags: true })
    assert.deepEqual(v, {
      id: '42',
      title: 'Sunset run',
      url: `${SERVER}/scene/42/stream`,
      kind: 'file',
      scripts: [{ url: `${SERVER}/scene/42/funscript` }],
      // POV and pov are one tag.
      tags: ['Outdoor', 'POV', 'Ava', 'Synthetic Studio'],
      chapters: [
        { name: 'Intro', start: 30 },
        { name: 'Finale', start: 600, end: 700 },
      ],
      thumbnail: `${SERVER}/scene/42/screenshot?t=1793527200`,
      duration: 754.2,
      sourceUrl: `${SERVER}/scenes/42`,
    })
  })

  it('never puts the API key in a URL: it goes in a header, and the screenshot comes from the fetched ones', () => {
    const thumbs = new Map([['42', 'data:image/jpeg;base64,AAAA']])
    const v = sceneToVideo(scene(), { server: SERVER, headers: { ApiKey: 'sekrit' }, stream: 'auto', peopleAsTags: true, thumbs })
    assert.deepEqual(v.headers, { ApiKey: 'sekrit' })
    assert.equal(v.thumbnail, 'data:image/jpeg;base64,AAAA')
    assert.ok(!JSON.stringify({ ...v, headers: undefined }).includes('sekrit'))
    // Not fetched yet: no thumbnail, rather than one that loads Stash's login page.
    const bare = sceneToVideo(scene(), { server: SERVER, headers: { ApiKey: 'sekrit' }, stream: 'auto', peopleAsTags: true })
    assert.equal(bare.thumbnail, undefined)
  })

  it('has no script for a scene without one', () => {
    assert.deepEqual(sceneToVideo(scene({ interactive: false }), { server: SERVER, stream: 'auto', peopleAsTags: true }).scripts, [])
  })

  it('leaves performers and the studio out of the tags when asked', () => {
    assert.deepEqual(sceneToVideo(scene(), { server: SERVER, stream: 'auto', peopleAsTags: false }).tags, ['Outdoor', 'POV'])
  })

  it('streams Stash\'s MP4 for files a browser won\'t play, or always when asked', () => {
    const wmv = scene({ files: [{ basename: 'old.wmv', duration: 10, format: 'wmv', video_codec: 'wmv2' }] })
    assert.equal(sceneToVideo(wmv, { server: SERVER, stream: 'auto', peopleAsTags: true }).url, `${SERVER}/scene/42/stream.mp4`)
    assert.equal(sceneToVideo(wmv, { server: SERVER, stream: 'direct', peopleAsTags: true }).url, `${SERVER}/scene/42/stream`)
    assert.equal(sceneToVideo(scene(), { server: SERVER, stream: 'mp4', peopleAsTags: true }).url, `${SERVER}/scene/42/stream.mp4`)
    assert.equal(playsDirectly({ basename: 'a.mkv', duration: 1, format: 'matroska', video_codec: 'vp9' }), true)
    assert.equal(playsDirectly({ basename: 'a.avi', duration: 1, format: 'avi', video_codec: 'mpeg4' }), false)
    assert.equal(playsDirectly(undefined), true)
  })

  it('names an untitled scene after its file, or its id', () => {
    assert.equal(sceneTitle(scene({ title: '  ' })), 'sunset_run')
    assert.equal(sceneTitle(scene({ title: null, files: [] })), 'Scene 42')
  })

  it('leaves out the length and markers it can\'t use', () => {
    const v = sceneToVideo(scene({ files: [], scene_markers: [{ title: 'bad', seconds: Number.NaN }, { title: 'x', seconds: 5, end_seconds: 2 }] }), { server: SERVER, stream: 'auto', peopleAsTags: true })
    assert.equal(v.duration, undefined)
    assert.deepEqual(v.chapters, [{ name: 'x', start: 5 }])
  })

  it('keeps ids as they are and makes them safe in a path', () => {
    const v = sceneToVideo(scene({ id: 'a/b' }), { server: SERVER, stream: 'auto', peopleAsTags: true })
    assert.equal(v.id, 'a/b')
    assert.equal(v.url, `${SERVER}/scene/a%2Fb/stream`)
  })
})
