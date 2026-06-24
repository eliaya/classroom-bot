import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

/**
 * Action feedback toasts styled to match the `sync-notification` popup
 * (status icon in a tinted circle · title · optional message). Built on the
 * already-mounted sonner `<Toaster />`, so it owns queueing/auto-dismiss.
 * Pass already-translated strings (call `t()` at the call site).
 */
type Variant = 'success' | 'error' | 'warning' | 'info'

const VARIANT = {
  success: { Icon: CheckCircle2, ring: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' },
  error: { Icon: XCircle, ring: 'bg-destructive/10 text-destructive' },
  warning: { Icon: AlertTriangle, ring: 'bg-amber-500/10 text-amber-600 dark:text-amber-400' },
  info: { Icon: Info, ring: 'bg-primary/10 text-primary' },
} as const

function Card({ variant, title, message }: { variant: Variant; title: string; message?: string }) {
  const { Icon, ring } = VARIANT[variant]
  return (
    <div
      className={cn(
        'pointer-events-auto flex w-full items-center gap-3',
        'rounded-2xl border bg-card/50 py-2 pr-3 pl-3 shadow-lg backdrop-blur-md',
        'supports-[backdrop-filter]:bg-card/30'
      )}
    >
      <div className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-full', ring)}>
        <Icon className='h-4 w-4' />
      </div>
      <div className='min-w-0 flex-1'>
        <p className='truncate text-sm font-medium'>{title}</p>
        {message && (
          <p className='truncate text-[11px] text-muted-foreground' title={message}>
            {message}
          </p>
        )}
      </div>
    </div>
  )
}

const make = (variant: Variant) => (title: string, message?: string) =>
  toast.custom(() => <Card variant={variant} title={title} message={message} />, {
    unstyled: true,
    duration: variant === 'error' ? 6000 : 4000,
  })

export const notify = {
  success: make('success'),
  error: make('error'),
  warning: make('warning'),
  info: make('info'),
}
