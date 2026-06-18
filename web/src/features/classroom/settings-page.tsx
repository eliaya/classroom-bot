import { useEffect, useState } from 'react'
import { CheckCircle2, KeyRound, RefreshCw, XCircle } from 'lucide-react'
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
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Main } from '@/components/layout/main'
import { api, type SchedulerStatus } from '@/lib/api'
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

  const loadStatus = () =>
    Promise.all([api.health(), api.status()])
      .then(([h, s]) => {
        setHealth(h.status)
        setGoogleStatus(s.google_credentials)
        setGoogleDetail((s.google as GoogleDetail) ?? null)
        setPythonVersion(s.python ?? null)
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Load failed'))

  useEffect(() => {
    // Handle the redirect back from the Google OAuth callback.
    const params = new URLSearchParams(window.location.search)
    const authResult = params.get('auth')
    if (authResult === 'success') {
      toast.success('Google authorization complete')
    } else if (authResult === 'error') {
      toast.error(`Google authorization failed: ${params.get('reason') ?? 'unknown'}`)
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
        setSchedulerMsg(e instanceof Error ? e.message : 'Failed to load scheduler')
      )
  }, [])

  const handleAuthorize = async () => {
    setAuthorizing(true)
    try {
      const { authorization_url } = await api.googleAuthStart(window.location.origin)
      // Full-page redirect to Google's consent screen; the callback returns here.
      window.location.href = authorization_url
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to start authorization')
      setAuthorizing(false)
    }
  }

  const handleSaveScheduler = async () => {
    setSavingScheduler(true)
    setSchedulerMsg(null)
    try {
      const minutes = Number(intervalInput)
      if (!Number.isInteger(minutes) || minutes < 0 || minutes > 1440) {
        throw new Error('Interval must be an integer between 0 and 1440 minutes')
      }
      const updated = await api.updateScheduler({
        interval_minutes: minutes,
        enabled: enabledInput,
      })
      applyScheduler(updated)
      setSchedulerMsg('Saved')
    } catch (e) {
      setSchedulerMsg(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSavingScheduler(false)
    }
  }

  const handleRunNow = async () => {
    setRunningNow(true)
    setSchedulerMsg(null)
    try {
      await api.triggerSync()
      setSchedulerMsg('Sync triggered')
    } catch (e) {
      setSchedulerMsg(e instanceof Error ? e.message : 'Trigger failed')
    } finally {
      setRunningNow(false)
    }
  }

  const oauthOk = googleStatus === 'valid'
  const schedulerDirty =
    scheduler != null &&
    (Number(intervalInput) !== scheduler.interval_minutes ||
      enabledInput !== scheduler.enabled)

  return (
    <>
      <ClassroomHeader
        fixed
        title='Settings'
        description='API health, OAuth credentials, and sync configuration'
      />
      <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>
        {error && <p className='text-destructive text-sm'>{error}</p>}

        <div className='grid gap-4 md:grid-cols-2'>
          <Card>
            <CardHeader>
              <CardTitle>API health</CardTitle>
              <CardDescription>FastAPI backend status</CardDescription>
            </CardHeader>
            <CardContent className='flex items-center gap-2'>
              {health === 'ok' ? (
                <CheckCircle2 className='h-5 w-5 text-green-600' />
              ) : (
                <XCircle className='h-5 w-5 text-destructive' />
              )}
              <Badge variant={health === 'ok' ? 'secondary' : 'destructive'}>
                {health || 'unknown'}
              </Badge>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Google OAuth</CardTitle>
              <CardDescription>Classroom API credentials</CardDescription>
            </CardHeader>
            <CardContent className='flex flex-col gap-3'>
              <div className='flex items-center gap-2'>
                {oauthOk ? (
                  <CheckCircle2 className='h-5 w-5 text-green-600' />
                ) : (
                  <XCircle className='h-5 w-5 text-destructive' />
                )}
                <Badge variant={oauthOk ? 'secondary' : 'destructive'}>
                  {googleStatus || 'unknown'}
                </Badge>
                {googleDetail?.expired ? (
                  <Badge variant='outline'>expired</Badge>
                ) : null}
              </div>
              {googleDetail?.missing_scopes &&
                googleDetail.missing_scopes.length > 0 && (
                  <p className='text-muted-foreground text-xs'>
                    Missing scopes: {googleDetail.missing_scopes.length}. Re-authorize
                    to grant them.
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
                  ? 'Redirecting…'
                  : oauthOk
                    ? 'Re-authorize'
                    : 'Authorize with Google'}
              </Button>
              {googleDetail?.client_secret_exists === false && (
                <p className='text-destructive text-xs'>
                  client_secret.json not found — upload your Web OAuth client first.
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Scheduler</CardTitle>
            <CardDescription>
              Automatic Classroom cache sync. Changes are saved to the database
              and take effect immediately (persist across restarts).
            </CardDescription>
          </CardHeader>
          <CardContent className='space-y-4'>
            <div className='flex items-center justify-between'>
              <div className='space-y-0.5'>
                <Label htmlFor='scheduler-enabled'>Enabled</Label>
                <p className='text-muted-foreground text-xs'>
                  Turn the scheduled background sync on or off
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
                <Label htmlFor='scheduler-interval'>Interval (minutes)</Label>
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
                {savingScheduler ? 'Saving…' : 'Save'}
              </Button>
              <Button
                variant='outline'
                onClick={() => void handleRunNow()}
                disabled={runningNow}
              >
                <RefreshCw className={runningNow ? 'animate-spin' : ''} />
                Run now
              </Button>
            </div>
            <div className='text-muted-foreground flex flex-wrap gap-x-6 gap-y-1 text-xs'>
              <span>
                Status:{' '}
                <Badge variant={scheduler?.job_scheduled ? 'secondary' : 'outline'}>
                  {scheduler?.job_scheduled ? 'active' : 'idle'}
                </Badge>
              </span>
              <span>
                Next run:{' '}
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
            <CardTitle>Setup instructions</CardTitle>
            <CardDescription>
              Required steps when credentials are missing or scopes change
            </CardDescription>
          </CardHeader>
          <CardContent className='space-y-4 text-sm'>
            <div className='flex flex-col gap-2'>
              <p className='font-medium'>1. Authorize Google OAuth (no terminal needed)</p>
              <p className='text-muted-foreground'>
                Click <strong>Authorize with Google</strong> in the Google OAuth
                card above and complete consent. The token is written
                automatically — no host script required.
              </p>
              <Alert>
                <AlertTitle>One-time Google Cloud setup</AlertTitle>
                <AlertDescription>
                  <p>
                    Add this exact <strong>Authorized redirect URI</strong> to
                    your Web OAuth client in the Google Cloud Console:
                  </p>
                  <code className='rounded bg-muted px-1 py-0.5 break-all'>
                    {callbackUri}
                  </code>
                </AlertDescription>
              </Alert>
            </div>
            <Separator />
            <div>
              <p className='font-medium'>2. Background sync interval</p>
              <p className='text-muted-foreground'>
                Configure the schedule in the <strong>Scheduler</strong> card
                above (saved to the database).{' '}
                <code className='rounded bg-muted px-1 py-0.5'>
                  CLASSROOM_SYNC_INTERVAL_MINUTES
                </code>{' '}
                in <code className='rounded bg-muted px-1 py-0.5'>.env</code>{' '}
                only seeds the initial default (30) on first run.
              </p>
            </div>
            <Separator />
            <div>
              <p className='font-medium'>3. Admin API token (optional)</p>
              <p className='text-muted-foreground'>
                Set{' '}
                <code className='rounded bg-muted px-1 py-0.5'>
                  VITE_ADMIN_API_TOKEN
                </code>{' '}
                in the web build environment if the API requires Bearer auth.
              </p>
            </div>
            {pythonVersion && (
              <>
                <Separator />
                <p className='text-muted-foreground'>
                  API Python version: {pythonVersion}
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </Main>
    </>
  )
}