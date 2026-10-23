import type { TFunction } from 'i18next'
import { type LucideIcon, Archive, ArchiveX, File, Inbox, OctagonAlert, Send, Trash2 } from 'lucide-react'
import type { MailLabel } from '@/lib/api'

export const MAILBOX_ICONS: Record<string, LucideIcon> = {
  INBOX: Inbox,
  DRAFT: File,
  SENT: Send,
  SPAM: OctagonAlert,
  TRASH: Trash2,
  ARCHIVE: Archive,
  DELETED: ArchiveX,
}

export function labelName(t: TFunction, label: Pick<MailLabel, 'id' | 'name' | 'type'>): string {
  if (label.type === 'user') return label.name
  return t(`mail.mailboxes.${label.id}`, { defaultValue: '' }) ||
    t(`mail.categories.${label.id}`, { defaultValue: label.name })
}

export function initials(name: string): string {
  const words = name.replace(/[<>"@].*$/, '').trim().split(/\s+/).filter(Boolean)
  const letters = words.length > 1 ? words[0][0] + words[words.length - 1][0] : (words[0] ?? '?').slice(0, 2)
  return letters.toUpperCase()
}

/** "2 hours ago", "yesterday", "Oct 15" — in the page's language. */
export function formatMailDate(ms: number, lang: string, now = Date.now()): string {
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' })
  const minutes = Math.round((now - ms) / 60_000)
  if (minutes < 60) return rtf.format(-Math.max(minutes, 0), 'minute')
  if (minutes < 24 * 60) return rtf.format(-Math.round(minutes / 60), 'hour')
  const day = (d: number) => new Date(d).setHours(0, 0, 0, 0)
  if (Math.round((day(now) - day(ms)) / 86_400_000) === 1) return rtf.format(-1, 'day')
  const sameYear = new Date(ms).getFullYear() === new Date(now).getFullYear()
  return new Date(ms).toLocaleDateString(lang, { month: 'short', day: 'numeric', year: sameYear ? undefined : 'numeric' })
}

// shortcut: opens the browser's first signed-in Google account (u/0); pass
// authuser=<email> once the connected account's address reaches the page.
export const GMAIL_COMPOSE_URL = 'https://mail.google.com/mail/u/0/?view=cm&fs=1'
export const gmailThreadUrl = (threadId: string) => `https://mail.google.com/mail/u/0/#all/${threadId}`
