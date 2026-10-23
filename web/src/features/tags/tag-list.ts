import type { Tag } from '@/lib/api'

export type TagSort = 'recent' | 'name' | 'count'
export type TagOrder = 'asc' | 'desc'
/** How the Dashboard lists the tags: sorted by, in which order, and how many (0: all). */
export type TagListPrefs = { sort: TagSort; order: TagOrder; limit: number }

export const TAG_SORTS: readonly TagSort[] = ['recent', 'name', 'count']
export const TAG_LIMITS = [5, 10, 20, 0] as const
const DEFAULT: TagListPrefs = { sort: 'recent', order: 'desc', limit: 10 }

// Per-device, like the dashboard's other choices.
const KEY = 'dashboard-tag-list'

export function loadTagPrefs(): TagListPrefs {
  try {
    const saved = JSON.parse(
      localStorage.getItem(KEY) ?? 'null'
    ) as Partial<TagListPrefs> | null
    return {
      sort: TAG_SORTS.includes(saved?.sort as TagSort)
        ? (saved!.sort as TagSort)
        : DEFAULT.sort,
      order:
        saved?.order === 'asc' || saved?.order === 'desc'
          ? saved.order
          : DEFAULT.order,
      limit: (TAG_LIMITS as readonly number[]).includes(saved?.limit as number)
        ? saved!.limit!
        : DEFAULT.limit,
    }
  } catch {
    return DEFAULT
  }
}

export function saveTagPrefs(prefs: TagListPrefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs))
  } catch {
    // private mode: the choice lasts for this visit only
  }
}

/** The tags to list: sorted, ordered, then cut to the limit. */
export function listTags(
  tags: Tag[],
  { sort, order, limit }: TagListPrefs
): Tag[] {
  const by = (a: Tag, b: Tag) =>
    sort === 'name'
      ? a.name.localeCompare(b.name)
      : sort === 'count'
        ? a.count - b.count
        : a.created_at.localeCompare(b.created_at)
  const sorted = [...tags].sort(
    (a, b) =>
      (order === 'asc' ? by(a, b) : by(b, a)) || a.name.localeCompare(b.name)
  )
  return limit ? sorted.slice(0, limit) : sorted
}
