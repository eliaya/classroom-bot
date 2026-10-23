import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { PasswordInput } from '@/components/password-input'
import { api, type OpenCloudSettings, type StorageProvider } from '@/lib/api'
import { useCan } from '@/lib/permissions'

const PROVIDERS: StorageProvider[] = ['opencloud', 'nextcloud']

/**
 * Per-user external storage: when on, attachments are moved to the chosen
 * provider during sync instead of the user's Google Drive, and only text stays
 * on the server. The provider and its settings show only while it is on.
 */
export function OpenCloudSection() {
  const { t } = useTranslation()
  const canEdit = useCan('sync:use')
  const [config, setConfig] = useState<OpenCloudSettings | null>(null)
  const [token, setToken] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    api
      .getOpenCloudSettings()
      .then(setConfig)
      .catch((e) => setMsg(e instanceof Error ? e.message : t('settings.loadFailed')))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const available = config?.available ?? true
  const provider = config?.provider ?? 'opencloud'

  const set = (patch: Partial<OpenCloudSettings>) =>
    config && setConfig({ ...config, ...patch })

  const handleSave = async () => {
    if (!config) return
    setSaving(true)
    setMsg(null)
    try {
      setConfig(
        await api.updateOpenCloudSettings({
          enabled: config.enabled,
          provider: config.provider,
          webdav_url: config.webdav_url.trim(),
          username: config.username.trim(),
          folder: config.folder.trim(),
          app_token: token,
        })
      )
      setToken('')
      setMsg(t('settings.saved'))
    } catch (e) {
      setMsg(e instanceof Error ? e.message : t('common.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.opencloud.title')}</CardTitle>
        <CardDescription>{t('settings.opencloud.desc')}</CardDescription>
      </CardHeader>
      <CardContent className='flex flex-col gap-4'>
        {!available && (
          <p className='text-muted-foreground text-sm'>{t('settings.opencloud.unavailable')}</p>
        )}
        <div className='flex items-center justify-between'>
          <div>
            <Label htmlFor='opencloud-enabled'>{t('settings.enabled')}</Label>
            <p className='text-muted-foreground text-sm'>
              {t('settings.opencloud.enabledDesc')}
            </p>
          </div>
          <Switch
            id='opencloud-enabled'
            checked={config?.enabled ?? false}
            // Switched off by the admin: it can still be turned off, not on.
            disabled={!config || (!available && !config.enabled)}
            onCheckedChange={(enabled) => set({ enabled })}
          />
        </div>
        {config?.enabled && (
          <>
            <Separator />
            <div className='max-w-xs'>
              <Label htmlFor='storage-provider'>{t('settings.opencloud.provider')}</Label>
              <Select
                value={provider}
                onValueChange={(value) => set({ provider: value as StorageProvider })}
              >
                <SelectTrigger id='storage-provider' className='mt-1 w-full'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROVIDERS.map((p) => (
                    <SelectItem key={p} value={p}>
                      {t(`settings.opencloud.providers.${p}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className='grid gap-4 sm:grid-cols-2'>
              <div className='sm:col-span-2'>
                <Label htmlFor='opencloud-url'>{t('settings.opencloud.url')}</Label>
                <Input
                  id='opencloud-url'
                  type='url'
                  className='mt-1'
                  placeholder={
                    provider === 'nextcloud'
                      ? 'https://cloud.example.com/remote.php/dav/files/<username>/'
                      : 'https://cloud.example.com/remote.php/dav/spaces/<space-id>/'
                  }
                  value={config.webdav_url}
                  onChange={(e) => set({ webdav_url: e.target.value })}
                />
                <p className='text-muted-foreground mt-1 text-xs'>
                  {t(`settings.opencloud.urlHint.${provider}`)}
                </p>
              </div>
              <div>
                <Label htmlFor='opencloud-username'>{t('settings.opencloud.username')}</Label>
                <Input
                  id='opencloud-username'
                  className='mt-1'
                  autoComplete='off'
                  value={config.username}
                  onChange={(e) => set({ username: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor='opencloud-token'>{t(`settings.opencloud.token.${provider}`)}</Label>
                <PasswordInput
                  id='opencloud-token'
                  className='mt-1'
                  autoComplete='new-password'
                  placeholder={config.has_token ? t('settings.opencloud.tokenKeep') : ''}
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor='opencloud-folder'>{t('settings.opencloud.folder')}</Label>
                <Input
                  id='opencloud-folder'
                  className='mt-1'
                  value={config.folder}
                  onChange={(e) => set({ folder: e.target.value })}
                />
              </div>
            </div>
          </>
        )}
        <div className='flex items-center gap-3'>
          <Button
            onClick={() => void handleSave()}
            disabled={saving || !config || !canEdit || (config.enabled && !available)}
          >
            {saving ? t('settings.saving') : t('settings.save')}
          </Button>
          {msg && <span className='text-muted-foreground text-sm'>{msg}</span>}
        </div>
      </CardContent>
    </Card>
  )
}
