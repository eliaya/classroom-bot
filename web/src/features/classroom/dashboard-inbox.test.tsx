import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'
import '@/lib/i18n'
// Panes show or hide by breakpoint: needs the real CSS.
import '@/styles/index.css'
import { useAuthStore } from '@/stores/auth-store'
import { useTagsStore } from '@/stores/tags-store'
import {
  api,
  type ClassworkResponse,
  type Course,
  type CoursePerson,
  type MailLabels,
  type MailThread,
  type MailThreadSummary,
  type Post,
  type TodoItem,
} from '@/lib/api'
import { dashboardLimit, setDashboardLimit, submission, timeAgo } from './board-model'
import { DashboardInbox } from './dashboard-inbox'

const MIN = 60_000
const ago = (ms: number) => new Date(Date.now() - ms).toISOString()

const COURSES: Course[] = [
  { id: '101', name: 'Machine Learning', section: null, week: 1 },
  { id: '103', name: 'Statistics', section: null, week: 3 },
  { id: '102', name: 'Old Course', section: null, week: 2, archived: true },
]
const post = (id: string, course_id: string, type: Post['type'], age: number, creator_user_id?: string): Post => ({
  id, course_id, type, title: `${type} ${id}`, time: ago(age), alternate_link: 'https://classroom.example/x', creator_user_id,
})
const POSTS: Post[] = [
  // The API sends them oldest first.
  ...Array.from({ length: 12 }, (_, i) => post(`m${i}`, '101', 'material', (100 - i) * MIN)),
  post('s1', '103', 'material', 50 * MIN),
  { ...post('a1', '101', 'announcement', 2 * MIN, 't1'), title: 'Exam moved' },
  post('w1', '101', 'coursework', 1 * MIN, 't1'),
  // Newest of all, but its course is archived.
  post('x1', '102', 'coursework', 0),
]
const PEOPLE: CoursePerson[] = [{ course_id: '101', user_id: 't1', role: 'teacher', full_name: 'Sato Hana' }]
const TODOS: TodoItem[] = [{ item_id: 'w1', course_id: '101', status: 'NEW', due_date: '2000-01-01' }]
const CLASSWORK: ClassworkResponse = {
  coursework: [
    {
      id: 'w1',
      title: 'coursework w1',
      description: 'Read chapter 3.',
      due_date: { year: 2026, month: 11, day: 5 },
      attachments: [{ id: 1, source: 'link', title: 'Slides', source_url: 'https://example.com/s', fetch_status: 'skipped' }],
    },
  ],
  materials: [],
  topics: [],
}

const HOUR = 60 * MIN
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
      listCourses: vi.fn(async () => ({ items: COURSES, total: COURSES.length })),
      listPosts: vi.fn(async (start: string, end: string) => {
        const items = POSTS.filter((p) => p.time >= start && p.time < end)
        return { items, count: items.length }
      }),
      listPeople: vi.fn(async () => ({ items: PEOPLE })),
      listTodos: vi.fn(async () => ({ items: TODOS, total: TODOS.length })),
      listTags: vi.fn(async () => ({
        items: [{ id: 7, name: 'Review', color: '#ef4444', created_at: '2026-10-23T00:00:00', count: 2 }],
        total: 1,
      })),
      // One post of Statistics and one of the archived course.
      listTagTargets: vi.fn(async (id: number) => ({ id, targets: ['post:material:s1', 'post:coursework:x1'] })),
      getAssignedTags: vi.fn(async (target: string) => ({ target, tag_ids: [] })),
      setAssignedTags: vi.fn(async (target: string, tag_ids: number[]) => ({ target, tag_ids })),
      createTag: vi.fn(async (name: string) => ({ id: 99, name, color: null, created_at: '2026-10-24T00:00:00', count: 0 })),
      getClasswork: vi.fn(async () => CLASSWORK),
      listMailLabels: vi.fn(async () => LABELS),
      listMailThreads: vi.fn(async () => ({ items: THREADS, next_page_token: null })),
      getMailThread: vi.fn(async () => THREAD),
      modifyMailThread: vi.fn(async (id: string) => ({ id, label_ids: ['INBOX'] })),
      trashMailThread: vi.fn(async (id: string) => ({ id, trashed: true })),
      getStream: vi.fn(async () => ({
        items: [{ id: 'a1', type: 'announcement', course_id: '101', text: 'Exam moved\nTo Friday, room 3.' }],
        count: 1,
      })),
    },
  }
})
vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>()
  // No router in this test: a plain anchor carrying the target.
  return { ...actual, Link: ({ to, ...rest }: Record<string, unknown>) => <a href={String(to)} {...rest} /> }
})

