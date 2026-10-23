import { useState } from 'react'
import { PlusIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useTagsStore } from '@/stores/tags-store'
import { api, type Tag } from '@/lib/api'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/reui/badge'
import {
  ColorPicker,
  ColorPickerContent,
  ColorPickerSwatch,
  ColorPickerSwatches,
  ColorPickerTrigger,
  getForegroundColor,
} from '@/components/reui/color-picker'

// reui c-color-picker-5's preset label colors.
const TAG_COLORS = [
  { value: '#ef4444', key: 'red' },
  { value: '#f97316', key: 'orange' },
  { value: '#eab308', key: 'yellow' },
  { value: '#22c55e', key: 'green' },
  { value: '#14b8a6', key: 'teal' },
  { value: '#3b82f6', key: 'blue' },
  { value: '#8b5cf6', key: 'violet' },
  { value: '#ec4899', key: 'pink' },
  { value: '#64748b', key: 'slate' },
] as const

type TagEditDialogProps = {
  /** The tag being edited; null closes the dialog. */
  tag: Tag | null
  onClose: () => void
}

/** Edit a tag's name and dot color: reui c-color-picker-5 in a dialog. */
export function TagEditDialog({ tag, onClose }: TagEditDialogProps) {
  return (
    <Dialog open={tag !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className='sm:max-w-sm'>
        {/* key: each tag opens with its own name and color. */}
        {tag && <TagEditForm key={tag.id} tag={tag} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  )
}

function TagEditForm({ tag, onClose }: { tag: Tag; onClose: () => void }) {
  const { t } = useTranslation()
  const load = useTagsStore((s) => s.load)
  const [name, setName] = useState(tag.name)
  const [color, setColor] = useState<string | null>(tag.color)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const custom = !!color && !TAG_COLORS.some((preset) => preset.value === color)
  const ink = color ? getForegroundColor(color) : null
  const trimmed = name.trim()

  const save = async () => {
    if (!trimmed) return
    setSaving(true)
    setError(null)
    try {
      await api.updateTag(tag.id, { name: trimmed, color })
      await load()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form
      className='grid gap-4'
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
    >
      <DialogHeader>
        <DialogTitle>{t('tags.editTitle')}</DialogTitle>
        <DialogDescription>{t('tags.editDesc')}</DialogDescription>
      </DialogHeader>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor='tag-name'>{t('tags.name')}</FieldLabel>
          <Input
            id='tag-name'
            value={name}
            maxLength={64}
            aria-invalid={!!error || undefined}
            onChange={(event) => setName(event.target.value)}
          />
          {error && (
            <p role='alert' className='text-sm text-destructive'>
              {error}
            </p>
          )}
        </Field>
        <Field>
          <FieldLabel id='tag-color-label'>{t('tags.color')}</FieldLabel>
          <ColorPicker
            value={color}
            onValueChange={(value) => setColor(value && value.toLowerCase())}
            format='hex'
          >
            <div className='flex items-center gap-3'>
              <ColorPickerSwatches
                colors={TAG_COLORS.map((c) => ({
                  value: c.value,
                  label: t(`tags.colors.${c.key}`),
                }))}
                shape='circle'
                aria-labelledby='tag-color-label'
                className='flex-1'
              />
              {/* The plus opens the full picker; once a custom color is
                  set, it shows that color instead. */}
              <ColorPickerTrigger
                size='icon-sm'
                aria-label={t('tags.customColor')}
              >
                {custom ? (
                  <ColorPickerSwatch shape='circle' />
                ) : (
                  <PlusIcon aria-hidden='true' />
                )}
              </ColorPickerTrigger>
              <ColorPickerContent align='end' />
            </div>
          </ColorPicker>
        </Field>
        <div className='flex items-center gap-3'>
          <span className='text-sm text-muted-foreground'>
            {t('tags.preview')}
          </span>
          <Badge
            style={{
              backgroundColor: color ?? undefined,
              color: ink ?? undefined,
            }}
          >
            {trimmed || t('tags.untitled')}
          </Badge>
        </div>
      </FieldGroup>
      <DialogFooter>
        <Button type='button' variant='outline' onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button type='submit' disabled={!trimmed || saving}>
          {t('tags.save')}
        </Button>
      </DialogFooter>
    </form>
  )
}
