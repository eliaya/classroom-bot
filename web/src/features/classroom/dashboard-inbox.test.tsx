import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'
import '@/lib/i18n'
// The detail pane shows or hides by breakpoint: needs the real CSS.
import '@/styles/index.css'
import { type ClassworkResponse, type Course, type CoursePerson, type Post } from '@/lib/api'
import { dashboardLimit, setDashboardLimit, shortAge } from './board-model'
import { DashboardInbox } from './dashboard-inbox'

const MIN = 60_000
const ago = (ms: number) => new Date(Date.now() - ms).toISOString()

const COURSES: Course[] = [
  { id: '101', name: 'Machine Learning', section: null, week: 1 },
  { id: '102', name: 'Old Course', section: null, week: 2, archived: true },
]
const post = (id: string, course_id: string, type: Post['type'], age: number, creator_user_id?: string): Post => ({
  id, course_id, type, title: `${type} ${id}`, time: ago(age), alternate_link: 'https://classroom.example/x', creator_user_id,
})
const POSTS: Post[] = [
  // The API sends them oldest first.
  ...Array.from({ length: 12 }, (_, i) => post(`m${i}`, '101', 'material', (100 - i) * MIN)),
  { ...post('a1', '101', 'announcement', 2 * MIN, 't1'), title: 'Exam moved' },
  post('w1', '101', 'coursework', 1 * MIN),
  // Newest of all, but its course is archived.
  post('x1', '102', 'coursework', 0),
]
const PEOPLE: CoursePerson[] = [{ course_id: '101', user_id: 't1', role: 'teacher', full_name: 'Sato Hana' }]
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

const rows = () => [...document.querySelectorAll('section button[type="button"]')] as HTMLElement[]

describe('DashboardInbox', () => {
  beforeEach(async () => {
    await page.viewport(1440, 900)
    localStorage.clear()
  })

  it('lists the latest posts newest first, up to the saved count, and opens the newest', async () => {
    setDashboardLimit(10)
    const screen = await render(<DashboardInbox />)
    await expect.poll(() => rows().length).toBe(10)
    // The archived course's post is left out; the coursework is the newest.
    expect(rows()[0].textContent).toContain('coursework w1')
    expect(rows()[1].textContent).toContain('Exam moved')
    expect(rows()[1].textContent).toContain('Sato Hana')
    expect(document.body.textContent).not.toContain('coursework x1')
    expect(rows()[0].getAttribute('aria-current')).toBe('true')
    // Its details: description, due date and attachments.
    await expect.element(screen.getByText('Read chapter 3.')).toBeInTheDocument()
    await expect.element(screen.getByText(/Due Nov 5, 2026/)).toBeInTheDocument()
    await expect.element(screen.getByRole('link', { name: /Slides/ })).toBeInTheDocument()
  })

  it("shows an announcement's text without repeating its first line", async () => {
    const screen = await render(<DashboardInbox />)
    await expect.poll(() => rows().length).toBe(14)
    await userEvent.click(rows()[1])
    await expect.element(screen.getByText('To Friday, room 3.')).toBeInTheDocument()
    const detail = document.querySelectorAll('section')[1].textContent ?? ''
    expect(detail.split('Exam moved').length - 1).toBe(1)
  })

  it('opens a post in a sheet on a phone', async () => {
    await page.viewport(390, 844)
    const screen = await render(<DashboardInbox />)
    await expect.poll(() => rows().length).toBe(14)
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    await userEvent.click(rows()[0])
    await expect.element(screen.getByRole('dialog').getByText('Read chapter 3.')).toBeInTheDocument()
  })

  it('keeps the inbox3 tokens in light and dark', async () => {
    const screen = await render(<DashboardInbox />)
    await expect.poll(() => rows().length).toBe(14)
    // Off the rows: a hovered row shows the hover color instead. The polls wait out the color transition.
    await userEvent.hover(screen.getByRole('heading', { level: 3 }))
    const selected = () => getComputedStyle(rows()[0].firstElementChild!)
    const button = getComputedStyle(document.querySelector('header a')!)
    await expect.poll(() => selected().backgroundColor).toBe('oklab(0.97 0 0 / 0.8)')
    expect(selected().borderRadius).toBe('8px')
    expect(button.borderRadius).toBe('6px')
    expect(getComputedStyle(document.querySelector('section')!).borderRightColor).toBe('oklch(0.922 0 0)')
    document.documentElement.classList.add('dark')
    await expect.poll(() => selected().backgroundColor).toBe('oklab(0.269 0 0 / 0.8)')
    document.documentElement.classList.remove('dark')
  })

  it('shows ages as short as inbox3 does', () => {
    const now = Date.parse('2026-10-22T12:00:00Z')
    const at = (minutes: number) => new Date(now - minutes * MIN).toISOString()
    expect(shortAge(at(5), 'en', now)).toBe('5m')
    expect(shortAge(at(10 * 60), 'en', now)).toBe('10h')
    expect(shortAge(at(2 * 1440), 'en', now)).toBe('2d')
    expect(shortAge(at(8 * 1440), 'en', now)).toBe('1w')
    expect(shortAge(at(400 * 1440), 'en', now)).toBe('1y')
    expect(shortAge(at(10 * 60), 'zh-TW', now)).toBe('10 小時')
  })

  it('remembers only the offered counts', () => {
    expect(dashboardLimit()).toBe(20)
    setDashboardLimit(50)
    expect(dashboardLimit()).toBe(50)
    localStorage.setItem('dashboard-limit', '7')
    expect(dashboardLimit()).toBe(20)
  })
})
