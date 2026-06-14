import { type ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * Contextual per-row action revealed on row hover/focus (replaces the Sync
 * table's Actions column). A real <button> with an accessible name, so it is
 * reachable by keyboard (Tab) and announced by screen readers.
 */
export function RowActionButton({
  label,
  onClick,
  variant = 'outline',
  title,
}: {
  label: string
  onClick: () => void
  variant?: 'outline' | 'destructive'
  title?: string
}) {
  return (
    <Button
      variant={variant}
      size='sm'
      className='pointer-events-auto h-7 px-2 text-[10px]'
      onClick={onClick}
      aria-label={label}
      title={title}
    >
      {label}
    </Button>
  )
}

/**
 * Sync run progress bar. The fill uses the primary color, switching to the
 * solid success-green `.progress--complete` class when the run reaches 100%.
 */
export function RunProgressBar({ percent }: { percent: number }) {
  const clamped = Math.min(100, Math.max(0, percent))
  const complete = clamped >= 100
  return (
    <div className='bg-muted h-1.5 w-16 overflow-hidden rounded'>
      <div
        data-testid='progress-bar'
        data-complete={complete}
        className={cn('progress__bar h-1.5 transition-all', complete && 'progress--complete')}
        style={{ width: `${clamped}%` }}
      />
    </div>
  )
}

/**
 * Sync run status badge. A "success" status renders in success-green via the
 * `.status--success` class.
 */
export function RunStatusBadge({
  status,
  children,
}: {
  status: string
  children?: ReactNode
}) {
  return (
    <Badge
      variant={
        status === 'error'
          ? 'destructive'
          : status === 'running'
            ? 'default'
            : 'secondary'
      }
      className={cn(status === 'success' && 'status--success')}
    >
      {children ?? status}
    </Badge>
  )
}
