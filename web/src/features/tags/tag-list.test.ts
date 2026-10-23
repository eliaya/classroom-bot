import { describe, expect, it } from 'vitest'
import type { Tag } from '@/lib/api'
import { listTags, loadTagPrefs, saveTagPrefs } from './tag-list'

const tag = (
  id: number,
  name: string,
  created_at: string,
  count: number
): Tag => ({
  id,
  name,
  color: null,
  created_at,
  count,
})
const TAGS = [
  tag(1, 'b', '2026-10-01', 3),
  tag(2, 'a', '2026-10-03', 1),
  tag(3, 'c', '2026-10-02', 3),
]
const names = (tags: Tag[]) => tags.map((t) => t.name).join('')

describe('listTags', () => {
  it('sorts, orders and limits', () => {
    expect(
      names(listTags(TAGS, { sort: 'recent', order: 'desc', limit: 0 }))
    ).toBe('acb')
    expect(
      names(listTags(TAGS, { sort: 'recent', order: 'desc', limit: 2 }))
    ).toBe('ac')
    expect(
      names(listTags(TAGS, { sort: 'name', order: 'asc', limit: 0 }))
    ).toBe('abc')
    // Equal counts fall back to the name.
    expect(
      names(listTags(TAGS, { sort: 'count', order: 'desc', limit: 0 }))
    ).toBe('bca')
    expect(
      names(listTags(TAGS, { sort: 'count', order: 'asc', limit: 0 }))
    ).toBe('abc')
  })

  it('remembers the choice and ignores a broken one', () => {
    saveTagPrefs({ sort: 'name', order: 'asc', limit: 5 })
    expect(loadTagPrefs()).toEqual({ sort: 'name', order: 'asc', limit: 5 })
    localStorage.setItem('dashboard-tag-list', '{"sort":"x","limit":7}')
    expect(loadTagPrefs()).toEqual({ sort: 'recent', order: 'desc', limit: 10 })
  })
})
