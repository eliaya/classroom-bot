import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { api, type MailLabels, type MailThread, type MailThreadSummary } from '@/lib/api'
import { useCan } from '@/lib/permissions'
import type { MailAction, MailDisplayProps } from './mail-display'
import type { MailListProps } from './mail-list'
import { labelName } from './mail-utils'

type ThreadPage = { key: string; items: MailThreadSummary[]; next: string | null; error: string | null }

const message = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback)

/** The user's Gmail for the Dashboard: its mailboxes and labels once `enabled`,
 * and the conversations of `labelId` while one is shown (null: none), `limit` a page. */
export function useMail(enabled: boolean, labelId: string | null, limit: number) {
  const { t } = useTranslation()
  const canUse = useCan('mail:use')

  const [labels, setLabels] = useState<MailLabels | null>(null)
  // Gmail pages by token: the tokens of the pages before this one, per mailbox.
  const [trail, setTrail] = useState<{ label: string | null; tokens: string[] }>({ label: null, tokens: [] })
  // One page of one mailbox's conversations; `key` says which.
  const [page, setPage] = useState<ThreadPage>({ key: '', items: [], next: null, error: null })
  const [labelsError, setLabelsError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [thread, setThread] = useState<MailThread | null>(null)
  const [threadLoading, setThreadLoading] = useState(false)

  const loadLabels = () =>
    api
      .listMailLabels()
      .then(setLabels)
      .catch((e) => setLabelsError(message(e, t('common.loadFailed'))))

  useEffect(() => {
    if (enabled) void loadLabels()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled])

  // Another mailbox starts on its first page.
  const tokens = trail.label === labelId ? trail.tokens : []
  const token = tokens[tokens.length - 1]
  const key = JSON.stringify([labelId, token, limit])

  useEffect(() => {
    if (!labels?.granted || !labelId) return
    let stale = false
    api
      .listMailThreads({ label: labelId, page_token: token, limit })
      .then((r) => !stale && setPage({ key, items: r.items, next: r.next_page_token, error: null }))
      .catch((e) => !stale && setPage({ key, items: [], next: null, error: message(e, t('common.loadFailed')) }))
    return () => {
      stale = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [labels?.granted, key])

  const current = page.key === key
  const items = current ? page.items : []
  const next = current ? page.next : null
  const turn = (to: string[]) => {
    setTrail({ label: labelId, tokens: to })
    reset()
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

  /** Close the open conversation, as choosing another mailbox does. */
  const reset = () => {
    opening.current = null
    setSelectedId(null)
    setThread(null)
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
    reset()
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

  const mailbox = labels && [...labels.mailboxes, ...labels.labels].find((l) => l.id === labelId)

  const from = tokens.length * limit + 1
  const list: MailListProps = {
    title: mailbox ? labelName(t, mailbox) : t('mail.title'),
    // Gmail gives no total: the range alone, as "1–20".
    range: items.length ? t('dashboard.rangeOpen', { from, to: from + items.length - 1 }) : null,
    onPrev: tokens.length ? () => turn(tokens.slice(0, -1)) : undefined,
    onNext: next ? () => turn([...tokens, next]) : undefined,
    items,
    labels: labels?.labels ?? [],
    selectedId,
    onSelect: open,
    loading: !current,
    error: current ? page.error : null,
  }
  const display: MailDisplayProps = {
    thread,
    loading: threadLoading,
    labels: labels?.labels ?? [],
    canUse,
    onAction: (a) => void act(a),
    onStar: (on) => relabel(on ? ['STARRED'] : [], on ? [] : ['STARRED']),
    onLabel: (id, on) => relabel(on ? [id] : [], on ? [] : [id]),
  }

  return { labels, labelsError, selectedId, reset, list, display }
}
