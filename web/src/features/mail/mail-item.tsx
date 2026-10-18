import { Star } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { MailLabel, MailThreadSummary } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { LabelDot } from './label-dot'
import { formatMailDate, initials } from './mail-utils'

type MailItemProps = {
  item: MailThreadSummary
  selected: boolean
  /** The label list, to colour and order the item's label dots. */
  labels: MailLabel[]
  onSelect: () => void
}

/** One conversation in the list: sender, time, subject (count), snippet. */
export function MailItem({ item, selected, labels, onSelect }: MailItemProps) {
  const { t, i18n } = useTranslation()
  const dots = labels.map((l, i) => [l, i] as const).filter(([l]) => item.label_ids.includes(l.id))
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
      <Avatar className='size-10 shrink-0'>
        <AvatarFallback>{initials(item.from_name)}</AvatarFallback>
      </Avatar>
      <div className='flex min-w-0 flex-1 flex-col gap-1'>
        <div className='flex items-center gap-2'>
          <span
            className={cn(
              'min-w-0 flex-1 truncate text-sm',
              item.unread ? 'font-semibold text-foreground' : 'text-foreground/80'
            )}
          >
            {item.from_name}
          </span>
          {item.starred && (
            <Star className='size-3.5 shrink-0 fill-amber-400 text-amber-400' aria-label={t('mail.starred')} />
          )}
          <span className='shrink-0 text-[11px] text-muted-foreground tabular-nums'>
            {formatMailDate(item.date, i18n.language)}
          </span>
        </div>
        <p
          className={cn(
            'line-clamp-1 flex items-center justify-between gap-1 text-xs leading-snug',
            item.unread ? 'font-semibold text-foreground' : 'text-foreground/75'
          )}
        >
          <span className='min-w-0 truncate'>
            {item.subject || t('mail.noSubject')}
            {item.count > 1 && <span className='ml-1 font-normal text-muted-foreground'>({item.count})</span>}
          </span>
          <span className='flex flex-1 justify-end gap-1'>
            {dots.map(([l, i]) => (
              <LabelDot key={l.id} label={l} index={i} className='size-1.5' />
            ))}
          </span>
        </p>
        <p className='line-clamp-1 text-[11px] leading-relaxed text-muted-foreground'>{item.snippet}</p>
      </div>
    </button>
  )
}
