import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
import { api, type BackupJob, type BackupScope, type BackupSettings } from '@/lib/api'

const ACTIVE = ['pending', 'running']

function formatBytes(bytes?: number | null): string {
  if (!bytes) return '—'
  const mb = bytes / 1024 / 1024
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(1)} MB`
}

function statusVariant(status: string) {
  if (status === 'completed') return 'default' as const
  if (status === 'failed') return 'destructive' as const
  return 'secondary' as const
}

/** Scheduled + manual backups, downloads, retention and restore. */
export function BackupSection() {
  const { t } = useTranslation()
  const [config, setConfig] = useState<BackupSettings | null>(null)
  const [jobs, setJobs] = useState<BackupJob[]>([])
  const [retentionInput, setRetentionInput] = useState('')
  const [hourInput, setHourInput] = useState('')
  const [minuteInput, setMinuteInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const applyConfig = (s: BackupSettings) => {
    setConfig(s)
    setRetentionInput(String(s.retention_days))
    setHourInput(String(s.hour))
    setMinuteInput(String(s.minute))
  }

  const fail = useCallback(
    (e: unknown) => setMsg(e instanceof Error ? e.message : t('settings.loadFailed')),
    [t]
  )

  const refresh = useCallback(async () => {
    try {
      setJobs((await api.listBackups()).items)
    } catch (e) {
      fail(e)
    }
  }, [fail])

  useEffect(() => {
    api.getBackupSettings().then(applyConfig).catch(fail)
    api
      .listBackups()
      .then((list) => setJobs(list.items))
      .catch(fail)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Poll only while something is in flight — no idle chatter.
  const running = jobs.some((j) => ACTIVE.includes(j.status))
  useEffect(() => {
    if (!running) return
    const id = setInterval(refresh, 4000)
    return () => clearInterval(id)
  }, [running, refresh])

  const handleSave = async () => {
    setSaving(true)
    setMsg(null)
    try {
      const days = Number(retentionInput)
      const max = config?.max_retention_days ?? 90
      if (!Number.isInteger(days) || days < 1 || days > max) {
        throw new Error(t('settings.backup.retentionError', { max }))
      }
      applyConfig(
        await api.updateBackupSettings({
          enabled: config?.enabled,
          scope: config?.scope,
          hour: Number(hourInput),
          minute: Number(minuteInput),
          retention_days: days,
        })
      )
      setMsg(t('settings.saved'))
    } catch (e) {
      setMsg(e instanceof Error ? e.message : t('common.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true)
    setMsg(null)
    try {
      await fn()
      setMsg(ok)
      await refresh()
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }

  const locked = config ? !config.admin_token_configured : false

  return (
    <div className='flex flex-col gap-4 sm:gap-6'>
      <Card>
        <CardHeader>
          <CardTitle>{t('settings.backup.scheduleTitle')}</CardTitle>
          <CardDescription>{t('settings.backup.scheduleDesc')}</CardDescription>
        </CardHeader>
        <CardContent className='flex flex-col gap-4'>
          <div className='flex items-center justify-between'>
            <div>
              <Label>{t('settings.enabled')}</Label>
              <p className='text-muted-foreground text-sm'>
                {t('settings.backup.enabledDesc')}
              </p>
            </div>
            <Switch
              checked={config?.enabled ?? false}
              disabled={!config}
              onCheckedChange={(enabled) =>
                config && setConfig({ ...config, enabled })
              }
            />
          </div>
          <Separator />
          <div className='grid gap-4 sm:grid-cols-4'>
            <div>
              <Label htmlFor='backup-scope'>{t('settings.backup.scope')}</Label>
              <Select
                value={config?.scope ?? 'database'}
                onValueChange={(scope) =>
                  config && setConfig({ ...config, scope: scope as BackupScope })
                }
              >
                <SelectTrigger id='backup-scope' className='mt-1'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='database'>
                    {t('settings.backup.scopeDatabase')}
                  </SelectItem>
                  <SelectItem value='full'>{t('settings.backup.scopeFull')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor='backup-hour'>{t('settings.backup.hour')}</Label>
              <Input
                id='backup-hour'
                className='mt-1'
                value={hourInput}
                onChange={(e) => setHourInput(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor='backup-minute'>{t('settings.backup.minute')}</Label>
              <Input
                id='backup-minute'
                className='mt-1'
                value={minuteInput}
                onChange={(e) => setMinuteInput(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor='backup-retention'>{t('settings.retentionDays')}</Label>
              <Input
                id='backup-retention'
                className='mt-1'
                value={retentionInput}
                onChange={(e) => setRetentionInput(e.target.value)}
              />
            </div>
          </div>
          <div className='flex items-center gap-3'>
            <Button onClick={handleSave} disabled={saving || !config}>
              {saving ? t('settings.saving') : t('settings.save')}
            </Button>
            <span className='text-muted-foreground text-sm'>
              {t('settings.nextRun')}{' '}
              {config?.next_run_time
                ? new Date(config.next_run_time).toLocaleString()
                : t('settings.idle')}
            </span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('settings.backup.listTitle')}</CardTitle>
          <CardDescription>{t('settings.backup.listDesc')}</CardDescription>
        </CardHeader>
        <CardContent className='flex flex-col gap-4'>
          {locked && (
            <p className='text-destructive text-sm'>{t('settings.backup.tokenMissing')}</p>
          )}
          <div className='flex flex-wrap gap-2'>
            <Button
              variant='outline'
              disabled={busy}
              onClick={() =>
                act(() => api.createBackup('database'), t('settings.backup.started'))
              }
            >
              {t('settings.backup.runDatabase')}
            </Button>
            <Button
              variant='outline'
              disabled={busy}
              onClick={() =>
                act(() => api.createBackup('full'), t('settings.backup.started'))
              }
            >
              {t('settings.backup.runFull')}
            </Button>
          </div>

          <div className='flex flex-col divide-y'>
            {jobs.length === 0 && (
              <p className='text-muted-foreground py-4 text-sm'>
                {t('settings.backup.empty')}
              </p>
            )}
            {jobs.map((job) => (
              <div
                key={job.id}
                className='flex flex-wrap items-center justify-between gap-2 py-3'
              >
                <div className='min-w-0'>
                  <div className='flex items-center gap-2'>
                    <Badge variant={statusVariant(job.status)}>{job.status}</Badge>
                    <Badge variant='outline'>{job.scope}</Badge>
                    <span className='text-sm'>
                      {job.created_at ? new Date(job.created_at).toLocaleString() : '—'}
                    </span>
                  </div>
                  <p className='text-muted-foreground truncate text-xs'>
                    {job.status === 'running'
                      ? job.phase
                      : (job.error_summary ??
                        `${formatBytes(job.archive_bytes)} · ${job.file_count} files`)}
                  </p>
                </div>
                <div className='flex gap-2'>
                  <Button
                    size='sm'
                    variant='ghost'
                    disabled={busy || locked || job.status !== 'completed'}
                    onClick={() =>
                      act(
                        () =>
                          api.downloadBackup(job.id, job.archive_filename ?? `${job.id}.tar.gz`),
                        t('settings.backup.downloaded')
                      )
                    }
                  >
                    {t('settings.backup.download')}
                  </Button>

                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        size='sm'
                        variant='ghost'
                        disabled={busy || locked || job.status !== 'completed'}
                      >
                        {t('settings.backup.restore')}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>
                          {t('settings.backup.restoreConfirmTitle')}
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          {t('settings.backup.restoreConfirmDesc')}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() =>
                            act(
                              () => api.restoreBackup(job.id),
                              t('settings.backup.restoreStarted')
                            )
                          }
                        >
                          {t('settings.backup.restore')}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>

                  <Button
                    size='sm'
                    variant='ghost'
                    disabled={busy || locked || job.status === 'deleted'}
                    onClick={() =>
                      act(() => api.deleteBackup(job.id), t('settings.backup.deleted'))
                    }
                  >
                    {t('settings.backup.delete')}
                  </Button>
                </div>
              </div>
            ))}
          </div>
          {msg && <p className='text-muted-foreground text-sm'>{msg}</p>}
        </CardContent>
      </Card>
    </div>
  )
}
