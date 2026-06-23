import { useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { api, type BotMessage } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'

type Draft = { template: string; description: string }

/** Editable bot-message templates whose key belongs to this command
 * (`<commandName>.*`). Lives inside the command detail panel. */
export function CommandMessages({ commandName }: { commandName: string }) {
  const { t } = useTranslation()
  const prefix = `${commandName}.`
  const [items, setItems] = useState<BotMessage[]>([])
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  // New-message form (null = hidden). `suffix` is appended to the command prefix.
  const [creating, setCreating] = useState<{ suffix: string; description: string; template: string } | null>(null)

  const reload = () => {
    api
      .listBotMessages()
      .then((res) => {
        setItems(res.items.filter((m) => m.key.startsWith(prefix)))
        setDrafts({})
      })
      .catch((e) => setError(e instanceof Error ? e.message : t('common.loadFailed')))
  }

  useEffect(() => {
    reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefix])

  const draftFor = (m: BotMessage): Draft =>
    drafts[m.key] ?? { template: m.template, description: m.description ?? '' }
  const isDirty = (m: BotMessage) => {
    const d = draftFor(m)
    return d.template !== m.template || d.description !== (m.description ?? '')
  }

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setError(null)
    setBusy(key)
    try {
      await fn()
      reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.loadFailed'))
    } finally {
      setBusy(null)
    }
  }

  const handleSave = (m: BotMessage) => {
    const d = draftFor(m)
    return run(m.key, () => api.setBotMessage(m.key, d.template, d.description || null))
  }
  const handleDelete = (m: BotMessage) => run(m.key, () => api.deleteBotMessage(m.key))
  const handleCreate = () => {
    if (!creating) return
    const { suffix, description, template } = creating
    return run('__new__', async () => {
      await api.createBotMessage({
        key: prefix + suffix.trim(),
        template,
        description: description || null,
      })
      setCreating(null)
    })
  }

  return (
    <div className='flex flex-col gap-3'>
      <Separator />
      <div className='flex items-center justify-between gap-2'>
        <h4 className='text-sm font-medium'>{t('botMessages.title')}</h4>
        <Button
          size='sm'
          variant={creating ? 'secondary' : 'outline'}
          onClick={() => setCreating(creating ? null : { suffix: '', description: '', template: '' })}
        >
          <Plus className='size-4' />
          {t('botMessages.new')}
        </Button>
      </div>

      {error && <p className='text-destructive text-sm'>{error}</p>}

      {creating && (
        <div className='flex flex-col gap-2 rounded-md border border-dashed p-3'>
          <Label htmlFor='cm-new-key'>{t('botMessages.key')}</Label>
          <div className='flex items-center gap-1'>
            <code className='text-muted-foreground text-sm'>{prefix}</code>
            <Input
              id='cm-new-key'
              value={creating.suffix}
              onChange={(e) => setCreating((c) => c && { ...c, suffix: e.target.value })}
              placeholder='empty'
              className='font-mono'
            />
          </div>
          <Label htmlFor='cm-new-desc'>{t('botMessages.description')}</Label>
          <Input
            id='cm-new-desc'
            value={creating.description}
            onChange={(e) => setCreating((c) => c && { ...c, description: e.target.value })}
          />
          <Label htmlFor='cm-new-tmpl'>{t('botMessages.template')}</Label>
          <Textarea
            id='cm-new-tmpl'
            value={creating.template}
            onChange={(e) => setCreating((c) => c && { ...c, template: e.target.value })}
            rows={2}
            className='font-mono text-sm'
          />
          <div className='flex justify-end'>
            <Button
              size='sm'
              disabled={!creating.suffix.trim() || !creating.template.trim() || busy === '__new__'}
              onClick={() => void handleCreate()}
            >
              {t('botMessages.save')}
            </Button>
          </div>
        </div>
      )}

      {items.length === 0 && !creating ? (
        <p className='text-muted-foreground text-xs'>{t('botMessages.empty')}</p>
      ) : (
        items.map((m) => {
          const d = draftFor(m)
          return (
            <div key={m.key} className='flex flex-col gap-2 rounded-md border p-3'>
              <div className='flex items-center gap-2'>
                <code className='text-sm font-medium'>{m.key}</code>
                {m.is_default && <Badge variant='secondary'>{t('botMessages.builtin')}</Badge>}
              </div>
              <Input
                aria-label={t('botMessages.description')}
                value={d.description}
                placeholder={t('botMessages.description')}
                onChange={(e) =>
                  setDrafts((prev) => ({ ...prev, [m.key]: { ...d, description: e.target.value } }))
                }
                className='text-muted-foreground text-xs'
              />
              <Textarea
                aria-label={m.key}
                value={d.template}
                onChange={(e) =>
                  setDrafts((prev) => ({ ...prev, [m.key]: { ...d, template: e.target.value } }))
                }
                rows={2}
                className='font-mono text-sm'
              />
              <div className='flex items-center justify-between gap-2'>
                <Button
                  variant='ghost'
                  size='sm'
                  className='text-destructive'
                  disabled={busy === m.key}
                  onClick={() => void handleDelete(m)}
                >
                  <Trash2 className='size-4' />
                  {m.is_default ? t('botMessages.reset') : t('botMessages.delete')}
                </Button>
                <Button
                  size='sm'
                  disabled={!isDirty(m) || busy === m.key}
                  onClick={() => void handleSave(m)}
                >
                  {t('botMessages.save')}
                </Button>
              </div>
            </div>
          )
        })
      )}
    </div>
  )
}
