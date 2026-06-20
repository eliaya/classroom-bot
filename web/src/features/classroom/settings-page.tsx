import { useEffect, useState } from 'react'
import { CheckCircle2, KeyRound, Languages, RefreshCw, XCircle } from 'lucide-react'
import { Trans, useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Main } from '@/components/layout/main'
import { useLocale } from '@/context/locale-provider'
import { api, type AuditRetentionStatus, type SchedulerStatus } from '@/lib/api'
import { type Locale, SUPPORTED_LOCALES } from '@/lib/i18n'
import { ClassroomHeader } from './layout-header'

type GoogleDetail = {
  token_exists: boolean
  client_secret_exists: boolean
  valid: boolean
  missing_scopes?: string[]
  expired?: boolean | null
  error?: string | null
}

// The browser-visible URL Google redirects back to after consent. Must be
// registered as an authorized redirect URI on the OAuth client in the console.
const callbackUri =
  typeof window !== 'undefined'
    ? `${window.location.origin}/api/auth/google/callback`
    : ''

export function ClassroomSettingsPage() {
  const { t } = useTranslation()
  const { locale, setLocale } = useLocale()
  const [health, setHealth] = useState<string | null>(null)
  const [googleStatus, setGoogleStatus] = useState<string | null>(null)
  const [googleDetail, setGoogleDetail] = useState<GoogleDetail | null>(null)
  const [pythonVersion, setPythonVersion] = useState<string | null>(null)
  const [authorizing, setAuthorizing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Scheduler setting (persisted + live)
  const [scheduler, setScheduler] = useState<SchedulerStatus | null>(null)
  const [intervalInput, setIntervalInput] = useState('')
  const [enabledInput, setEnabledInput] = useState(true)
  const [savingScheduler, setSavingScheduler] = useState(false)
  const [runningNow, setRunningNow] = useState(false)
  const [schedulerMsg, setSchedulerMsg] = useState<string | null>(null)

  const applyScheduler = (s: SchedulerStatus) => {
    setScheduler(s)
    setIntervalInput(String(s.interval_minutes))
    setEnabledInput(s.enabled)
  }

  // Audit-log auto-rotation setting (persisted + live)
  const [auditRetention, setAuditRetention] = useState<AuditRetentionStatus | null>(null)
  const [retentionInput, setRetentionInput] = useState('')
  const [retentionEnabled, setRetentionEnabled] = useState(true)
  const [savingRetention, setSavingRetention] = useState(false)
  const [retentionMsg, setRetentionMsg] = useState<string | null>(null)

  const applyRetention = (s: AuditRetentionStatus) => {
    setAuditRetention(s)
    setRetentionInput(String(s.retention_days))
    setRetentionEnabled(s.enabled)
  }

  const loadStatus = () =>
    Promise.all([api.health(), api.status()])
      .then(([h, s]) => {
        setHealth(h.status)
        setGoogleStatus(s.google_credentials)
        setGoogleDetail((s.google as GoogleDetail) ?? null)
        setPythonVersion(s.python ?? null)
      })
      .catch((e) => setError(e instanceof Error ? e.message : t('settings.loadFailed')))

  useEffect(() => {
    // Handle the redirect back from the Google OAuth callback.
    const params = new URLSearchParams(window.location.search)
    const authResult = params.get('auth')
    if (authResult === 'success') {
      toast.success(t('settings.authComplete'))
    } else if (authResult === 'error') {
      toast.error(t('settings.authFailed', { reason: params.get('reason') ?? t('settings.authUnknown') }))
    }
    if (authResult) {
      // Strip the query params so a refresh doesn't re-toast.
      window.history.replaceState({}, '', window.location.pathname)
    }

    void loadStatus()
    api
      .getScheduler()
      .then(applyScheduler)
      .catch((e) =>
        setSchedulerMsg(e instanceof Error ? e.message : t('settings.schedulerLoadFailed'))
      )
    api
      .getAuditRetention()
      .then(applyRetention)
      .catch((e) =>
        setRetentionMsg(e instanceof Error ? e.message : t('settings.loadFailed'))
      )
  }, [])

  const handleAuthorize = async () => {
    setAuthorizing(true)
    try {
      const { authorization_url } = await api.googleAuthStart(window.location.origin)
      // Full-page redirect to Google's consent screen; the callback returns here.
      window.location.href = authorization_url
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('settings.authStartFailed'))
      setAuthorizing(false)
    }
  }

  const handleSaveScheduler = async () => {
    setSavingScheduler(true)
    setSchedulerMsg(null)
    try {
      const minutes = Number(intervalInput)
      if (!Number.isInteger(minutes) || minutes < 0 || minutes > 1440) {
        throw new Error(t('settings.intervalError'))
      }
      const updated = await api.updateScheduler({
        interval_minutes: minutes,
        enabled: enabledInput,
      })
      applyScheduler(updated)
      setSchedulerMsg(t('settings.saved'))
    } catch (e) {
      setSchedulerMsg(e instanceof Error ? e.message : t('common.saveFailed'))
    } finally {
      setSavingScheduler(false)
    }
  }

  const handleRunNow = async () => {
    setRunningNow(true)
    setSchedulerMsg(null)
    try {
      await api.triggerSync()
      setSchedulerMsg(t('settings.syncTriggered'))
    } catch (e) {
      setSchedulerMsg(e instanceof Error ? e.message : t('settings.triggerFailed'))
    } finally {
      setRunningNow(false)
    }
  }

  const handleSaveRetention = async () => {
    setSavingRetention(true)
    setRetentionMsg(null)
    try {
      const max = auditRetention?.max_retention_days ?? 30
      const days = Number(retentionInput)
      if (!Number.isInteger(days) || days < 1 || days > max) {
        throw new Error(t('settings.retentionError', { max }))
      }
      const updated = await api.updateAuditRetention({
        retention_days: days,
        enabled: retentionEnabled,
      })
      applyRetention(updated)
      setRetentionMsg(t('settings.saved'))
    } catch (e) {
      setRetentionMsg(e instanceof Error ? e.message : t('common.saveFailed'))
    } finally {
      setSavingRetention(false)
    }
  }

  const oauthOk = googleStatus === 'valid'
  const retentionDirty =
    auditRetention != null &&
    (Number(retentionInput) !== auditRetention.retention_days ||
      retentionEnabled !== auditRetention.enabled)
  const schedulerDirty =
    scheduler != null &&
    (Number(intervalInput) !== scheduler.interval_minutes ||
      enabledInput !== scheduler.enabled)

  return (
    <>
      <ClassroomHeader
        fixed
        title={t('settings.title')}
        description={t('settings.desc')}
      />
      <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>
        {error && <p className='text-destructive text-sm'>{error}</p>}

        <div className='grid gap-4 md:grid-cols-2'>
          <Card>
            <CardHeader>
              <CardTitle>{t('settings.apiHealth')}</CardTitle>
              <CardDescription>{t('settings.apiHealthDesc')}</CardDescription>
            </CardHeader>
            <CardContent className='flex items-center gap-2'>
              {health === 'ok' ? (
                <CheckCircle2 className='h-5 w-5 text-green-600' />
              ) : (
                <XCircle className='h-5 w-5 text-destructive' />
              )}
              <Badge variant={health === 'ok' ? 'secondary' : 'destructive'}>
                {health || t('settings.unknown')}
              </Badge>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{t('settings.googleOauth')}</CardTitle>
              <CardDescription>{t('settings.googleOauthDesc')}</CardDescription>
            </CardHeader>
            <CardContent className='flex flex-col gap-3'>
              <div className='flex items-center gap-2'>
                {oauthOk ? (
                  <CheckCircle2 className='h-5 w-5 text-green-600' />
                ) : (
                  <XCircle className='h-5 w-5 text-destructive' />
                )}
                <Badge variant={oauthOk ? 'secondary' : 'destructive'}>
                  {googleStatus || t('settings.unknown')}
                </Badge>
                {googleDetail?.expired ? (
                  <Badge variant='outline'>{t('settings.expired')}</Badge>
                ) : null}
              </div>
              {googleDetail?.missing_scopes &&
                googleDetail.missing_scopes.length > 0 && (
                  <p className='text-muted-foreground text-xs'>
                    {t('settings.missingScopes', { count: googleDetail.missing_scopes.length })}
                  </p>
                )}
              {!oauthOk && googleDetail?.error && (
                <p className='text-muted-foreground text-xs break-all'>
                  {googleDetail.error}
                </p>
              )}
              <Button
                onClick={() => void handleAuthorize()}
                disabled={authorizing || googleDetail?.client_secret_exists === false}
                className='w-fit'
              >
                <KeyRound className={authorizing ? 'animate-pulse' : ''} />
                {authorizing
                  ? t('settings.redirecting')
                  : oauthOk
                    ? t('settings.reauthorize')
                    : t('settings.authorize')}
              </Button>
              {googleDetail?.client_secret_exists === false && (
                <p className='text-destructive text-xs'>
                  {t('settings.clientSecretMissing')}
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className='flex items-center gap-2'>
              <Languages className='h-5 w-5' />
              {t('language.title')}
            </CardTitle>
            <CardDescription>{t('language.desc')}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className='flex flex-col gap-1.5'>
              <Label htmlFor='interface-language'>{t('language.label')}</Label>
              <Select
                value={locale}
                onValueChange={(value) => setLocale(value as Locale)}
              >
                <SelectTrigger id='interface-language' className='w-full sm:w-64'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SUPPORTED_LOCALES.map((l) => (
                    <SelectItem key={l.value} value={l.value}>
                      {l.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('settings.scheduler')}</CardTitle>
            <CardDescription>
              {t('settings.schedulerDesc')}
            </CardDescription>
          </CardHeader>
          <CardContent className='space-y-4'>
            <div className='flex items-center justify-between'>
              <div className='space-y-0.5'>
                <Label htmlFor='scheduler-enabled'>{t('settings.enabled')}</Label>
                <p className='text-muted-foreground text-xs'>
                  {t('settings.enabledDesc')}
                </p>
              </div>
              <Switch
                id='scheduler-enabled'
                checked={enabledInput}
                onCheckedChange={setEnabledInput}
              />
            </div>
            <Separator />
            <div className='flex flex-wrap items-end gap-3'>
              <div className='space-y-1'>
                <Label htmlFor='scheduler-interval'>{t('settings.interval')}</Label>
                <Input
                  id='scheduler-interval'
                  type='number'
                  min={0}
                  max={1440}
                  value={intervalInput}
                  onChange={(e) => setIntervalInput(e.target.value)}
                  className='w-32'
                />
              </div>
              <Button
                onClick={() => void handleSaveScheduler()}
                disabled={savingScheduler || !schedulerDirty}
              >
                {savingScheduler ? t('settings.saving') : t('settings.save')}
              </Button>
              <Button
                variant='outline'
                onClick={() => void handleRunNow()}
                disabled={runningNow}
              >
                <RefreshCw className={runningNow ? 'animate-spin' : ''} />
                {t('settings.runNow')}
              </Button>
            </div>
            <div className='text-muted-foreground flex flex-wrap gap-x-6 gap-y-1 text-xs'>
              <span>
                {t('settings.schedulerStatus')}{' '}
                <Badge variant={scheduler?.job_scheduled ? 'secondary' : 'outline'}>
                  {scheduler?.job_scheduled ? t('settings.active') : t('settings.idle')}
                </Badge>
              </span>
              <span>
                {t('settings.nextRun')}{' '}
                {scheduler?.next_run_time
                  ? new Date(scheduler.next_run_time).toLocaleString()
                  : '—'}
              </span>
            </div>
            {schedulerMsg && (
              <p className='text-muted-foreground text-xs'>{schedulerMsg}</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('settings.auditRetention')}</CardTitle>
            <CardDescription>
              {t('settings.auditRetentionDesc', {
                max: auditRetention?.max_retention_days ?? 30,
              })}
            </CardDescription>
          </CardHeader>
          <CardContent className='space-y-4'>
            <div className='flex items-center justify-between'>
              <div className='space-y-0.5'>
                <Label htmlFor='retention-enabled'>{t('settings.enabled')}</Label>
                <p className='text-muted-foreground text-xs'>
                  {t('settings.auditRetentionEnabledDesc')}
                </p>
              </div>
              <Switch
                id='retention-enabled'
                checked={retentionEnabled}
                onCheckedChange={setRetentionEnabled}
              />
            </div>
            <Separator />
            <div className='flex flex-wrap items-end gap-3'>
              <div className='space-y-1'>
                <Label htmlFor='retention-days'>{t('settings.retentionDays')}</Label>
                <Input
                  id='retention-days'
                  type='number'
                  min={1}
                  max={auditRetention?.max_retention_days ?? 30}
                  value={retentionInput}
                  onChange={(e) => setRetentionInput(e.target.value)}
                  className='w-32'
                />
              </div>
              <Button
                onClick={() => void handleSaveRetention()}
                disabled={savingRetention || !retentionDirty}
              >
                {savingRetention ? t('settings.saving') : t('settings.save')}
              </Button>
            </div>
            <div className='text-muted-foreground flex flex-wrap gap-x-6 gap-y-1 text-xs'>
              <span>
                {t('settings.schedulerStatus')}{' '}
                <Badge variant={auditRetention?.job_scheduled ? 'secondary' : 'outline'}>
                  {auditRetention?.job_scheduled ? t('settings.active') : t('settings.idle')}
                </Badge>
              </span>
              <span>
                {t('settings.nextRun')}{' '}
                {auditRetention?.next_run_time
                  ? new Date(auditRetention.next_run_time).toLocaleString()
                  : '—'}
              </span>
            </div>
            {retentionMsg && (
              <p className='text-muted-foreground text-xs'>{retentionMsg}</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('settings.setupTitle')}</CardTitle>
            <CardDescription>
              {t('settings.setupDesc')}
            </CardDescription>
          </CardHeader>
          <CardContent className='space-y-4 text-sm'>
            <div className='flex flex-col gap-2'>
              <p className='font-medium'>{t('settings.step1Title')}</p>
              <p className='text-muted-foreground'>
                <Trans
                  i18nKey='settings.step1Desc'
                  components={{ strong: <strong /> }}
                />
              </p>
              <Alert>
                <AlertTitle>{t('settings.step1AlertTitle')}</AlertTitle>
                <AlertDescription>
                  <p>
                    <Trans
                      i18nKey='settings.step1AlertDesc'
                      components={{ strong: <strong /> }}
                    />
                  </p>
                  <code className='rounded bg-muted px-1 py-0.5 break-all'>
                    {callbackUri}
                  </code>
                </AlertDescription>
              </Alert>
            </div>
            <Separator />
            <div>
              <p className='font-medium'>{t('settings.step2Title')}</p>
              <p className='text-muted-foreground'>
                <Trans
                  i18nKey='settings.step2Desc'
                  components={{
                    strong: <strong />,
                    code: <code className='rounded bg-muted px-1 py-0.5' />,
                  }}
                />
              </p>
            </div>
            <Separator />
            <div>
              <p className='font-medium'>{t('settings.step3Title')}</p>
              <p className='text-muted-foreground'>
                <Trans
                  i18nKey='settings.step3Desc'
                  components={{
                    code: <code className='rounded bg-muted px-1 py-0.5' />,
                  }}
                />
              </p>
            </div>
            {pythonVersion && (
              <>
                <Separator />
                <p className='text-muted-foreground'>
                  {t('settings.pythonVersion', { version: pythonVersion })}
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </Main>
    </>
  )
}