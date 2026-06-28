import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
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
import { api, type SchedulerStatus } from '@/lib/api'
import { useSyncStatusStore } from '@/stores/sync-status-store'

/** Background-sync scheduler: enable, intervals, and a manual run-now trigger. */
export function SchedulerSection() {
  const { t } = useTranslation()
  const [scheduler, setScheduler] = useState<SchedulerStatus | null>(null)
  const [intervalInput, setIntervalInput] = useState('')
  const [pollIntervalInput, setPollIntervalInput] = useState('')
  const [enabledInput, setEnabledInput] = useState(true)
  const [savingScheduler, setSavingScheduler] = useState(false)
  const [runningNow, setRunningNow] = useState(false)
  const [schedulerMsg, setSchedulerMsg] = useState<string | null>(null)

  const applyScheduler = (s: SchedulerStatus) => {
    setScheduler(s)
    setIntervalInput(String(s.interval_minutes))
    setPollIntervalInput(String(s.poll_interval_minutes))
    setEnabledInput(s.enabled)
  }

  useEffect(() => {
    api
      .getScheduler()
      .then(applyScheduler)
      .catch((e) =>
        setSchedulerMsg(e instanceof Error ? e.message : t('settings.schedulerLoadFailed'))
      )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleSaveScheduler = async () => {
    setSavingScheduler(true)
    setSchedulerMsg(null)
    try {
      const minutes = Number(intervalInput)
      if (!Number.isInteger(minutes) || minutes < 0 || minutes > 1440) {
        throw new Error(t('settings.intervalError'))
      }
      const pollMinutes = Number(pollIntervalInput)
      if (!Number.isInteger(pollMinutes) || pollMinutes < 1 || pollMinutes > 1440) {
        throw new Error(t('settings.pollIntervalError'))
      }
      const updated = await api.updateScheduler({
        interval_minutes: minutes,
        poll_interval_minutes: pollMinutes,
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
      // Nudge the global watcher so the notification pops immediately.
      useSyncStatusStore.getState().startPolling()
      setSchedulerMsg(t('settings.syncTriggered'))
    } catch (e) {
      setSchedulerMsg(e instanceof Error ? e.message : t('settings.triggerFailed'))
    } finally {
      setRunningNow(false)
    }
  }

  const schedulerDirty =
    scheduler != null &&
    (Number(intervalInput) !== scheduler.interval_minutes ||
      Number(pollIntervalInput) !== scheduler.poll_interval_minutes ||
      enabledInput !== scheduler.enabled)

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.scheduler')}</CardTitle>
        <CardDescription>{t('settings.schedulerDesc')}</CardDescription>
      </CardHeader>
      <CardContent className='space-y-4'>
        <div className='flex items-center justify-between'>
          <div className='space-y-0.5'>
            <Label htmlFor='scheduler-enabled'>{t('settings.enabled')}</Label>
            <p className='text-muted-foreground text-xs'>{t('settings.enabledDesc')}</p>
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
          <div className='space-y-1'>
            <Label htmlFor='scheduler-poll-interval'>{t('settings.pollInterval')}</Label>
            <Input
              id='scheduler-poll-interval'
              type='number'
              min={1}
              max={1440}
              value={pollIntervalInput}
              onChange={(e) => setPollIntervalInput(e.target.value)}
              className='w-32'
            />
          </div>
          <Button
            onClick={() => void handleSaveScheduler()}
            disabled={savingScheduler || !schedulerDirty}
          >
            {savingScheduler ? t('settings.saving') : t('settings.save')}
          </Button>
          <Button variant='outline' onClick={() => void handleRunNow()} disabled={runningNow}>
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
        {schedulerMsg && <p className='text-muted-foreground text-xs'>{schedulerMsg}</p>}
      </CardContent>
    </Card>
  )
}
