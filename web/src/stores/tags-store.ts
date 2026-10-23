import { create } from 'zustand'
import { api, type Tag } from '@/lib/api'

// The user's tags, shared by every tag picker and Settings → Tags, so a tag
// created, renamed or deleted in one place shows everywhere at once.
interface TagsState {
  tags: Tag[]
  loaded: boolean
  /** Fetch the tags again. */
  load: () => Promise<void>
  /** Fetch them once, for the first picker on the page. */
  ensure: () => Promise<void>
}

export const useTagsStore = create<TagsState>()((set, get) => ({
  tags: [],
  loaded: false,
  load: async () => {
    const res = await api.listTags()
    set({ tags: res.items, loaded: true })
  },
  ensure: async () => {
    if (get().loaded) return
    // Marked first so pickers mounting together fetch once.
    set({ loaded: true })
    await get()
      .load()
      .catch(() => set({ loaded: false }))
  },
}))
