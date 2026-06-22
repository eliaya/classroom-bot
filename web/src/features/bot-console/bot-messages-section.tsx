import { useEffect, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { api, type BotMessage } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

export function BotMessagesSection() {
  const { t } = useTranslation()
  const [items, setItems] = useState<BotMessage[]>([])
  // Per-key edited drafts (only present while a row is being edited).
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const reload = () => {
    api
      .listBotMessages()
      .then((res) => {
        setItems(res.items)
        setDrafts({})
      })
      .catch((e) => setError(e instanceof Error ? e.message : t('common.loadFailed')))
  }

  useEffect(() => {
    reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const draftFor = (m: BotMessage) => drafts[m.key] ?? m.template
  const isDirty = (m: BotMessage) => draftFor(m) !== m.template

  const handleSave = async (m: BotMessage) => {
    setError(null)
    setBusy(m.key)
    try {
      await api.setBotMessage(m.key, draftFor(m))
      reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.loadFailed'))
    } finally {
      setBusy(null)
    }
  }

  const handleReset = async (m: BotMessage) => {
    setError(null)
    setBusy(m.key)
    try {
      await api.resetBotMessage(m.key)
      reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.loadFailed'))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className='flex flex-col gap-4'>
      {error && <p className='text-destructive text-sm'>{error}</p>}

      {items.map((m) => (
        <div key={m.key} className='flex flex-col gap-2 rounded-md border p-4'>
          <div className='flex items-center gap-2'>
            <code className='text-sm font-medium'>{m.key}</code>
            {m.overridden && <Badge variant='secondary'>{t('botMessages.customized')}</Badge>}
          </div>
          <p className='text-muted-foreground text-xs'>{m.description}</p>

          <Label htmlFor={`msg-${m.key}`} className='sr-only'>
            {m.key}
          </Label>
          <Textarea
            id={`msg-${m.key}`}
            value={draftFor(m)}
            onChange={(e) => setDrafts((d) => ({ ...d, [m.key]: e.target.value }))}
            rows={2}
            className='font-mono text-sm'
          />

          <div className='flex items-center justify-between gap-2'>
            <Button
              variant='ghost'
              size='sm'
              className='text-muted-foreground'
              disabled={!m.overridden || busy === m.key}
              onClick={() => void handleReset(m)}
            >
              <RotateCcw className='size-4' />
              {t('botMessages.reset')}
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
      ))}
    </div>
  )
}