// The list's rows: the scroll area's buttons that carry a post title.
// The list's rows: the Mail UI's list items (bordered, padded), not the sidebar's rows.
const rows = () => [...document.querySelectorAll('[data-slot="scroll-area-viewport"] button.border.p-3')] as HTMLElement[]
const nav = (name: string) =>
  [...document.querySelectorAll('aside button')].find((b) => b.textContent?.startsWith(name)) as HTMLElement
const signIn = (permissions: string[] | null) =>
  useAuthStore.getState().auth.setUser(
    permissions && { id: 1, email: 'user@example.com', name: null, picture_url: null, role: 'user', permissions }
  )

describe('DashboardInbox', () => {
  beforeEach(async () => {
    await page.viewport(1440, 900)
    localStorage.clear()
    signIn(null)
  })

  it('lists the inbox newest first, a page of the saved count, and opens the newest with its attachments', async () => {
    setDashboardLimit(10)
    const screen = await render(<DashboardInbox />)
    await expect.poll(() => rows().length).toBe(10)
    // The archived course's post is left out; the coursework is the newest.
    expect(rows()[0].textContent).toContain('coursework w1')
    expect(rows()[1].textContent).toContain('Exam moved')
    expect(rows()[1].textContent).toContain('Sato Hana')
    expect(rows().some((r) => r.textContent?.includes('coursework x1'))).toBe(false)
    expect(rows()[0].getAttribute('aria-current')).toBe('true')
    // The conversation: its text, past its due date and not turned in, its due date, attachment and tags.
    await expect.element(screen.getByText('Read chapter 3.')).toBeInTheDocument()
    await expect.element(screen.getByText('Missing').first()).toBeInTheDocument()
    await expect.element(screen.getByText(/Due Nov 5, 2026/)).toBeInTheDocument()
    await expect.element(screen.getByRole('link', { name: /Slides/ })).toBeInTheDocument()
    await expect.element(screen.getByRole('link', { name: 'Open in Classroom' })).toBeInTheDocument()
    // The toolbar: the tag button, and the attachments icon as this post has one.
    await expect.element(screen.getByRole('button', { name: 'Tags', exact: true })).toBeInTheDocument()
    await expect.element(screen.getByRole('button', { name: 'Attachments (1)' })).toBeInTheDocument()
    // No details panel and no reply box.
    expect(document.querySelectorAll('aside')).toHaveLength(1)
    expect(document.querySelector('textarea')).toBeNull()

    // The arrows page through the rest, the saved count at a time.
    await expect.element(screen.getByText('1–10 of 15')).toBeInTheDocument()
    await expect.element(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }))
    await expect.poll(() => rows().length).toBe(5)
    await expect.element(screen.getByText('11–15 of 15')).toBeInTheDocument()
    await expect.element(screen.getByRole('button', { name: 'Next page' })).toBeDisabled()
    expect(rows()[0].getAttribute('aria-current')).toBe('true')
    await userEvent.click(screen.getByRole('button', { name: 'Previous page' }))
    await expect.poll(() => rows().length).toBe(10)
    expect(rows()[0].textContent).toContain('coursework w1')
  })

  it('switches queues and tags, opening the newest post of each', async () => {
    const screen = await render(<DashboardInbox />)
    await expect.poll(() => rows().length).toBe(15)
    await userEvent.click(nav('Announcements'))
    await expect.element(screen.getByRole('heading', { level: 2, name: 'Announcements' })).toBeInTheDocument()
    await expect.poll(() => rows().length).toBe(1)
    await expect.element(screen.getByText('To Friday, room 3.')).toBeInTheDocument()
    await userEvent.click(nav('Archived'))
    await expect.poll(() => rows().length).toBe(1)
    expect(rows()[0].textContent).toContain('coursework x1')
    // A tag lists what it is on, archived course or not.
    await userEvent.click(nav('Review'))
    await expect.poll(() => rows().length).toBe(2)
    expect(rows().map((r) => r.textContent).join()).toMatch(/coursework x1.*material s1/)
    // Its pencil opens the edit dialog with its name.
    await userEvent.click(screen.getByRole('button', { name: 'Edit tag Review' }))
    await expect.element(screen.getByRole('dialog', { name: 'Edit tag' })).toBeVisible()
    await expect.element(screen.getByLabelText('Name')).toHaveValue('Review')
  })

  it("shows an announcement's text without repeating its first line", async () => {
    const screen = await render(<DashboardInbox />)
    await expect.poll(() => rows().length).toBe(15)
    await userEvent.click(rows()[1])
    await expect.element(screen.getByText('To Friday, room 3.')).toBeInTheDocument()
    const message = screen.getByText('To Friday, room 3.').element().parentElement?.textContent ?? ''
    expect(message.split('Exam moved').length - 1).toBe(0)
  })

  it('marks posts since the first visit unread until opened', async () => {
    localStorage.setItem('dashboard-seen', JSON.stringify({ since: ago(30 * MIN), keys: [] }))
    await render(<DashboardInbox />)
    await expect.poll(() => rows().length).toBe(15)
    const bold = () => rows().filter((r) => r.querySelector('.font-semibold')).length
    // Only the coursework and the announcement are newer than the first visit.
    expect(bold()).toBe(2)
    expect(nav('Inbox').textContent).toBe('Inbox2')
    await userEvent.click(rows()[1])
    await expect.poll(bold).toBe(1)
    expect(nav('Inbox').textContent).toBe('Inbox1')
    expect(JSON.parse(localStorage.getItem('dashboard-seen')!).keys).toEqual(['announcement:a1'])
  })

  it('opens the post palette on ⌘K and goes to the post picked', async () => {
    const screen = await render(<DashboardInbox />)
    await expect.poll(() => rows().length).toBe(15)
    await userEvent.keyboard('{Meta>}k{/Meta}')
    const dialog = screen.getByRole('dialog')
    await expect.element(dialog).toBeInTheDocument()
    await userEvent.type(dialog.getByRole('combobox'), 'Exam')
    await userEvent.click(dialog.getByRole('option', { name: /Exam moved/ }))
    await expect.element(screen.getByText('To Friday, room 3.')).toBeInTheDocument()
    expect(rows()[1].getAttribute('aria-current')).toBe('true')
  })

  it('lists Mail between Materials and Archived, for a role holding mail:view', async () => {
    signIn(['courses:view'])
    await render(<DashboardInbox />)
    await expect.poll(() => rows().length).toBe(15)
    expect(nav('Mail')).toBeUndefined()
    signIn(['courses:view', 'mail:view'])
    await expect.poll(() => nav('Mail')?.textContent).toBe('Mail1')
    const sidebar = [...document.querySelectorAll('aside button')].map((el) => el.textContent)
    expect(sidebar.indexOf('Mail1')).toBe(sidebar.findIndex((text) => text?.startsWith('Materials')) + 1)
    expect(sidebar.indexOf('Mail1') + 1).toBe(sidebar.findIndex((text) => text?.startsWith('Archived')))
  })

  it('opens a post in a drawer on a phone, with its attachments', async () => {
    await page.viewport(390, 844)
    const screen = await render(<DashboardInbox />)
    await expect.poll(() => rows().length).toBe(15)
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    await userEvent.click(rows()[0])
    await expect.element(screen.getByRole('dialog').getByText('Read chapter 3.')).toBeInTheDocument()
    await expect.element(screen.getByRole('dialog').getByText('Open in Classroom')).toBeInTheDocument()
  })

  it('keeps the column widths the user set after a reload', async () => {
    const listWidth = () => Math.round(document.querySelectorAll('[data-panel]')[1].getBoundingClientRect().width)
    const first = await render(<DashboardInbox />)
    await expect.poll(() => rows().length).toBe(15)
    const before = listWidth()
    document.querySelectorAll<HTMLElement>('[data-slot="resizable-handle"]')[1].focus()
    for (let i = 0; i < 3; i++) await userEvent.keyboard('{ArrowRight}')
    await expect.poll(listWidth).toBeGreaterThan(before)
    const resized = listWidth()
    await first.unmount()

    await render(<DashboardInbox />)
    await expect.poll(() => rows().length).toBe(15)
    expect(listWidth()).toBe(resized)
  })

  it("keeps inbox7's tokens in the sidebar and the Mail UI's (the app's) in the list, light and dark", async () => {
    const screen = await render(<DashboardInbox />)
    await expect.poll(() => rows().length).toBe(15)
    // Off the rows: a hovered row shows the hover color instead. The polls wait out the color transition.
    await userEvent.hover(screen.getByRole('heading', { level: 2, name: 'Inbox' }))
    const selected = () => getComputedStyle(rows()[0]).backgroundColor
    const sidebar = getComputedStyle(document.querySelector('aside')!)
    await expect.poll(selected).toBe('oklch(0.968 0.007 247.896)')
    expect(sidebar.backgroundColor).toBe('oklch(0.985 0 0)')
    expect(sidebar.width).toBe('224px')
    expect(getComputedStyle(nav('Inbox')).borderRadius).toBe('6px')
    document.documentElement.classList.add('dark')
    await expect.poll(selected).toBe('oklch(0.279 0.041 260.031)')
    document.documentElement.classList.remove('dark')
  })

  it("tags a post from the toolbar's tag picker: its input applies a tag, completes one, or creates one", async () => {
    const screen = await render(<DashboardInbox />)
    await expect.poll(() => rows().length).toBe(15)
    const pill = screen.getByRole('button', { name: 'Tags', exact: true })
    await userEvent.click(pill)
    await expect.element(pill).toHaveAttribute('aria-expanded', 'true')
    // The input bar slides out to the pill's right, the card of tags opens under it.
    const input = screen.getByRole('combobox', { name: 'Add or find a tag…' })
    await expect.element(input).toHaveFocus()
    const card = screen.getByRole('listbox', { name: 'Tags' })
    await expect.element(card.getByRole('option', { name: 'Review' })).toHaveAttribute('aria-selected', 'false')
    await expect.poll(() => input.element().getBoundingClientRect().left > pill.element().getBoundingClientRect().right).toBe(true)
    await expect.poll(() => card.element().getBoundingClientRect().top > pill.element().getBoundingClientRect().bottom).toBe(true)

    // Typing completes the first tag it starts; Tab takes it, Enter puts it on.
    await userEvent.type(input, 're')
    await expect.poll(() => input.element().parentElement?.textContent).toBe('review')
    await userEvent.keyboard('{Tab}')
    await expect.element(input).toHaveValue('Review')
    await userEvent.keyboard('{Enter}')
    expect(api.setAssignedTags).toHaveBeenLastCalledWith('post:coursework:w1', [7])
    await expect.element(input).toHaveValue('')
    await expect.element(card.getByRole('option', { name: 'Review' })).toHaveAttribute('aria-selected', 'true')

    // A name no tag has is created and put on.
    vi.mocked(api.listTags).mockResolvedValueOnce({
      items: [
        { id: 7, name: 'Review', color: '#ef4444', created_at: '2026-10-23T00:00:00', count: 2 },
        { id: 99, name: 'Exam', color: null, created_at: '2026-10-24T00:00:00', count: 0 },
      ],
      total: 2,
    })
    await userEvent.type(input, 'Exam')
    await expect.element(card.getByRole('option', { name: 'Create new tag: Exam' })).toBeVisible()
    await userEvent.keyboard('{Enter}')
    expect(api.createTag).toHaveBeenCalledWith('Exam')
    expect(api.setAssignedTags).toHaveBeenLastCalledWith('post:coursework:w1', [7, 99])

    // Escape closes it, back on the pill, which shows the chosen tags by colour.
    await userEvent.keyboard('{Escape}')
    await expect.element(pill).toHaveAttribute('aria-expanded', 'false')
    await expect.element(pill).toHaveFocus()
    await expect.element(pill).toHaveAttribute('title', 'Review, Exam')
    useTagsStore.setState({ tags: [], loaded: false })

    // An announcement without attachments has no attachments icon.
    await userEvent.click(rows()[1])
    await expect.element(screen.getByText('To Friday, room 3.')).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('Attachments (')
  })

  it('shows ages as inbox7 does', () => {
    const now = Date.parse('2026-10-22T12:00:00Z')
    const at = (minutes: number) => new Date(now - minutes * MIN).toISOString()
    expect(timeAgo(at(5), 'en', now)).toBe('5m ago')
    expect(timeAgo(at(6 * 60), 'en', now)).toBe('6h ago')
    expect(timeAgo(at(2 * 1440), 'en', now)).toBe('2d ago')
    expect(timeAgo(at(8 * 1440), 'en', now)).toBe('1w ago')
    expect(timeAgo(at(6 * 60), 'zh-TW', now)).toBe('6 小時前')
  })

  it('groups submissions as the todo API does', () => {
    const now = Date.parse('2026-10-22T12:00:00')
    const todo = (status: string, due_date?: string): TodoItem => ({ item_id: 'w', course_id: 'c', status, due_date })
    expect(submission(todo('TURNED_IN'), now)).toBe('turned_in')
    expect(submission(todo('RETURNED'), now)).toBe('turned_in')
    expect(submission(todo('NEW', '2026-10-21'), now)).toBe('missing')
    expect(submission(todo('CREATED', '2026-10-22'), now)).toBe('assigned')
    expect(submission(todo('NEW'), now)).toBe('assigned')
    expect(submission(todo('UNKNOWN'), now)).toBeUndefined()
  })

  it('remembers only the offered counts', () => {
    expect(dashboardLimit()).toBe(20)
    setDashboardLimit(50)
    expect(dashboardLimit()).toBe(50)
    localStorage.setItem('dashboard-limit', '7')
    expect(dashboardLimit()).toBe(20)
  })
})

