import { ListFilter, Menu, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { MailLabel, MailThreadSummary } from '@/lib/api'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { MailItem } from './mail-item'

export type MailFilters = { starred: boolean; attachment: boolean }

type MailListProps = {
  title: string
  /** Unread conversations in this mailbox; null when Gmail has no count for it. */
  unreadCount: number | null
  tab: 'all' | 'unread'
  onTab: (tab: 'all' | 'unread') => void
  query: string
  onQuery: (query: string) => void
  filters: MailFilters
  onFilters: (filters: MailFilters) => void
  items: MailThreadSummary[]
  labels: MailLabel[]
  selectedId: string | null
  onSelect: (item: MailThreadSummary) => void
  loading: boolean
  error: string | null
  hasMore: boolean
  onMore: () => void
  /** Phone layout: opens the mailboxes. */
  onOpenNav?: () => void
}

/** Middle pane: title, All mail / Unread tabs, search and the conversations. */
export function MailList(props: MailListProps) {
  const { t } = useTranslation()
  const { items, loading } = props
  return (
    <div className='flex h-full min-h-0 flex-col overflow-hidden bg-background'>
      <Tabs
        value={props.tab}
        onValueChange={(v) => props.onTab(v as 'all' | 'unread')}
        className='flex min-h-0 flex-1 flex-col gap-3'
      >
        <div className='flex items-center gap-3 p-3 pb-0'>
          {props.onOpenNav && (
            <Button variant='ghost' size='icon' onClick={props.onOpenNav} aria-label={t('mail.mailboxesTitle')}>
              <Menu />
            </Button>
          )}
          <h1 className='truncate text-xl font-bold'>{props.title}</h1>
          <TabsList className='ml-auto bg-muted/60'>
            <TabsTrigger value='all' className='font-normal'>
              {t('mail.allMail')}
            </TabsTrigger>
            <TabsTrigger value='unread' className='font-normal'>
              {t('mail.unread')}
              {props.unreadCount ? <span className='tabular-nums'>({props.unreadCount})</span> : null}
            </TabsTrigger>
          </TabsList>
        </div>
        <Separator />
        <div className='flex items-center gap-2 px-3'>
          <div className='relative flex-1'>
            <Search
              className='pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground'
              aria-hidden='true'
            />
            <Input
              type='search'
              aria-label={t('mail.search')}
              placeholder={t('mail.search')}
              value={props.query}
              onChange={(e) => props.onQuery(e.target.value)}
              className='ps-9'
            />
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant='outline' size='icon' className='shrink-0' aria-label={t('mail.filter')}>
                <ListFilter />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end'>
              <DropdownMenuCheckboxItem
                checked={props.filters.starred}
                onCheckedChange={(starred) => props.onFilters({ ...props.filters, starred: starred === true })}
              >
                {t('mail.starred')}
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={props.filters.attachment}
                onCheckedChange={(attachment) => props.onFilters({ ...props.filters, attachment: attachment === true })}
              >
                {t('mail.withAttachment')}
              </DropdownMenuCheckboxItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <TabsContent value={props.tab} className='m-0 flex min-h-0 flex-1 flex-col'>
          {props.error && (
            <p role='alert' className='mx-3 mb-3 text-sm text-destructive'>
              {props.error}
            </p>
          )}
          <ScrollArea className='min-h-0 flex-1'>
            <div className='flex flex-col p-3 pt-0' aria-busy={loading}>
              {items.map((item) => (
                <MailItem
                  key={item.id}
                  item={item}
                  labels={props.labels}
                  selected={item.id === props.selectedId}
                  onSelect={() => props.onSelect(item)}
                />
              ))}
              {loading &&
                Array.from({ length: items.length ? 2 : 6 }, (_, i) => (
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
              {!loading && props.hasMore && (
                <Button variant='ghost' className='mt-2' onClick={props.onMore}>
                  {t('mail.loadMore')}
                </Button>
              )}
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </div>
  )
}
