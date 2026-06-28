import { useEffect, useState } from 'react'
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
import { api, type AuditRetentionStatus } from '@/lib/api'

/** Audit-log auto-rotation: enable + retention-days threshold. */
export function AuditSection() {
  const { t } = useTranslation()
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

  useEffect(() => {
    api
      .getAuditRetention()
      .then(applyRetention)
      .catch((e) => setRetentionMsg(e instanceof Error ? e.message : t('settings.loadFailed')))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  const retentionDirty =
    auditRetention != null &&
    (Number(retentionInput) !== auditRetention.retention_days ||
      retentionEnabled !== auditRetention.enabled)

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.auditRetention')}</CardTitle>
        <CardDescription>
          {t('settings.auditRetentionDesc', { max: auditRetention?.max_retention_days ?? 30 })}
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
        {retentionMsg && <p className='text-muted-foreground text-xs'>{retentionMsg}</p>}
      </CardContent>
    </Card>
  )
}