describe('DashboardInbox mail', () => {
  beforeEach(async () => {
    await page.viewport(1440, 900)
    localStorage.clear()
    vi.mocked(api.modifyMailThread).mockClear()
    vi.mocked(api.listMailLabels).mockImplementation(async () => LABELS)
    signIn(['courses:view', 'mail:view', 'mail:use'])
  })

  // The toolbar's Archive: the sidebar's Archive mailbox comes first.
  const toolbarArchive = () => page.getByRole('button', { name: 'Archive', exact: true }).last()

  const openMail = async () => {
    const screen = await render(<DashboardInbox />)
    await expect.poll(() => nav('Mail')?.textContent).toBe('Mail1')
    await userEvent.click(nav('Mail'))
    return screen
  }

  it('lists conversations beside the posts, opens one, marks it read and archives it', async () => {
    const screen = await openMail()
    await expect.element(screen.getByRole('heading', { level: 2, name: 'Mail' })).toBeVisible()
    await expect.element(screen.getByRole('button', { name: /Sarah Johnson/ })).toBeVisible()
    // No tabs, search or filter: the Inbox's header with its range and pager.
    await expect.element(screen.getByText('1–2', { exact: true })).toBeVisible()
    expect(document.querySelector('[role="tab"], input[type="search"]')).toBeNull()
    expect(api.listMailThreads).toHaveBeenLastCalledWith({ label: 'INBOX', page_token: undefined, limit: 20 })
    // The other mailboxes and the labels show under Mail while it is open.
    expect(nav('Sent')).toBeDefined()
    expect(nav('Projects')?.textContent).toBe('Projects2')
    expect(document.querySelectorAll('aside a[href^="https://mail.google.com"]')).toHaveLength(1)

    await screen.getByRole('button', { name: /Sarah Johnson/ }).click()
    await expect.element(screen.getByText(/Thanks for the feedback\./)).toBeVisible()
    expect(api.modifyMailThread).toHaveBeenCalledWith('t1', { remove: ['UNREAD'] })
    // Tagged from the toolbar as a post is; the header is the post panel's, the message has none of its own.
    await expect.element(screen.getByRole('button', { name: 'Tags', exact: true })).toBeVisible()
    expect(document.body.textContent).not.toContain('Select a tag')
    // The sender's own line (name, address, time) above the message is gone.
    expect(screen.getByText('sarah@example.com', { exact: true }).elements()).toHaveLength(0)
    // Only the latest message shows until the earlier one is asked for.
    expect(document.body.textContent).not.toContain('First draft attached.')
    await screen.getByRole('button', { name: '1 earlier message' }).click()
    await expect.element(screen.getByText('First draft attached.')).toBeVisible()

    await toolbarArchive().click()
    expect(api.modifyMailThread).toHaveBeenLastCalledWith('t1', { remove: ['INBOX'] })
    await expect.element(screen.getByRole('button', { name: /Sarah Johnson/ })).not.toBeInTheDocument()
    await expect.element(screen.getByText('No conversation selected')).toBeVisible()

    // Back to the posts.
    await userEvent.click(nav('Inbox'))
    await expect.poll(() => rows().length).toBe(15)
    expect(nav('Sent')).toBeUndefined()
  })

  it('shows HTML mail in a frame without scripts, and links in plain text', async () => {
    vi.mocked(api.getMailThread).mockResolvedValueOnce({
      ...THREAD,
      messages: [
        { ...THREAD.messages[0], text: 'Slides: https://example.com/deck.' },
        {
          ...THREAD.messages[1],
          html: "<p>Hi <a href='https://example.com/a'>there</a></p><img src='data:image/gif;base64,R0lGODlhAQABAAAAACw='>",
        },
      ],
    })
    const screen = await openMail()
    await screen.getByRole('button', { name: /Sarah Johnson/ }).click()
    const frame = screen.getByTitle('Sarah Johnson')
    await expect.element(frame).toBeVisible()
    const el = frame.element() as HTMLIFrameElement
    expect(el.getAttribute('sandbox')).not.toContain('allow-scripts')
    await expect.poll(() => el.contentDocument?.querySelector('a')?.getAttribute('target')).toBe('_blank')
    expect(el.contentDocument?.querySelector('img')).not.toBeNull()

    await screen.getByRole('button', { name: '1 earlier message' }).click()
    // The full stop after the address is not part of the link.
    await expect
      .element(screen.getByRole('link', { name: 'https://example.com/deck' }))
      .toHaveAttribute('href', 'https://example.com/deck')
  })

  it('reads without organising for a view-only role', async () => {
    signIn(['courses:view', 'mail:view'])
    const screen = await openMail()
    await screen.getByRole('button', { name: /Sarah Johnson/ }).click()
    await expect.element(screen.getByText(/Thanks for the feedback\./)).toBeVisible()
    expect(api.modifyMailThread).not.toHaveBeenCalled()
    await expect.element(toolbarArchive()).toBeDisabled()
  })

  it("pages through a mailbox with the Inbox's pager, Gmail's page tokens behind it", async () => {
    vi.mocked(api.listMailThreads)
      .mockResolvedValueOnce({ items: THREADS, next_page_token: 'p2' })
      .mockResolvedValueOnce({ items: [{ ...THREADS[1], id: 't3', from_name: 'Page Two' }], next_page_token: null })
    const screen = await openMail()
    await expect.element(screen.getByText('1–2', { exact: true })).toBeVisible()
    await expect.element(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }))
    await expect.element(screen.getByRole('button', { name: /Page Two/ })).toBeVisible()
    expect(api.listMailThreads).toHaveBeenLastCalledWith({ label: 'INBOX', page_token: 'p2', limit: 20 })
    await expect.element(screen.getByText('21–21', { exact: true })).toBeVisible()
    await expect.element(screen.getByRole('button', { name: 'Next page' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Previous page' }))
    await expect.element(screen.getByRole('button', { name: /Sarah Johnson/ })).toBeVisible()
  })

  it('asks to connect Google again without Gmail access', async () => {
    vi.mocked(api.listMailLabels).mockImplementation(async () => ({ granted: false, mailboxes: [], labels: [] }))
    const screen = await render(<DashboardInbox />)
    await expect.poll(() => rows().length).toBe(15)
    await userEvent.click(nav('Mail'))
    await expect.element(screen.getByText(/allow Gmail access/)).toBeVisible()
    await expect.element(screen.getByRole('link', { name: 'Open Settings' })).toHaveAttribute('href', '/settings')
  })

  it('opens a conversation in a drawer on a phone', async () => {
    await page.viewport(390, 844)
    const screen = await render(<DashboardInbox />)
    await expect.poll(() => rows().length).toBe(15)
    await userEvent.click(screen.getByRole('button', { name: /Inbox/ }).first())
    await userEvent.click(screen.getByRole('menuitem', { name: 'Mail' }))
    await screen.getByRole('button', { name: /Sarah Johnson/ }).click()
    await expect.element(screen.getByRole('dialog').getByText(/Thanks for the feedback\./)).toBeVisible()
  })
})
