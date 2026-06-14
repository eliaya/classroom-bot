import { useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import {
  AlertCircle,
  Bot,
  GraduationCap,
  KeyRound,
  RefreshCw,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { humanReadableTime, fullTimestamp } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Main } from '@/components/layout/main'
import { api, type BotStatus, type SyncRun } from '@/lib/api'
import { GreenCheckIcon } from '@/components/green-check-icon'
import { ClassroomHeader } from './layout-header'

const BOT_STATUS_STYLES: Record<string, string> = {
  connected: 'text-green-success',
  disconnected: 'text-destructive',
  error: 'text-destructive',
  disabled: 'text-muted-foreground',
  unknown: 'text-muted-foreground',
}

export function ClassroomDashboard() {
  const { t } = useTranslation()
  const [courseCount, setCourseCount] = useState(0)
  const [googleStatus, setGoogleStatus] = useState('unknown')
  const [lastRun, setLastRun] = useState<string | null>(null)
  const [errorCount, setErrorCount] = useState(0)
  const [recentRuns, setRecentRuns] = useState<SyncRun[]>([])
  const [botStatus, setBotStatus] = useState<BotStatus | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    try {
      setError(null)
      const [courses, status, sync, botRes] = await Promise.all([
        api.listCourses(),
        api.status(),
        api.syncStatus(),
        api.botStatus().catch(() => null),
      ])
      setCourseCount(courses.total)
      setGoogleStatus(status.google_credentials)
      setLastRun(sync.runs[0]?.finished_at || sync.runs[0]?.started_at || null)
      setErrorCount(sync.runs.filter((r) => r.status === 'error').length)
      setRecentRuns(sync.runs.slice(0, 8))
      setBotStatus(botRes)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load dashboard')
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const handleSync = async () => {
    setSyncing(true)
    try {
      await api.triggerSync()
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sync failed')
    } finally {
      setSyncing(false)
    }
  }

  return (
    <>
      <ClassroomHeader fixed />
      <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>
        <div className='flex flex-wrap items-end justify-between gap-2'>
          <div>
            <h2 className='text-2xl font-bold tracking-tight'>Dashboard</h2>
            <p className='text-muted-foreground'>
              Google Classroom data cached in local SQLite
            </p>
          </div>
          <Button onClick={() => void handleSync()} disabled={syncing}>
            <RefreshCw className={syncing ? 'animate-spin' : ''} />
            {syncing ? 'Syncing…' : 'Sync all courses'}
          </Button>
        </div>

        {error && (
          <Card className='border-destructive'>
            <CardContent className='pt-6 text-destructive text-sm'>
              {error}
            </CardContent>
          </Card>
        )}

        <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5'>
          <Card>
            <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
              <CardTitle className='text-sm font-medium'>Courses</CardTitle>
              <GraduationCap className='h-4 w-4 text-muted-foreground' />
            </CardHeader>
            <CardContent>
              <div className='text-2xl font-bold'>{courseCount}</div>
              <p className='text-xs text-muted-foreground'>Cached in database</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
              <CardTitle className='text-sm font-medium'>Google OAuth</CardTitle>
              <KeyRound className='h-4 w-4 text-muted-foreground' />
            </CardHeader>
            <CardContent>
              <div className='flex h-8 items-center'>
                {googleStatus === 'valid' ? (
                  <GreenCheckIcon label={t('dashboard.oauthValidLabel')} />
                ) : (
                  <span className='text-2xl font-bold capitalize'>
                    {googleStatus}
                  </span>
                )}
              </div>
              <p className='text-xs text-muted-foreground'>API credential status</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
              <CardTitle className='text-sm font-medium'>
                {t('dashboard.lastSync')}
              </CardTitle>
              <RefreshCw className='h-4 w-4 text-muted-foreground' />
            </CardHeader>
            <CardContent>
              <div
                className='text-lg font-bold'
                title={fullTimestamp(lastRun) || undefined}
              >
                {humanReadableTime(lastRun, t('common.never'))}
              </div>
              <p className='text-xs text-muted-foreground'>
                {t('dashboard.mostRecentRun')}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
              <CardTitle className='text-sm font-medium'>
                {t('dashboard.botStatus')}
              </CardTitle>
              <Bot className='h-4 w-4 text-muted-foreground' />
            </CardHeader>
            <CardContent>
              <div
                className={`text-2xl font-bold capitalize ${
                  BOT_STATUS_STYLES[botStatus?.status ?? 'unknown'] ??
                  'text-muted-foreground'
                }`}
              >
                {t(`bot.${botStatus?.status ?? 'unknown'}`)}
              </div>
              <p className='text-xs text-muted-foreground'>
                {t('common.lastCheck')}:{' '}
                <span title={fullTimestamp(botStatus?.last_heartbeat) || undefined}>
                  {humanReadableTime(
                    botStatus?.last_heartbeat,
                    t('common.dash')
                  )}
                </span>
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
              <CardTitle className='text-sm font-medium'>Sync errors</CardTitle>
              <AlertCircle className='h-4 w-4 text-muted-foreground' />
            </CardHeader>
            <CardContent>
              <div className='text-2xl font-bold'>{errorCount}</div>
              <p className='text-xs text-muted-foreground'>Failed runs in history</p>
            </CardContent>
          </Card>
        </div>

        <div className='grid grid-cols-1 gap-4 lg:grid-cols-7'>
          <Card className='col-span-1 lg:col-span-4'>
            <CardHeader>
              <CardTitle>Recent sync runs</CardTitle>
              <CardDescription>Latest background sync activity</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Resource</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Items</TableHead>
                    <TableHead>Finished</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentRuns.map((run) => (
                    <TableRow key={run.id}>
                      <TableCell>{run.resource}</TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            run.status === 'error' ? 'destructive' : 'secondary'
                          }
                        >
                          {run.status}
                        </Badge>
                      </TableCell>
                      <TableCell>{run.items_count}</TableCell>
                      <TableCell
                        className='text-muted-foreground text-sm'
                        title={
                          fullTimestamp(run.finished_at || run.started_at) ||
                          undefined
                        }
                      >
                        {humanReadableTime(
                          run.finished_at || run.started_at,
                          '—'
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {!recentRuns.length && (
                    <TableRow>
                      <TableCell colSpan={4} className='text-muted-foreground'>
                        No sync runs yet. Trigger a sync to populate the cache.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          <Card className='col-span-1 lg:col-span-3'>
            <CardHeader>
              <CardTitle>Quick actions</CardTitle>
              <CardDescription>Navigate to common tasks</CardDescription>
            </CardHeader>
            <CardContent className='flex flex-col gap-2'>
              <Button variant='outline' asChild className='justify-start'>
                <Link to='/courses'>Browse courses</Link>
              </Button>
              <Button variant='outline' asChild className='justify-start'>
                <Link to='/sync'>View sync history</Link>
              </Button>
              <Button variant='outline' asChild className='justify-start'>
                <Link to='/settings'>API & OAuth settings</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </Main>
    </>
  )
}