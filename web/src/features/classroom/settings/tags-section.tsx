import { useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useTagsStore } from '@/stores/tags-store'
import { api, type Tag } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ConfirmDialog } from '@/components/confirm-dialog'

/** The user's tags: create, rename and delete them. They are put on pages,
 *  courses, posts, mail and events from the tag picker on each page. */
export function TagsSection() {
  const { t } = useTranslation()
  const tags = useTagsStore((s) => s.tags)
  const load = useTagsStore((s) => s.load)
  const [newName, setNewName] = useState('')
  const [deleting, setDeleting] = useState<Tag | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    // Fresh counts: pickers change them without reloading the store.
    load().catch((e) =>
      setMsg(e instanceof Error ? e.message : t('common.loadFailed'))
    )
  }, [load, t])

  // Every change is saved at once; a failure reloads what the server holds.
  const run = async (action: () => Promise<unknown>, ok: string) => {
    setMsg(null)
    try {
      await action()
      setMsg(ok)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : t('common.saveFailed'))
    }
    await load().catch(() => {})
  }

  const create = () => {
    const name = newName.trim()
    if (!name) return
    setNewName('')
    void run(() => api.createTag(name), t('common.created'))
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.tags.title')}</CardTitle>
        <CardDescription>{t('settings.tags.desc')}</CardDescription>
      </CardHeader>
      <CardContent className='space-y-4'>
        <form
          className='flex flex-wrap items-end gap-3'
          onSubmit={(e) => {
            e.preventDefault()
            create()
          }}
        >
          <div className='space-y-1'>
            <Label htmlFor='new-tag-name'>{t('settings.tags.newTag')}</Label>
            <Input
              id='new-tag-name'
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              maxLength={64}
              className='w-56'
            />
          </div>
          <Button type='submit' disabled={!newName.trim()}>
            {t('settings.tags.create')}
          </Button>
        </form>
        {msg && <p className='text-xs text-muted-foreground'>{msg}</p>}

        {tags.length === 0 ? (
          <p className='text-sm text-muted-foreground'>
            {t('settings.tags.none')}
          </p>
        ) : (
          <ul className='divide-y rounded-md border'>
            {tags.map((tag) => (
              <TagRow
                key={`${tag.id}:${tag.name}`}
                tag={tag}
                onRename={(name) =>
                  void run(() => api.renameTag(tag.id, name), t('common.saved'))
                }
                onDelete={() => setDeleting(tag)}
              />
            ))}
          </ul>
        )}
      </CardContent>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        destructive
        title={t('settings.tags.deleteTitle', { name: deleting?.name ?? '' })}
        desc={t('settings.tags.deleteDesc', { count: deleting?.count ?? 0 })}
        confirmText={t('settings.tags.delete')}
        handleConfirm={() => {
          const tag = deleting
          setDeleting(null)
          if (tag) void run(() => api.deleteTag(tag.id), t('common.deleted'))
        }}
      />
    </Card>
  )
}

function TagRow({
  tag,
  onRename,
  onDelete,
}: {
  tag: Tag
  onRename: (name: string) => void
  onDelete: () => void
}) {
  const { t } = useTranslation()
  const [name, setName] = useState(tag.name)
  const changed = name.trim() !== '' && name.trim() !== tag.name
  return (
    <li className='flex flex-wrap items-center gap-3 p-3'>
      <form
        className='flex min-w-0 flex-1 items-center gap-2'
        onSubmit={(e) => {
          e.preventDefault()
          if (changed) onRename(name.trim())
        }}
      >
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={64}
          aria-label={t('settings.tags.name')}
          className='h-8 max-w-56'
        />
        <Button type='submit' size='sm' variant='outline' disabled={!changed}>
          {t('settings.tags.rename')}
        </Button>
      </form>
      <Badge variant='secondary' className='rounded-full'>
        {t('settings.tags.count', { count: tag.count })}
      </Badge>
      <Button
        size='icon'
        variant='ghost'
        className='size-8 text-destructive'
        onClick={onDelete}
        aria-label={t('settings.tags.delete')}
      >
        <Trash2 className='size-4' />
      </Button>
    </li>
  )
}
