import { useTranslation } from 'react-i18next'
import type { MailLabel, MailThreadSummary } from '@/lib/api'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { ListHeader, Pager } from './inbox-ui'
import { MailItem } from './mail-item'

export type MailListProps = {
  title: string
  /** The conversations shown, e.g. "1–20"; null while there are none. */
  range: string | null
  /** Undefined: no such page. */
  onPrev?: () => void
  onNext?: () => void
  items: MailThreadSummary[]
  labels: MailLabel[]
  selectedId: string | null
  onSelect: (item: MailThreadSummary) => void
  loading: boolean
  error: string | null
}

/** The Dashboard's list column for a mailbox: its title and pager, as the Inbox has, and the conversations. */
export function MailList(props: MailListProps) {
  const { t } = useTranslation()
  const { items, loading } = props
  return (
    <div className='flex h-full min-h-0 flex-col overflow-hidden bg-background'>
      <ListHeader title={props.title}>
        {props.range && <Pager range={props.range} onPrev={props.onPrev} onNext={props.onNext} />}
      </ListHeader>
      {props.error && (
        <p role='alert' className='mx-3 mt-3 text-sm text-destructive'>
          {props.error}
        </p>
      )}
      <ScrollArea className='min-h-0 flex-1'>
        <div className='flex flex-col p-3' aria-busy={loading}>
          {!loading &&
            items.map((item) => (
              <MailItem
                key={item.id}
                item={item}
                labels={props.labels}
                selected={item.id === props.selectedId}
                onSelect={() => props.onSelect(item)}
              />
            ))}
          {loading &&
            Array.from({ length: 6 }, (_, i) => (
              <div key={i} className='flex gap-3 p-3'>
                <Skeleton className='size-10 rounded-full' />
                <div className='flex flex-1 flex-col gap-2'>
                  <Skeleton className='h-4 w-1/2' />
                  <Skeleton className='h-3 w-3/4' />
                  <Skeleton className='h-3 w-full' />
                </div>
              </div>
            ))}
          {!loading && !items.length && !props.error && (
            <p className='p-6 text-center text-sm text-muted-foreground'>{t('mail.empty')}</p>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
