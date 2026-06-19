import { useEffect, useRef, useState } from 'react'
import { RefreshCw, XCircle, Eye, Trash2 } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { Trans, useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Main } from '@/components/layout/main'
import { api, type SyncRun } from '@/lib/api'
import { ClassroomHeader } from './layout-header'
import { RunProgressBar, RunStatusBadge } from './components/run-indicators'

const BUILD_TIME = import.meta.env.VITE_BUILD_TIME as string | undefined

// Success runs are always 100% in the UI. Historical records may carry a
// transient "finalizing" value (e.g. 98); normalize them for display only.
function getDisplayPercent(run: SyncRun): number | null {
  if (run.status === 'success') return 100
  return run.percent ?? null
}

export function SyncPage() {
  const { t } = useTranslation()
  const [runs, setRuns] = useState<SyncRun[]>([])
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [credentialError, setCredentialError] = useState<string | null>(null)
  const [detailRun, setDetailRun] = useState<SyncRun | null>(null)

  // Pagination and filter states (10 per page + search/filter)
  const [page, setPage] = useState(1)
  const [limit] = useState(10)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("")
  const [total, setTotal] = useState(0)

  const pollIntervalRef = useRef<number | null>(null)
  const loadRef = useRef<((opts?: { page?: number }) => Promise<void>) | null>(null)

  const load = async (opts: { page?: number } = {}) => {
    try {
      const p = opts.page ?? page
      const [syncData, status] = await Promise.all([
        api.syncStatus({ page: p, limit, search: search || undefined, status: statusFilter || undefined }),
        api.status(),
      ])
      setRuns(syncData.runs)
      if (typeof syncData.total === 'number') setTotal(syncData.total)
      if (typeof syncData.page === 'number') setPage(syncData.page)
      setError(null)
      if (status.google_credentials !== 'valid') {
        setCredentialError(
          status.google?.error || t('sync.oauthNotConfigured')
        )
      } else {
        setCredentialError(null)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.loadFailed'))
      setRuns([])
    }
  }

  // Keep a stable ref to the latest load function to avoid stale closures in interval
  useEffect(() => {
    loadRef.current = load
  }, [load])

  // Live polling while a sync is running
  const startLivePolling = () => {
    if (pollIntervalRef.current) return
    pollIntervalRef.current = window.setInterval(() => {
      void loadRef.current?.()
    }, 1400)
  }

  const stopLivePolling = () => {
    if (pollIntervalRef.current) {
      window.clearInterval(pollIntervalRef.current)
      pollIntervalRef.current = null
    }
  }

  useEffect(() => {
    void load()
    return () => stopLivePolling()
  }, [])

  // Watch runs and toggle live polling
  useEffect(() => {
    const hasActiveRun = runs.some((r) => r.status === 'running')
    if (hasActiveRun) {
      startLivePolling()
    } else {
      stopLivePolling()
    }
  }, [runs])

  const handleSync = async () => {
    setSyncing(true)
    try {
      await api.triggerSync()
      // Immediately refresh a few times so the new running run appears fast
      await load()
      // polling effect will take over
    } catch (e) {
      setError(e instanceof Error ? e.message : t('sync.syncFailed'))
    } finally {
      setSyncing(false)
    }
  }

  const activeRun = runs.find((r) => r.status === 'running')
  const isLiveSyncing = !!activeRun || syncing

  const isStaleRunning = (run: SyncRun) => {
    if (run.status !== 'running' || !run.started_at) return false
    const started = new Date(run.started_at)
    const ageHours = (Date.now() - started.getTime()) / (1000 * 60 * 60)
    return ageHours > 0.5 // > 30 minutes running without finishing → likely dead/stuck
  }

  const handleClearDead = async (runId: number) => {
    try {
      await api.clearDeadRun(runId)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('sync.clearDeadFailed'))
    }
  }

  const handleDeleteRun = async (runId: number) => {
    try {
      await api.deleteRun(runId)
      if (detailRun?.id === runId) setDetailRun(null)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('sync.deleteFailed'))
    }
  }

  // Debounce search -> reset page + reload
  useEffect(() => {
    const t = setTimeout(() => {
      setPage(1)
      load({ page: 1 })
    }, 350)
    return () => clearTimeout(t)
  }, [search])

  // Status filter change -> reset + reload
  useEffect(() => {
    setPage(1)
    load({ page: 1 })
  }, [statusFilter])

  return (
    <>
      <ClassroomHeader
        fixed
        title={t('sync.title')}
        description={t('sync.desc')}
      />
      <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>
        <div className='flex flex-wrap items-end justify-between gap-2'>
          <div>
            {BUILD_TIME && (
              <p className='text-[10px] text-muted-foreground/70'>{t('sync.built', { time: BUILD_TIME })}</p>
            )}
          </div>
          <Button onClick={() => void handleSync()} disabled={isLiveSyncing}>
            <RefreshCw className={isLiveSyncing ? 'animate-spin' : ''} />
            {isLiveSyncing ? t('sync.syncing') : t('sync.syncNow')}
          </Button>
        </div>

        {credentialError && (
          <Alert variant='destructive'>
            <AlertTitle>{t('sync.oauthNotReady')}</AlertTitle>
            <AlertDescription className='space-y-2'>
              <p>{credentialError}</p>
              <p className='text-sm'>
                <Trans
                  i18nKey='sync.hostInstructions'
                  components={{
                    code: <code className='rounded bg-muted px-1 py-0.5' />,
                  }}
                />
              </p>
            </AlertDescription>
          </Alert>
        )}

        {error && <p className='text-destructive text-sm'>{error}</p>}

        {runs.some(isStaleRunning) && (
          <p className="rounded border border-orange-200 bg-orange-50 px-3 py-1 text-xs text-orange-700">
            {t('sync.stuckWarning')}
          </p>
        )}

        {/* Search + Filters for paginated table (10 per page) */}
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[180px]">
            <div className="text-[10px] text-muted-foreground mb-0.5">{t('sync.searchLabel')}</div>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('sync.searchPlaceholder')}
              className="w-full rounded-md border bg-background px-2 py-1 text-sm"
            />
          </div>
          <div>
            <div className="text-[10px] text-muted-foreground mb-0.5">{t('common.status')}</div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-md border bg-background px-2 py-1 text-sm"
            >
              <option value="">{t('common.all')}</option>
              <option value="running">running</option>
              <option value="success">success</option>
              <option value="error">error</option>
            </select>
          </div>
          <Button size="sm" variant="outline" onClick={() => load({ page: 1 })}>
            {t('common.apply')}
          </Button>
          {(search || statusFilter) && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setSearch("")
                setStatusFilter("")
                setPage(1)
                load({ page: 1 })
              }}
            >
              {t('common.clearFilters')}
            </Button>
          )}
        </div>

        {/* LIVE PROGRESS BAR SECTION */}
        {activeRun && (
          <div className='rounded-xl border bg-card p-4 shadow-sm'>
            <div className='mb-3 flex items-center justify-between'>
              <div className='flex items-center gap-2'>
                <RefreshCw className='h-4 w-4 animate-spin text-primary' />
                <span className='font-semibold'>{t('sync.liveProgress')}</span>
                <Badge variant='outline' className='text-[10px]'>{t('sync.realtime')}</Badge>
              </div>
              <span className='text-xs text-muted-foreground'>
                {activeRun.percent != null ? `${activeRun.percent}%` : t('sync.running')}
              </span>
            </div>

            {/* Progress bar */}
            <div className='mb-3 h-3 w-full overflow-hidden rounded-full bg-muted'>
              <div
                className='h-3 rounded-full bg-primary transition-all duration-300 ease-out'
                style={{
                  width: `${activeRun.percent != null ? Math.max(3, Math.min(100, activeRun.percent)) : 8}%`,
                }}
              />
            </div>

            <div className='grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2'>
              <div>
                <span className='text-muted-foreground'>{t('sync.current')}</span>
                <span className='font-medium'>
                  {activeRun.message || `${activeRun.resource} sync`}
                </span>
              </div>
              <div>
                <span className='text-muted-foreground'>{t('sync.itemsSoFar')}</span>
                <span className='font-medium tabular-nums'>{activeRun.items_count}</span>
              </div>
              <div>
                <span className='text-muted-foreground'>{t('sync.resourceLabel')}</span>
                <span>{activeRun.resource}{activeRun.course_id ? ` (${activeRun.course_id})` : ''}</span>
              </div>
              <div className='text-muted-foreground'>
                {t('sync.started', { time: activeRun.started_at ? new Date(activeRun.started_at).toLocaleTimeString() : t('sync.justNow') })}
              </div>
            </div>

            <p className='mt-2 text-[11px] text-muted-foreground'>
              {t('sync.liveHint')}
            </p>
          </div>
        )}

        {/* History table */}
        <div className='overflow-hidden rounded-md border'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('sync.colId')}</TableHead>
                <TableHead>{t('sync.colResource')}</TableHead>
                <TableHead>{t('sync.colCourse')}</TableHead>
                <TableHead>{t('sync.colStatus')}</TableHead>
                <TableHead>{t('sync.colProgress')}</TableHead>
                <TableHead>{t('sync.colItems')}</TableHead>
                <TableHead>{t('sync.colFinished')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map((run) => {
                const displayPercent = getDisplayPercent(run)
                return (
                <TableRow
                  key={run.id}
                  className={cn(
                    run.status === 'running'
                      ? isStaleRunning(run)
                        ? 'bg-orange-500/10'
                        : 'bg-muted/40'
                      : ''
                  )}
                >
                  <TableCell>{run.id}</TableCell>
                  <TableCell className='font-medium'>{run.resource}</TableCell>
                  <TableCell className='font-mono text-xs'>
                    {run.course_id || '—'}
                  </TableCell>
                  <TableCell>
                    <div className='flex items-center gap-1.5'>
                      <RunStatusBadge status={run.status}>
                        {run.status}
                        {isStaleRunning(run) && t('sync.stuck')}
                      </RunStatusBadge>
                      {(run.error_message || run.message) && (
                        <Button
                          variant='ghost'
                          size='icon'
                          className='h-6 w-6 text-muted-foreground'
                          onClick={() => setDetailRun(run)}
                          aria-label={t('sync.viewDetailAria')}
                          title={t('sync.viewDetailTitle')}
                        >
                          <Eye className='h-4 w-4' />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {displayPercent != null ? (
                      <div className='flex flex-col gap-0.5 text-xs'>
                        <div className='flex items-center gap-2'>
                          <RunProgressBar percent={displayPercent} />
                          <span>{displayPercent}%</span>
                        </div>
                        {run.status === 'running' && run.message && (
                          <div className='text-[10px] text-muted-foreground truncate max-w-[110px]' title={run.message}>
                            {run.message}
                          </div>
                        )}
                      </div>
                    ) : run.status === 'running' ? (
                      <div className='flex items-center gap-1.5 text-xs text-muted-foreground'>
                        <div className='h-1.5 w-8 animate-pulse rounded bg-primary/40' />
                        <span>{t('sync.runningShort')}</span>
                        {run.message && (
                          <span className='ml-1 truncate max-w-[80px] text-[10px]' title={run.message}>
                            {run.message}
                          </span>
                        )}
                      </div>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                  <TableCell className='tabular-nums'>{run.items_count}</TableCell>
                  <TableCell className='text-muted-foreground text-sm'>
                    <div className='flex items-center gap-2'>
                      <span>
                        {run.finished_at
                          ? formatDistanceToNow(new Date(run.finished_at), { addSuffix: true })
                          : run.started_at
                            ? t('sync.startedAgo', { time: formatDistanceToNow(new Date(run.started_at), { addSuffix: true }) })
                            : '—'}
                      </span>
                      {/* Any 'running' job can be force-released here (e.g. after a
                          crash/restart left it dangling). Jobs running >30min are
                          additionally flagged as likely stuck via the title text. */}
                      {run.status === 'running' && (
                        <Button
                          variant='ghost'
                          size='icon'
                          className='text-destructive h-6 w-6'
                          onClick={() => void handleClearDead(run.id)}
                          aria-label={t('sync.clearStuckAria')}
                          title={
                            isStaleRunning(run)
                              ? t('sync.clearStuckStaleTitle')
                              : t('sync.clearStuckTitle')
                          }
                        >
                          <XCircle className='h-4 w-4' />
                        </Button>
                      )}
                      {/* Finished (error/success) runs can be deleted from history. */}
                      {run.status !== 'running' && (
                        <Button
                          variant='ghost'
                          size='icon'
                          className='text-destructive h-6 w-6'
                          onClick={() => void handleDeleteRun(run.id)}
                          aria-label={t('sync.deleteAria')}
                          title={t('sync.deleteTitle')}
                        >
                          <Trash2 className='h-4 w-4' />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
                )
              })}
              {!runs.length && (
                <TableRow>
                  <TableCell colSpan={7} className='text-muted-foreground'>
                    {search || statusFilter
                      ? t('sync.noRunsFiltered')
                      : t('sync.noRuns')}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination (10 per page) */}
        {total > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
            <div>
              {t('sync.showingRange', {
                from: Math.min((page - 1) * limit + 1, total),
                to: Math.min(page * limit, total),
                total,
              })}
            </div>
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant="outline"
                disabled={page <= 1}
                onClick={() => {
                  const p = page - 1
                  setPage(p)
                  load({ page: p })
                }}
              >
                {t('common.prev')}
              </Button>
              <span className="px-2 tabular-nums">{t('sync.page', { page })}</span>
              <Button
                size="sm"
                variant="outline"
                disabled={page * limit >= total}
                onClick={() => {
                  const p = page + 1
                  setPage(p)
                  load({ page: p })
                }}
              >
                {t('common.next')}
              </Button>
            </div>
          </div>
        )}

        {/* Run detail dialog — surfaces the full error/status message that the
            table otherwise truncates or hides. */}
        <Dialog open={!!detailRun} onOpenChange={(open) => !open && setDetailRun(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {t('sync.runDetail', { id: detailRun?.id, resource: detailRun?.resource })}
                {detailRun?.course_id ? ` (${detailRun.course_id})` : ''}
              </DialogTitle>
              <DialogDescription>
                {t('sync.detailStatus', { status: detailRun?.status })}
              </DialogDescription>
            </DialogHeader>
            <div className='space-y-3 text-sm'>
              {detailRun?.error_message && (
                <div>
                  <div className='mb-1 font-medium text-destructive'>{t('sync.errorLabel')}</div>
                  <pre className='max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-destructive/10 p-3 text-xs text-destructive'>
                    {detailRun.error_message}
                  </pre>
                </div>
              )}
              {detailRun?.message && (
                <div>
                  <div className='mb-1 font-medium'>{t('sync.lastMessage')}</div>
                  <pre className='max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-3 text-xs'>
                    {detailRun.message}
                  </pre>
                </div>
              )}
              <div className='grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground'>
                <div>{t('sync.detailItems')}: <span className='tabular-nums text-foreground'>{detailRun?.items_count}</span></div>
                <div>{t('sync.detailPercent')}: <span className='tabular-nums text-foreground'>{detailRun?.percent ?? '—'}</span></div>
                <div>{t('sync.detailStarted')}: <span className='text-foreground'>{detailRun?.started_at ? new Date(detailRun.started_at).toLocaleString() : '—'}</span></div>
                <div>{t('sync.detailFinished')}: <span className='text-foreground'>{detailRun?.finished_at ? new Date(detailRun.finished_at).toLocaleString() : '—'}</span></div>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </Main>
    </>
  )
}