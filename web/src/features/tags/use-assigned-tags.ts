import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useTagsStore } from '@/stores/tags-store'
import { api } from '@/lib/api'

/** The user's tags, which of them are on `target`, and toggling one on or off
 *  (saved at once; a failure puts the old set back). */
export function useAssignedTags(target: string) {
  const { t } = useTranslation()
  const tags = useTagsStore((s) => s.tags)
  const ensure = useTagsStore((s) => s.ensure)
  const load = useTagsStore((s) => s.load)
  const [assigned, setAssigned] = useState<{ target: string; ids: number[] } | null>(null)

  useEffect(() => {
    void ensure()
  }, [ensure])

  useEffect(() => {
    let live = true
    api
      .getAssignedTags(target)
      .then((res) => live && setAssigned({ target, ids: res.tag_ids }))
      .catch(() => live && setAssigned({ target, ids: [] }))
    return () => {
      live = false
    }
  }, [target])

  const ids = assigned?.target === target ? assigned.ids : []
  const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : t('common.saveFailed'))

  const save = (next: number[]) => {
    setAssigned({ target, ids: next })
    api.setAssignedTags(target, next).catch((e) => {
      fail(e)
      setAssigned({ target, ids })
    })
  }

  const toggle = (id: number) => save(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id])

  /** Create a tag by name and put it on `target`. */
  const create = async (name: string) => {
    try {
      const tag = await api.createTag(name)
      save([...ids, tag.id])
      await load()
      return true
    } catch (e) {
      fail(e)
      return false
    }
  }

  // A tag deleted in Settings drops out, as it is no longer in the store.
  return { tags, ids, selected: tags.filter((tag) => ids.includes(tag.id)), toggle, create }
}
