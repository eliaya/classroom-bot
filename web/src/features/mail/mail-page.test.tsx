import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'
import '@/lib/i18n'
import '@/styles/index.css'
import { api, type MailLabels, type MailThread, type MailThreadSummary } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'
import { MailPage } from './mail-page'
import { formatMailDate, initials } from './mail-utils'

const HOUR = 3_600_000
const LABELS: MailLabels = {
  granted: true,
  mailboxes: [
    { id: 'INBOX', name: 'INBOX', type: 'system', color: null, count: 1 },
    { id: 'SENT', name: 'SENT', type: 'system', color: null, count: 0 },
    { id: 'ARCHIVE', name: 'Archive', type: 'system', color: null, count: null },
  ],
  labels: [
    { id: 'CATEGORY_SOCIAL', name: 'CATEGORY_SOCIAL', type: 'system', color: null, count: 0 },
    { id: 'Label_1', name: 'Projects', type: 'user', color: null, count: 2 },
  ],
}
const THREADS: MailThreadSummary[] = [
  {
    id: 't1', from_name: 'Sarah Johnson', from_email: 'sarah@example.com', subject: 'Q4 Review',
    snippet: 'Thanks for the feedback', date: Date.now() - 2 * HOUR, count: 4, unread: true,
    starred: false, label_ids: ['INBOX', 'UNREAD', 'Label_1'],
  },
  {
    id: 't2', from_name: 'Michael Chen', from_email: 'mc@example.com', subject: 'Timeline',
    snippet: 'A quick update', date: Date.now() - 5 * HOUR, count: 1, unread: false,
    starred: true, label_ids: ['INBOX', 'STARRED'],
  },
]
const THREAD: MailThread = {
  id: 't1', subject: 'Q4 Review', label_ids: ['INBOX', 'UNREAD', 'Label_1'],
  messages: [
    { id: 'm1', from_name: 'Me', from_email: 'me@example.com', to: 'sarah@example.com',
      reply_to: 'me@example.com', date: Date.now() - 3 * HOUR, unread: false, text: 'First draft attached.' },
    { id: 'm2', from_name: 'Sarah Johnson', from_email: 'sarah@example.com', to: 'me@example.com',
      reply_to: 'sarah@example.com', date: Date.now() - 2 * HOUR, unread: true, text: 'Thanks for the feedback.\nBest,\nSarah' },
  ],
}

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      listMailLabels: vi.fn(async () => LABELS),
      listMailThreads: vi.fn(async () => ({ items: THREADS, next_page_token: null })),
      getMailThread: vi.fn(async () => THREAD),
      modifyMailThread: vi.fn(async (id: string) => ({ id, label_ids: ['INBOX'] })),
      trashMailThread: vi.fn(async (id: string) => ({ id, trashed: true })),
    },
  }
})
vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>()
  return {
    ...actual,
    Link: ({ to, children, ...rest }: Record<string, unknown>) => (
      <a href={String(to)} {...rest}>
        {children as React.ReactNode}
      </a>
    ),
  }
})
vi.mock('@/features/classroom/layout-header', () => ({ ClassroomHeader: () => null }))

const signIn = (permissions: string[]) =>
  useAuthStore.getState().auth.setUser({
    id: 1, email: 'user@example.com', name: null, picture_url: null, role: 'user', permissions,
  })

describe('mail helpers', () => {
  it('formats initials and dates', () => {
    expect(initials('Sarah Johnson')).toBe('SJ')
    expect(initials('bob@example.com')).toBe('BO')
    const now = new Date(2026, 9, 18, 12).getTime()
    expect(formatMailDate(now - 2 * HOUR, 'en', now)).toBe('2 hours ago')
    expect(formatMailDate(new Date(2026, 9, 17, 9).getTime(), 'en', now)).toBe('yesterday')
    expect(formatMailDate(new Date(2026, 9, 11, 9).getTime(), 'en', now)).toBe('Oct 11')
  })
})

describe('MailPage', () => {
  beforeEach(async () => {
    await page.viewport(1440, 900)
    vi.mocked(api.modifyMailThread).mockClear()
    vi.mocked(api.listMailLabels).mockImplementation(async () => LABELS)
    signIn(['mail:view', 'mail:use'])
  })

  it('lists conversations, opens one, marks it read and archives it', async () => {
    const screen = await render(<MailPage />)
    await expect.element(screen.getByRole('heading', { name: 'Inbox' })).toBeVisible()
    await expect.element(screen.getByRole('button', { name: /Sarah Johnson/ })).toBeVisible()
    await expect.element(screen.getByRole('tab', { name: 'Unread(1)' })).toBeVisible()
    await expect.element(screen.getByRole('button', { name: /Projects/ })).toBeVisible()

    await screen.getByRole('button', { name: /Sarah Johnson/ }).click()
    await expect.element(screen.getByText('Thanks for the feedback.', { exact: false })).toBeVisible()
    expect(api.modifyMailThread).toHaveBeenCalledWith('t1', { remove: ['UNREAD'] })
    // Only the latest message shows until the earlier one is asked for.
    expect(document.body.textContent).not.toContain('First draft attached.')
    await screen.getByRole('button', { name: '1 earlier message' }).click()
    await expect.element(screen.getByText('First draft attached.')).toBeVisible()

    await screen.getByRole('button', { name: 'Archive' }).first().click()
    expect(api.modifyMailThread).toHaveBeenLastCalledWith('t1', { remove: ['INBOX'] })
    await expect.element(screen.getByRole('button', { name: /Sarah Johnson/ })).not.toBeInTheDocument()
    await expect.element(screen.getByText('No conversation selected')).toBeVisible()
  })

  it('reads without organising for a view-only role', async () => {
    signIn(['mail:view'])
    const screen = await render(<MailPage />)
    await screen.getByRole('button', { name: /Sarah Johnson/ }).click()
    await expect.element(screen.getByText('Thanks for the feedback.', { exact: false })).toBeVisible()
    expect(api.modifyMailThread).not.toHaveBeenCalled()
    await expect.element(screen.getByRole('button', { name: 'Archive' }).first()).toBeDisabled()
  })

  it('asks to connect Google again without Gmail access', async () => {
    vi.mocked(api.listMailLabels).mockImplementation(async () => ({ granted: false, mailboxes: [], labels: [] }))
    const screen = await render(<MailPage />)
    await expect.element(screen.getByText(/allow Gmail access/)).toBeVisible()
    await expect.element(screen.getByRole('link', { name: 'Open Settings' })).toHaveAttribute('href', '/settings')
  })
})
