import { useEffect, useState } from 'react'
import { CheckIcon, PlusIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useTagsStore } from '@/stores/tags-store'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import {
  Tags,
  TagsContent,
  TagsEmpty,
  TagsGroup,
  TagsInput,
  TagsItem,
  TagsList,
  TagsTrigger,
  TagsValue,
} from '@/components/ui/tags'

type TagPickerProps = {
  /** What the tags are put on: "page:/mail", "course:<id>", "post:<type>:<id>",
   *  "mail:<thread id>" or "event:<id>". */
  target: string
  className?: string
}

/** shadcnblocks tags-multi-1: the tags on `target`, removable, with a list to
 *  add more and create a new one. Tags are renamed and deleted in Settings. */
export function TagPicker({ target, className }: TagPickerProps) {
  const { t } = useTranslation()
  const tags = useTagsStore((s) => s.tags)
  const ensure = useTagsStore((s) => s.ensure)
  const load = useTagsStore((s) => s.load)
  const [assigned, setAssigned] = useState<{
    target: string
    ids: number[]
  } | null>(null)
  const [query, setQuery] = useState('')

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
  // A tag deleted in Settings drops out here, as it is no longer in the store.
  const selected = tags.filter((tag) => ids.includes(tag.id))
  const name = query.trim()
  const exists = tags.some(
    (tag) => tag.name.toLowerCase() === name.toLowerCase()
  )

  const fail = (e: unknown) =>
    toast.error(e instanceof Error ? e.message : t('common.saveFailed'))

  const save = (next: number[]) => {
    setAssigned({ target, ids: next })
    api.setAssignedTags(target, next).catch((e) => {
      fail(e)
      setAssigned({ target, ids })
    })
  }

  const toggle = (id: number) =>
    save(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id])

  const createTag = async () => {
    if (!name || exists) return
    try {
      const tag = await api.createTag(name)
      setQuery('')
      save([...ids, tag.id])
      await load()
    } catch (e) {
      fail(e)
    }
  }

  return (
    <Tags className={cn('tags-multi', className)}>
      <TagsTrigger placeholder={t('tags.select')} aria-label={t('tags.label')}>
        {selected.map((tag) => (
          <TagsValue key={tag.id} onRemove={() => toggle(tag.id)}>
            {tag.name}
          </TagsValue>
        ))}
      </TagsTrigger>
      <TagsContent className='tags-multi'>
        <TagsInput
          placeholder={t('tags.search')}
          value={query}
          onValueChange={setQuery}
        />
        <TagsList>
          {!name && <TagsEmpty>{t('tags.empty')}</TagsEmpty>}
          <TagsGroup>
            {tags.map((tag) => (
              <TagsItem
                key={tag.id}
                value={tag.name}
                onSelect={() => toggle(tag.id)}
              >
                {tag.name}
                {ids.includes(tag.id) && (
                  <CheckIcon className='text-muted-foreground' size={14} />
                )}
              </TagsItem>
            ))}
          </TagsGroup>
          {/* Its own group: cmdk hides a group with no match, forced items too. */}
          {name && !exists && (
            <TagsGroup forceMount>
              <TagsItem
                forceMount
                value={`create:${name}`}
                onSelect={() => void createTag()}
              >
                <span className='flex items-center gap-2'>
                  <PlusIcon className='text-muted-foreground' size={14} />
                  {t('tags.create', { name })}
                </span>
              </TagsItem>
            </TagsGroup>
          )}
        </TagsList>
      </TagsContent>
    </Tags>
  )
}
