import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'
import '@/lib/i18n'
// Panes show or hide by breakpoint: needs the real CSS.
import '@/styles/index.css'
import { type ClassworkResponse, type Course, type CoursePerson, type Post, type TodoItem } from '@/lib/api'
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
      getClasswork: vi.fn(async () => CLASSWORK),
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
const rows = () =>
  [...document.querySelectorAll('[data-slot="scroll-area-viewport"] button.border-b')] as HTMLElement[]
const nav = (name: string) =>
  [...document.querySelectorAll('aside button')].find((b) => b.textContent?.startsWith(name)) as HTMLElement

describe('DashboardInbox', () => {
  beforeEach(async () => {
    await page.viewport(1440, 900)
    localStorage.clear()
  })

  it('lists the inbox newest first, up to the saved count, and opens the newest with its details', async () => {
    setDashboardLimit(10)
    const screen = await render(<DashboardInbox />)
    await expect.poll(() => rows().length).toBe(10)
    // The archived course's post is left out; the coursework is the newest.
    expect(rows()[0].textContent).toContain('coursework w1')
    expect(rows()[1].textContent).toContain('Exam moved')
    expect(rows()[1].textContent).toContain('Sato Hana')
    expect(rows().some((r) => r.textContent?.includes('coursework x1'))).toBe(false)
    expect(rows()[0].getAttribute('aria-current')).toBe('true')
    // The conversation: its text, past its due date and not turned in; the details: due date and attachment.
    await expect.element(screen.getByText('Read chapter 3.')).toBeInTheDocument()
    await expect.element(screen.getByText('Missing').first()).toBeInTheDocument()
    await expect.element(screen.getByText(/Due Nov 5, 2026/)).toBeInTheDocument()
    await expect.element(screen.getByRole('link', { name: /Slides/ })).toBeInTheDocument()
    // Classroom takes no replies: the box is there, disabled.
    await expect.element(screen.getByRole('textbox', { name: 'Write a reply…' })).toBeDisabled()
  })

  it('switches queues and courses, opening the newest post of each', async () => {
    const screen = await render(<DashboardInbox />)
    await expect.poll(() => rows().length).toBe(15)
    await userEvent.click(nav('Announcements'))
    await expect.element(screen.getByRole('heading', { level: 2, name: 'Announcements' })).toBeInTheDocument()
    await expect.poll(() => rows().length).toBe(1)
    await expect.element(screen.getByText('To Friday, room 3.')).toBeInTheDocument()
    await userEvent.click(nav('Archived'))
    await expect.poll(() => rows().length).toBe(1)
    expect(rows()[0].textContent).toContain('coursework x1')
    await userEvent.click(nav('Statistics'))
    await expect.poll(() => rows()[0]?.textContent).toContain('material s1')
    expect(rows()).toHaveLength(1)
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

  it('hides and shows the details panel', async () => {
    const screen = await render(<DashboardInbox />)
    await expect.poll(() => rows().length).toBe(15)
    const toggle = screen.getByRole('button', { name: 'Show or hide details' })
    await expect.element(screen.getByText('Open in Classroom')).toBeInTheDocument()
    await userEvent.click(toggle)
    await expect.element(screen.getByText('Open in Classroom')).not.toBeInTheDocument()
    await userEvent.click(toggle)
    await expect.element(screen.getByText('Open in Classroom')).toBeInTheDocument()
  })

  it('opens a post in a drawer on a phone, and its details in another', async () => {
    await page.viewport(390, 844)
    const screen = await render(<DashboardInbox />)
    await expect.poll(() => rows().length).toBe(15)
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    await userEvent.click(rows()[0])
    await expect.element(screen.getByRole('dialog').getByText('Read chapter 3.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('dialog').getByRole('button', { name: 'Details' }))
    await expect.element(screen.getByRole('dialog', { name: 'Details' }).getByText('Open in Classroom')).toBeInTheDocument()
  })

  it('keeps the inbox7 tokens in light and dark', async () => {
    const screen = await render(<DashboardInbox />)
    await expect.poll(() => rows().length).toBe(15)
    // Off the rows: a hovered row shows the hover color instead. The polls wait out the color transition.
    await userEvent.hover(screen.getByRole('heading', { level: 2, name: 'Inbox' }))
    const selected = () => getComputedStyle(rows()[0]).backgroundColor
    const sidebar = getComputedStyle(document.querySelector('aside')!)
    await expect.poll(selected).toBe('oklch(0.97 0 0)')
    expect(sidebar.backgroundColor).toBe('oklch(0.985 0 0)')
    expect(sidebar.width).toBe('224px')
    expect(getComputedStyle(nav('Inbox')).borderRadius).toBe('6px')
    document.documentElement.classList.add('dark')
    await expect.poll(selected).toBe('oklch(0.269 0 0)')
    document.documentElement.classList.remove('dark')
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
