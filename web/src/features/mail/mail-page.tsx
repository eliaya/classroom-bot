import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  api,
  type MailLabels,
  type MailThread,
  type MailThreadSummary,
} from '@/lib/api'
import { useCan } from '@/lib/permissions'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Main } from '@/components/layout/main'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { ClassroomHeader } from '@/features/classroom/layout-header'
import { MailDisplay, type MailAction } from './mail-display'
import { MailList, type MailFilters } from './mail-list'
import { MailNav } from './mail-nav'
import { labelName } from './mail-utils'

// The design's breakpoint: three panes from `lg` up, one pane at a time below.
const WIDE = '(min-width: 1024px)'
const subscribe = (cb: () => void) => {
  const mq = window.matchMedia(WIDE)
  mq.addEventListener('change', cb)
  return () => mq.removeEventListener('change', cb)
}
const useWide = () => useSyncExternalStore(subscribe, () => window.matchMedia(WIDE).matches)

type ThreadPage = { key: string; items: MailThreadSummary[]; next: string | null; error: string | null }

const message = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback)

/** Mail: the user's Gmail, read and organised live (nothing is kept on the server). */
export function MailPage() {
  const { t } = useTranslation()
  const canUse = useCan('mail:use')
  const wide = useWide()

  const [labels, setLabels] = useState<MailLabels | null>(null)
  const [labelId, setLabelId] = useState('INBOX')
  const [tab, setTab] = useState<'all' | 'unread'>('all')
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState<MailFilters>({ starred: false, attachment: false })
  // One mailbox / tab / search's conversations; `key` says which.
  const [page, setPage] = useState<ThreadPage>({ key: '', items: [], next: null, error: null })
  const [loadingMore, setLoadingMore] = useState(false)
  const [labelsError, setLabelsError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [thread, setThread] = useState<MailThread | null>(null)
  const [threadLoading, setThreadLoading] = useState(false)
  const [navOpen, setNavOpen] = useState(false)

  const loadLabels = () =>
    api
      .listMailLabels()
      .then(setLabels)
      .catch((e) => setLabelsError(message(e, t('common.loadFailed'))))

  useEffect(() => {
    void loadLabels()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Search as the user types, without a Gmail call per key.
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim()), 400)
    return () => clearTimeout(timer)
  }, [query])

  const q = [search, filters.starred && 'is:starred', filters.attachment && 'has:attachment'].filter(Boolean).join(' ')

  const key = JSON.stringify([labelId, tab, q])
  const unread = tab === 'unread'

  useEffect(() => {
    if (!labels?.granted) return
    let stale = false
    api
      .listMailThreads({ label: labelId, q, unread })
      .then((r) => !stale && setPage({ key, items: r.items, next: r.next_page_token, error: null }))
      .catch((e) => !stale && setPage({ key, items: [], next: null, error: message(e, t('common.loadFailed')) }))
    return () => {
      stale = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [labels?.granted, key])

  const current = page.key === key
  const items = current ? page.items : []

  const loadMore = () => {
    if (!current || !page.next) return
    setLoadingMore(true)
    api
      .listMailThreads({ label: labelId, q, unread, page_token: page.next })
      .then((r) =>
        setPage((p) => (p.key === key ? { ...p, items: [...p.items, ...r.items], next: r.next_page_token } : p))
      )
      .catch((e) => toast.error(message(e, t('common.loadFailed'))))
      .finally(() => setLoadingMore(false))
  }

  const setItems = (update: (items: MailThreadSummary[]) => MailThreadSummary[]) =>
    setPage((p) => ({ ...p, items: update(p.items) }))
  const patchItem = (id: string, patch: Partial<MailThreadSummary>) =>
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)))

  // The conversation asked for last; an older answer arriving late is dropped.
  const opening = useRef<string | null>(null)
  const open = (item: MailThreadSummary) => {
    opening.current = item.id
    setSelectedId(item.id)
    setThread(null)
    setThreadLoading(true)
    api
      .getMailThread(item.id)
      .then((th) => {
        if (opening.current !== item.id) return
        setThread(th)
        // Opening a conversation reads it, as in Gmail.
        if (item.unread && canUse) {
          patchItem(item.id, { unread: false })
          api
            .modifyMailThread(item.id, { remove: ['UNREAD'] })
            .then(() => loadLabels())
            .catch(() => patchItem(item.id, { unread: true }))
        }
      })
      .catch((e) => toast.error(message(e, t('common.loadFailed'))))
      .finally(() => opening.current === item.id && setThreadLoading(false))
  }

  const select = (id: string) => {
    setLabelId(id)
    setSelectedId(null)
    setThread(null)
    setNavOpen(false)
  }

  // Archive, spam and trash take the conversation out of the list.
  const act = async (action: MailAction) => {
    if (!thread) return
    const id = thread.id
    try {
      if (action === 'trash') await api.trashMailThread(id)
      else if (action === 'archive') await api.modifyMailThread(id, { remove: ['INBOX'] })
      else if (action === 'spam') await api.modifyMailThread(id, { add: ['SPAM'], remove: ['INBOX'] })
      else await api.modifyMailThread(id, { add: ['UNREAD'] })
    } catch (e) {
      toast.error(message(e, t('mail.actionFailed')))
      return
    }
    if (action === 'unread') {
      patchItem(id, { unread: true })
    } else {
      setItems((prev) => prev.filter((it) => it.id !== id))
      toast.success(t(`mail.done.${action}`))
    }
    setSelectedId(null)
    setThread(null)
    void loadLabels()
  }

  const relabel = (add: string[], remove: string[]) => {
    if (!thread) return
    api
      .modifyMailThread(thread.id, { add, remove })
      .then(({ id, label_ids }) => {
        setThread((th) => (th && th.id === id ? { ...th, label_ids } : th))
        patchItem(id, { label_ids, starred: label_ids.includes('STARRED') })
        void loadLabels()
      })
      .catch((e) => toast.error(message(e, t('mail.actionFailed'))))
  }

  const all = labels ? [...labels.mailboxes, ...labels.labels] : []
  const mailbox = all.find((l) => l.id === labelId)
  const nav = labels && (
    <MailNav mailboxes={labels.mailboxes} labels={labels.labels} selected={labelId} onSelect={select} />
  )
  const list = labels && (
    <MailList
      title={mailbox ? labelName(t, mailbox) : t('mail.title')}
      unreadCount={labelId === 'DRAFT' ? null : (mailbox?.count ?? null)}
      tab={tab}
      onTab={setTab}
      query={query}
      onQuery={setQuery}
      filters={filters}
      onFilters={setFilters}
      items={items}
      labels={labels.labels}
      selectedId={selectedId}
      onSelect={open}
      loading={!current || loadingMore}
      error={current ? page.error : null}
      hasMore={current && !!page.next}
      onMore={loadMore}
      onOpenNav={wide ? undefined : () => setNavOpen(true)}
    />
  )
  const display = labels && (
    <MailDisplay
      thread={thread}
      loading={threadLoading}
      labels={labels.labels}
      canUse={canUse}
      onAction={(a) => void act(a)}
      onStar={(on) => relabel(on ? ['STARRED'] : [], on ? [] : ['STARRED'])}
      onLabel={(id, on) => relabel(on ? [id] : [], on ? [] : [id])}
      onBack={wide ? undefined : () => (setSelectedId(null), setThread(null))}
    />
  )

  return (
    <>
      <ClassroomHeader fixed title={t('mail.title')} description={t('mail.desc')} />
      <Main fixed>
        {labels && !labels.granted ? (
          <Alert>
            <AlertDescription className='flex flex-wrap items-center gap-3'>
              {t('mail.notGranted')}
              <Button asChild size='sm' variant='outline'>
                <Link to='/settings'>{t('mail.goToSettings')}</Link>
              </Button>
            </AlertDescription>
          </Alert>
        ) : !labels ? (
          labelsError ? (
            <p role='alert' className='text-sm text-destructive'>
              {labelsError}
            </p>
          ) : null
        ) : wide ? (
          <ResizablePanelGroup className='h-full min-h-[36rem] items-stretch overflow-hidden rounded-lg border border-border bg-background'>
            <ResizablePanel defaultSize='18%' minSize='14%' maxSize='26%'>
              {nav}
            </ResizablePanel>
            <ResizableHandle />
            <ResizablePanel defaultSize='34%' minSize='26%'>
              {list}
            </ResizablePanel>
            <ResizableHandle />
            <ResizablePanel defaultSize='48%' minSize='30%'>
              {display}
            </ResizablePanel>
          </ResizablePanelGroup>
        ) : (
          <div className='flex h-full min-h-[32rem] flex-col overflow-hidden rounded-lg border border-border'>
            {selectedId ? display : list}
            <Sheet open={navOpen} onOpenChange={setNavOpen}>
              <SheetContent side='left' className='w-72 p-0'>
                <SheetTitle className='sr-only'>{t('mail.mailboxesTitle')}</SheetTitle>
                <SheetDescription className='sr-only'>{t('mail.desc')}</SheetDescription>
                {nav}
              </SheetContent>
            </Sheet>
          </div>
        )}
      </Main>
    </>
  )
}
