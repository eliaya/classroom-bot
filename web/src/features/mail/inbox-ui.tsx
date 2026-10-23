import type { ComponentProps, ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

/* The Dashboard's one design for its list and post panels — the Mail UI's —
   shared by the course posts and the mail conversations. */

/** The list column's header: its title, and the column's controls at the right. */
export function ListHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className='flex h-14 shrink-0 items-center gap-3 border-b px-4'>
      <h2 className='truncate text-base font-medium'>{title}</h2>
      {children && <div className='ms-auto flex shrink-0 items-center gap-1'>{children}</div>}
    </div>
  )
}

/** The list header's ‹ › pager: the range shown, then the previous and next page. */
export function Pager({
  range,
  onPrev,
  onNext,
}: {
  range: string
  /** Undefined: no such page. */
  onPrev?: () => void
  onNext?: () => void
}) {
  const { t } = useTranslation()
  return (
    <>
      <span className='me-1 text-xs text-muted-foreground tabular-nums'>{range}</span>
      <Button variant='ghost' size='icon' className='size-8' aria-label={t('dashboard.prevPage')} disabled={!onPrev} onClick={onPrev}>
        <ChevronLeft className='size-4' />
      </Button>
      <Button variant='ghost' size='icon' className='size-8' aria-label={t('dashboard.nextPage')} disabled={!onNext} onClick={onNext}>
        <ChevronRight className='size-4' />
      </Button>
    </>
  )
}

/** One entry of the list: who, when, what, and a line of preview. */
export function InboxItem({
  avatar,
  name,
  badges,
  time,
  timeTitle,
  subject,
  trailing,
  snippet,
  unread,
  selected,
  onSelect,
}: {
  avatar: ReactNode
  name: string
  /** After the name, e.g. the star. */
  badges?: ReactNode
  time: string
  timeTitle?: string
  subject: ReactNode
  /** At the end of the subject line, e.g. label dots. */
  trailing?: ReactNode
  snippet: string
  unread: boolean
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type='button'
      onClick={onSelect}
      aria-current={selected ? 'true' : undefined}
      className={cn(
        'relative flex w-full items-start gap-3 rounded-md border p-3 text-left text-sm transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
        selected ? 'border-border bg-accent' : 'border-transparent hover:bg-muted/40'
      )}
    >
      {avatar}
      <div className='flex min-w-0 flex-1 flex-col gap-1'>
        <div className='flex items-center gap-2'>
          <span
            className={cn('min-w-0 flex-1 truncate text-sm', unread ? 'font-semibold text-foreground' : 'text-foreground/80')}
          >
            {name}
          </span>
          {badges}
          <span className='shrink-0 text-[11px] text-muted-foreground tabular-nums' title={timeTitle}>
            {time}
          </span>
        </div>
        <p
          className={cn(
            'line-clamp-1 flex items-center justify-between gap-1 text-xs leading-snug',
            unread ? 'font-semibold text-foreground' : 'text-foreground/75'
          )}
        >
          <span className='min-w-0 truncate'>{subject}</span>
          {trailing && <span className='flex flex-1 justify-end gap-1'>{trailing}</span>}
        </p>
        <p className='line-clamp-1 text-[11px] leading-relaxed text-muted-foreground'>{snippet}</p>
      </div>
    </button>
  )
}

/** The post panel's top bar; its buttons depend on what is open. */
export function DetailToolbar({ children }: { children: ReactNode }) {
  return (
    <>
      <div className='flex h-14 shrink-0 items-center gap-1 px-2 lg:px-3'>{children}</div>
      <Separator />
    </>
  )
}

/** Under the toolbar: who it is from, its title, and when. */
export function DetailHeader({
  avatar,
  title,
  aside,
  children,
}: {
  avatar: ReactNode
  title: string
  /** At the right, e.g. the date. */
  aside?: ReactNode
  children?: ReactNode
}) {
  return (
    <div className='border-b border-border p-3'>
      <div className='flex items-start justify-between gap-4'>
        <div className='flex min-w-0 flex-1 items-start gap-3'>
          <div className='shrink-0 max-md:hidden'>{avatar}</div>
          <div className='min-w-0 flex-1'>
            <h2 className='line-clamp-2 text-base leading-snug font-medium tracking-tight text-foreground md:font-semibold'>
              {title}
            </h2>
            {children}
          </div>
        </div>
        {aside && <span className='shrink-0 pt-0.5 text-xs text-muted-foreground'>{aside}</span>}
      </div>
    </div>
  )
}

/** An icon button named by its tooltip. */
export function IconButton({ label, children, ...props }: ComponentProps<typeof Button> & { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant='ghost' size='icon' {...props}>
          {children}
          <span className='sr-only'>{label}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
