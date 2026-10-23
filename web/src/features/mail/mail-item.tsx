import { Star } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { MailLabel, MailThreadSummary } from '@/lib/api'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { InboxItem } from './inbox-ui'
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
    <InboxItem
      avatar={
        <Avatar className='size-10 shrink-0'>
          <AvatarFallback>{initials(item.from_name)}</AvatarFallback>
        </Avatar>
      }
      name={item.from_name}
      badges={
        item.starred && <Star className='size-3.5 shrink-0 fill-amber-400 text-amber-400' aria-label={t('mail.starred')} />
      }
      time={formatMailDate(item.date, i18n.language)}
      subject={
        <>
          {item.subject || t('mail.noSubject')}
          {item.count > 1 && <span className='ml-1 font-normal text-muted-foreground'>({item.count})</span>}
        </>
      }
      trailing={
        !!dots.length && dots.map(([l, i]) => <LabelDot key={l.id} label={l} index={i} className='size-1.5' />)
      }
      snippet={item.snippet}
      unread={item.unread}
      selected={selected}
      onSelect={onSelect}
    />
  )
}
