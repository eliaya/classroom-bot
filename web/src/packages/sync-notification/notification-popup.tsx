import { useEffect, useState } from 'react'
import { CheckCircle2, Eye, EyeOff, RefreshCw, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { getLabels } from './config'
import { useSyncStatusStore } from './sync-status-store'
import type { SyncNotificationLabels } from './types'

/**
 * Global, top-centered Sync Job notification — styled like a compact audio
 * player (status icon · title/progress · actions).
 *
 * It is purely a *subscriber*: it reads from `useSyncStatusStore` and renders.
 * It performs NO sync work. Mount it once (e.g. in your app shell) so a single
 * shared instance is visible from every page.
 *
 * By default it shows only the progress bar + live percentage; the eye button
 * on the right toggles the detailed progress data inline.
 *
 * i18n is optional: pass a `labels` object to override the configured/default
 * English strings. Wire it to a `t()` function for reactive translations.
 */
export function NotificationPopUp({
  labels,
}: {
  labels?: Partial<SyncNotificationLabels>
}) {
  const l = { ...getLabels(), ...labels }
  const phase = useSyncStatusStore((s) => s.phase)
  const progress = useSyncStatusStore((s) => s.progress)
  const message = useSyncStatusStore((s) => s.message)
  const resource = useSyncStatusStore((s) => s.resource)
  const itemsCount = useSyncStatusStore((s) => s.itemsCount)
  const startPolling = useSyncStatusStore((s) => s.startPolling)
  const stopPolling = useSyncStatusStore((s) => s.stopPolling)

  // Local-only show/hide state for the detailed progress data.
  const [showDetails, setShowDetails] = useState(false)

  // Observe sync status app-wide for as long as the layout is mounted.
  useEffect(() => {
    startPolling()
    return () => stopPolling()
  }, [startPolling, stopPolling])

  const visible = phase !== 'idle'
  const isRunning = phase === 'running'
  const isError = phase === 'error'
  const isSuccess = phase === 'success'

  const title = isRunning
    ? l.syncingPercent(Math.round(progress))
    : isSuccess
      ? l.successTitle
      : isError
        ? l.errorTitle
        : ''

  const hasDetails = itemsCount > 0 || !!message || !!resource

  return (
    // Must sit above the fixed header (z-50) and sidebar (z-10), otherwise it
    // renders behind them and stays invisible. pointer-events gated so it never
    // blocks the page when hidden.
    <div
      className={cn(
        'pointer-events-none fixed inset-x-0 top-3 z-[60] flex justify-center px-4',
        'transition-all duration-300 ease-out',
        visible ? 'translate-y-0 opacity-100' : '-translate-y-4 opacity-0'
      )}
      aria-hidden={!visible}
    >
      <div
        role='status'
        aria-live='polite'
        className={cn(
          'pointer-events-auto flex w-full max-w-md items-center gap-3',
          'rounded-2xl border bg-card/50 py-2 pr-2 pl-3 shadow-lg backdrop-blur-md',
          'supports-[backdrop-filter]:bg-card/30'
        )}
      >
        {/* Status icon (left) */}
        <div
          className={cn(
            'flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
            isRunning && 'bg-primary/10 text-primary',
            isSuccess && 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
            isError && 'bg-destructive/10 text-destructive'
          )}
        >
          {isRunning && <RefreshCw className='h-4 w-4 animate-spin' />}
          {isSuccess && <CheckCircle2 className='h-4 w-4' />}
          {isError && <XCircle className='h-4 w-4' />}
        </div>

        {/* Title + progress (middle) — collapsed view shows only this */}
        <div className='min-w-0 flex-1'>
          <span className='truncate text-sm font-medium'>{title}</span>

          {/* Animated progress bar */}
          <div className='mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted'>
            <div
              className={cn(
                'h-full rounded-full transition-[width] duration-500 ease-out',
                isError ? 'bg-destructive' : isSuccess ? 'bg-emerald-500' : 'bg-primary'
              )}
              style={{
                width: `${isRunning ? Math.max(3, Math.min(100, progress)) : 100}%`,
              }}
            />
          </div>

          {/* Detailed progress data — hidden by default, toggled by the eye */}
          <div
            className={cn(
              'grid transition-all duration-300 ease-out',
              showDetails ? 'mt-1.5 grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
            )}
          >
            <div className='min-w-0 overflow-hidden'>
              {itemsCount > 0 && (
                <p className='text-[11px] tabular-nums text-muted-foreground'>
                  {l.items(itemsCount)}
                </p>
              )}
              {resource && (
                <p className='truncate text-[11px] text-muted-foreground' title={resource}>
                  {resource}
                </p>
              )}
              {message && (
                <p className='truncate text-[11px] text-muted-foreground' title={message}>
                  {message}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Actions (right) — eye toggles details inline */}
        <Button
          variant='ghost'
          size='icon'
          className='h-7 w-7 shrink-0 rounded-full text-muted-foreground'
          onClick={() => setShowDetails((v) => !v)}
          disabled={!hasDetails}
          aria-expanded={showDetails}
          aria-label={showDetails ? l.hideDetailsAria : l.showDetailsAria}
          title={showDetails ? l.hideDetailsAria : l.showDetailsAria}
        >
          {showDetails ? <EyeOff className='h-4 w-4' /> : <Eye className='h-4 w-4' />}
        </Button>
      </div>
    </div>
  )
}
