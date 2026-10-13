import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api, type BotSettings, type BotStatus } from '@/lib/api'
import { useCan } from '@/lib/permissions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { PasswordInput } from '@/components/password-input'

/** Your own Discord bot: its token (write-only) and whether it is connected. */
export function BotTokenCard() {
  const { t } = useTranslation()
  const canEdit = useCan('bot:use')
  const [config, setConfig] = useState<BotSettings | null>(null)
  const [status, setStatus] = useState<BotStatus | null>(null)
  const [token, setToken] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([api.getBotSettings(), api.botStatus()])
      .then(([settings, botStatus]) => {
        setConfig(settings)
        setStatus(botStatus)
      })
      .catch((e) => setMsg(e instanceof Error ? e.message : t('common.loadFailed')))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const save = async (value: string) => {
    setSaving(true)
    setMsg(null)
    try {
      setConfig(await api.updateBotSettings(value))
      setToken('')
      // The bot process picks the change up within a minute.
      setMsg(t(value ? 'botConsole.tokenSaved' : 'botConsole.tokenRemoved'))
    } catch (e) {
      setMsg(e instanceof Error ? e.message : t('common.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className='flex items-center gap-2'>
          {config?.bot_name ?? t('botConsole.myBot')}
          {config?.has_token && status && (
            <Badge variant={status.status === 'connected' ? 'secondary' : 'outline'}>
              {t(`bot.${status.status}`)}
            </Badge>
          )}
        </CardTitle>
        <CardDescription>{t('botConsole.myBotDesc')}</CardDescription>
      </CardHeader>
      <CardContent className='flex flex-col gap-3'>
        {config?.has_token && status?.status === 'error' && status.detail && (
          <p role='alert' className='text-destructive text-sm'>{status.detail}</p>
        )}
        <div className='max-w-md'>
          <Label htmlFor='bot-token'>{t('botConsole.token')}</Label>
          <PasswordInput
            id='bot-token'
            className='mt-1'
            autoComplete='new-password'
            placeholder={config?.has_token ? t('botConsole.tokenKeep') : ''}
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
        </div>
        <div className='flex items-center gap-3'>
          <Button onClick={() => void save(token.trim())} disabled={saving || !canEdit || !token.trim()}>
            {saving ? t('settings.saving') : t('settings.save')}
          </Button>
          {config?.has_token && (
            <Button variant='outline' onClick={() => void save('')} disabled={saving || !canEdit}>
              {t('botConsole.removeBot')}
            </Button>
          )}
          {msg && <span className='text-muted-foreground text-sm'>{msg}</span>}
        </div>
      </CardContent>
    </Card>
  )
}
