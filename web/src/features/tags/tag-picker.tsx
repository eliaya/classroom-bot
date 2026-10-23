import { useState } from 'react'
import { CheckIcon, PlusIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
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
import { useAssignedTags } from './use-assigned-tags'

type TagPickerProps = {
  /** What the tags are put on: "page:/calendar", "course:<id>", "post:<type>:<id>",
   *  "mail:<thread id>" or "event:<id>". */
  target: string
  className?: string
}

/** shadcnblocks tags-multi-1: the tags on `target`, removable, with a list to
 *  add more and create a new one. Tags are renamed and deleted in Settings. */
export function TagPicker({ target, className }: TagPickerProps) {
  const { t } = useTranslation()
  const { tags, ids, selected, toggle, create } = useAssignedTags(target)
  const [query, setQuery] = useState('')
  const name = query.trim()
  const exists = tags.some((tag) => tag.name.toLowerCase() === name.toLowerCase())

  const createTag = async () => {
    if (!name || exists) return
    if (await create(name)) setQuery('')
  }

  const menu = (
    <>
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
    </>
  )
  const values = selected.map((tag) => (
    <TagsValue key={tag.id} onRemove={() => toggle(tag.id)}>
      {tag.name}
    </TagsValue>
  ))

  return (
    <Tags className={cn('tags-multi', className)}>
      <TagsTrigger placeholder={t('tags.select')} aria-label={t('tags.label')}>
        {values}
      </TagsTrigger>
      <TagsContent className='tags-multi'>{menu}</TagsContent>
    </Tags>
  )
}
