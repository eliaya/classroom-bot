import { useEffect, useRef, useState } from 'react'
import { animate } from 'animejs'
import { Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { api, type BotCommand, type BotCommandInput } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { ParamsEditor } from './params-editor'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'

type CommandDetailProps = {
  /** The command being edited, or null when creating a new one. */
  command: BotCommand | null
  onClose: () => void
  onSaved: (saved: BotCommand) => void
  onDeleted: () => void
}

function toForm(command: BotCommand | null): BotCommandInput {
  return {
    name: command?.name ?? '',
    description: command?.description ?? '',
    trigger: command?.trigger ?? '!',
    params: command?.params ?? '',
    response: command?.response ?? '',
    enabled: command?.enabled ?? true,
  }
}

export function CommandDetail({ command, onClose, onSaved, onDeleted }: CommandDetailProps) {
  const { t } = useTranslation()
  const panelRef = useRef<HTMLDivElement>(null)
  const [form, setForm] = useState<BotCommandInput>(() => toForm(command))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isNew = command === null

  // Slide the panel in on mount. The component is keyed on the selection in the
  // parent, so form state initializes via useState (no reset-in-effect needed).
  useEffect(() => {
    const el = panelRef.current
    if (!el) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    animate(el, { opacity: [0, 1], translateX: [36, 0], duration: 420, ease: 'outExpo' })
  }, [])

  const update = <K extends keyof BotCommandInput>(key: K, value: BotCommandInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  const handleSave = async () => {
    setError(null)
    if (!form.name.trim() || !form.response.trim()) {
      setError(t('botCommands.requiredFields'))
      return
    }
    setSaving(true)
    try {
      const body: BotCommandInput = {
        name: form.name.trim(),
        description: form.description?.trim() || null,
        trigger: form.trigger?.trim() || '!',
        params: form.params?.trim() || null,
        response: form.response,
        enabled: form.enabled,
      }
      const saved = isNew
        ? await api.createBotCommand(body)
        : await api.updateBotCommand(command!.id, body)
      onSaved(saved)
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.loadFailed'))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (isNew) return
    try {
      await api.deleteBotCommand(command!.id)
      onDeleted()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.loadFailed'))
    }
  }

  return (
    <div
      ref={panelRef}
      className='flex max-h-[80vh] h-[80vh] flex-col overflow-hidden rounded-md border lg:w-[70%]'
    >
      {/* Header */}
      <div className='flex items-start justify-between gap-2 border-b p-3'>
        <h3 className='truncate font-medium'>
          {isNew ? t('botCommands.new') : `${form.trigger}${command?.name}`}
        </h3>
        <Button variant='ghost' size='sm' className='h-7 px-2' onClick={onClose}>
          ✕
        </Button>
      </div>

      <ScrollArea className='flex-1 min-h-0'>
        <div className='flex flex-col gap-4 p-4'>
          {error && <p className='text-sm text-destructive'>{error}</p>}

          <div className='grid gap-2 sm:grid-cols-[100px_1fr] sm:items-center'>
            <Label htmlFor='bc-trigger'>{t('botCommands.trigger')}</Label>
            <Input
              id='bc-trigger'
              value={form.trigger ?? ''}
              onChange={(e) => update('trigger', e.target.value)}
              className='font-mono'
            />
            <Label htmlFor='bc-name'>{t('botCommands.name')}</Label>
            <Input
              id='bc-name'
              value={form.name}
              onChange={(e) => update('name', e.target.value)}
              placeholder='hello'
            />
          </div>

          <div className='grid gap-2'>
            <Label htmlFor='bc-desc'>{t('botCommands.description')}</Label>
            <Input
              id='bc-desc'
              value={form.description ?? ''}
              onChange={(e) => update('description', e.target.value)}
            />
          </div>

          <div className='grid gap-2'>
            <Label htmlFor='bc-response'>{t('botCommands.response')}</Label>
            <Textarea
              id='bc-response'
              value={form.response}
              onChange={(e) => update('response', e.target.value)}
              rows={4}
              placeholder={t('botCommands.responseHint')}
            />
          </div>

          <ParamsEditor
            value={form.params ?? ''}
            onChange={(next) => update('params', next || null)}
          />

          <div className='flex items-center gap-3'>
            <Switch
              id='bc-enabled'
              checked={form.enabled ?? true}
              onCheckedChange={(v) => update('enabled', v)}
            />
            <Label htmlFor='bc-enabled'>{t('botCommands.enabled')}</Label>
          </div>
        </div>
      </ScrollArea>

      {/* Footer actions */}
      <div className='flex items-center justify-between gap-2 border-t p-3'>
        {!isNew ? (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant='ghost' size='sm' className='text-destructive'>
                <Trash2 className='size-4' />
                {t('botCommands.delete')}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t('botCommands.delete')}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t('botCommands.deleteConfirm', { name: command?.name })}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                <AlertDialogAction onClick={handleDelete}>
                  {t('botCommands.delete')}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : (
          <span />
        )}
        <Button size='sm' onClick={handleSave} disabled={saving}>
          {t('botCommands.save')}
        </Button>
      </div>
    </div>
  )
}
