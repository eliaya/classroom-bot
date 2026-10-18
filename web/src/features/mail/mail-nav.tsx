import { type LucideIcon, Archive, File, Inbox, OctagonAlert, Send, SquarePen, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { MailLabel } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { LabelDot } from './label-dot'
import { GMAIL_COMPOSE_URL, labelName } from './mail-utils'

const MAILBOX_ICONS: Record<string, LucideIcon> = {
  INBOX: Inbox,
  DRAFT: File,
  SENT: Send,
  SPAM: OctagonAlert,
  TRASH: Trash2,
  ARCHIVE: Archive,
}

type MailNavProps = {
  mailboxes: MailLabel[]
  labels: MailLabel[]
  selected: string
  onSelect: (id: string) => void
}

/** Left pane: Compose, the mailboxes and the labels with their counts. */
export function MailNav({ mailboxes, labels, selected, onSelect }: MailNavProps) {
  const { t } = useTranslation()

  const item = (label: MailLabel, icon: React.ReactNode) => {
    const active = label.id === selected
    return (
      <Button
        key={label.id}
        variant='ghost'
        aria-current={active ? 'page' : undefined}
        onClick={() => onSelect(label.id)}
        className={cn(
          'justify-start gap-2.5 px-3',
          active
            ? 'bg-accent text-accent-foreground hover:bg-accent hover:text-accent-foreground'
            : 'text-foreground/80 hover:bg-muted/60'
        )}
      >
        {icon}
        <span className='min-w-0 truncate'>{labelName(t, label)}</span>
        {label.count ? (
          <span className='ml-auto text-xs text-muted-foreground tabular-nums'>{label.count}</span>
        ) : null}
      </Button>
    )
  }

  return (
    <div className='flex h-full flex-col bg-card'>
      <div className='p-3'>
        <Button asChild className='w-full'>
          <a href={GMAIL_COMPOSE_URL} target='_blank' rel='noreferrer'>
            <SquarePen />
            {t('mail.compose')}
          </a>
        </Button>
      </div>
      <Separator />
      <div className='flex flex-1 flex-col gap-4 overflow-auto p-3 max-lg:pt-0'>
        <div>
          <p className='px-2 pb-2.5 text-[11px] font-medium text-muted-foreground uppercase'>
            {t('mail.mailboxesTitle')}
          </p>
          <nav aria-label={t('mail.mailboxesTitle')} className='grid gap-1'>
            {mailboxes.map((m) => {
              const Icon = MAILBOX_ICONS[m.id] ?? Inbox
              return item(m, <Icon aria-hidden='true' />)
            })}
          </nav>
        </div>
        <Separator />
        <div>
          <p className='px-2 pb-2.5 text-[11px] font-medium text-muted-foreground uppercase'>
            {t('mail.labelsTitle')}
          </p>
          <nav aria-label={t('mail.labelsTitle')} className='grid gap-1'>
            {labels.map((l, i) => item(l, <LabelDot label={l} index={i} className='size-2' />))}
          </nav>
        </div>
      </div>
    </div>
  )
}
