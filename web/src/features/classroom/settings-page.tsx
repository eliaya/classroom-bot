import { useEffect, useState } from 'react'
import { CheckCircle2, RefreshCw, XCircle } from 'lucide-react'
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

export function ClassroomSettingsPage() {
  const [health, setHealth] = useState<string | null>(null)
  const [googleStatus, setGoogleStatus] = useState<string | null>(null)
  const [pythonVersion, setPythonVersion] = useState<string | null>(null)
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

  useEffect(() => {
    Promise.all([api.health(), api.status()])
      .then(([h, s]) => {
        setHealth(h.status)
        setGoogleStatus(s.google_credentials)
        setPythonVersion(s.python ?? null)
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Load failed'))
    api
      .getScheduler()
      .then(applyScheduler)
      .catch((e) =>
        setSchedulerMsg(e instanceof Error ? e.message : 'Failed to load scheduler')
      )
  }, [])

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
      <ClassroomHeader fixed />
      <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>
        <div>
          <h2 className='text-2xl font-bold tracking-tight'>Settings</h2>
          <p className='text-muted-foreground'>
            API health, OAuth credentials, and sync configuration
          </p>
        </div>

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
            <CardContent className='flex items-center gap-2'>
              {oauthOk ? (
                <CheckCircle2 className='h-5 w-5 text-green-600' />
              ) : (
                <XCircle className='h-5 w-5 text-destructive' />
              )}
              <Badge variant={oauthOk ? 'secondary' : 'destructive'}>
                {googleStatus || 'unknown'}
              </Badge>
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
            <div>
              <p className='font-medium'>1. Authorize Google OAuth</p>
              <p className='text-muted-foreground'>
                Run{' '}
                <code className='rounded bg-muted px-1 py-0.5'>
                  python src/scripts/setup_google_auth.py
                </code>{' '}
                on the host to refresh tokens with Classroom scopes (rosters,
                coursework, materials).
              </p>
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