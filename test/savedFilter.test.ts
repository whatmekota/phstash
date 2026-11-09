import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { translateSavedFilter } from '../src/graphql.ts'

// Saved criteria as Stash's UI writes them (ui/v2.5/src/models/list-filter/criteria/criterion.ts).
describe('saved filters', () => {
  it('turns tag-like criteria into hierarchical ones', () => {
    const out = translateSavedFilter({
      tags: { modifier: 'INCLUDES_ALL', value: { items: [{ id: '3', label: 'Beach' }, { id: '9', label: 'POV' }], excluded: [{ id: '4', label: 'Old' }], depth: -1 } },
      studios: { modifier: 'EQUALS', value: { items: [{ id: '2', label: 'S' }], excluded: [], depth: -1 } },
    })
    assert.deepEqual(out.tags, { value: ['3', '9'], excludes: ['4'], modifier: 'INCLUDES_ALL', depth: -1 })
    // "equals" can't reach into sub-studios.
    assert.deepEqual(out.studios, { value: ['2'], excludes: [], modifier: 'EQUALS', depth: 0 })
  })

  it('turns a list of labelled ids into a multi criterion', () => {
    assert.deepEqual(
      translateSavedFilter({ performers: { modifier: 'INCLUDES', value: [{ id: '7', label: 'A' }, { id: '8', label: 'B' }] } }),
      { performers: { value: ['7', '8'], modifier: 'INCLUDES' } },
    )
  })

  it('turns booleans saved as text into booleans, and keeps plain strings plain', () => {
    assert.deepEqual(
      translateSavedFilter({
        organized: { modifier: 'EQUALS', value: 'false' },
        interactive: { modifier: 'EQUALS', value: 'true' },
        has_markers: { modifier: 'EQUALS', value: 'true' },
        is_missing: { modifier: 'EQUALS', value: 'cover' },
      }),
      { organized: false, interactive: true, has_markers: 'true', is_missing: 'cover' },
    )
  })

  it('flattens ranges', () => {
    assert.deepEqual(
      translateSavedFilter({
        rating100: { modifier: 'GREATER_THAN', value: { value: 60 } },
        duration: { modifier: 'BETWEEN', value: { value: 60, value2: 600 } },
        date: { modifier: 'LESS_THAN', value: { value: '2024-01-01', value2: null } },
        o_counter: { modifier: 'EQUALS', value: 2 },
      }),
      {
        rating100: { modifier: 'GREATER_THAN', value: 60 },
        duration: { modifier: 'BETWEEN', value: 60, value2: 600 },
        date: { modifier: 'LESS_THAN', value: '2024-01-01' },
        o_counter: { modifier: 'EQUALS', value: 2 },
      },
    )
  })

  it('keeps strings, and maps resolution and orientation to Stash\'s enums', () => {
    assert.deepEqual(
      translateSavedFilter({
        title: { modifier: 'INCLUDES', value: 'cut' },
        resolution: { modifier: 'GREATER_THAN', value: '1080p' },
        orientation: { modifier: 'EQUALS', value: ['Landscape', 'Square'] },
      }),
      {
        title: { modifier: 'INCLUDES', value: 'cut' },
        resolution: { modifier: 'GREATER_THAN', value: 'FULL_HD' },
        orientation: { value: ['LANDSCAPE', 'SQUARE'] },
      },
    )
  })

  it('passes through what is already a query criterion, and survives nothing', () => {
    assert.deepEqual(translateSavedFilter({ interactive: true, tags_filter: { name: { value: 'x', modifier: 'EQUALS' } } }), { interactive: true, tags_filter: { name: { value: 'x', modifier: 'EQUALS' } } })
    assert.deepEqual(translateSavedFilter(null), {})
    assert.deepEqual(translateSavedFilter('nope'), {})
  })
})
