import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'
import '@/lib/i18n'
// The page shows a table or cards depending on the breakpoint: needs the real CSS.
import '@/styles/index.css'
import { useAuthStore } from '@/stores/auth-store'
import { type Course, type CoursePerson, type Post } from '@/lib/api'
import { CoursesListPage } from './courses-list'

const DAY = 86_400_000
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString()
// Course weekdays are 1 (Mon) … 7 (Sun).
const today = new Date().getDay() || 7
const otherDay = (today % 7) + 1

const COURSES: Course[] = [
  { id: '101', name: '【AI07】Machine Learning', section: 'Mon 1-2 / Sato', week: today, state: 'ACTIVE' },
  { id: '102', name: '【AI07】Web Engineering', section: 'Tue 3-4 / Abe', week: otherDay, state: 'ACTIVE' },
  { id: '103', name: 'Homeroom', section: null, week: 8, state: 'ACTIVE' },
]
const post = (id: string, course_id: string, type: Post['type'], days: number): Post => ({
  id, course_id, type, title: `${type} ${id}`, time: ago(days), alternate_link: 'https://classroom.example/x',
})
const POSTS: Post[] = [
  post('a1', '101', 'announcement', 1),
  post('w1', '102', 'coursework', 2),
  post('w2', '102', 'coursework', 3),
  post('m1', '102', 'material', 5),
  // Long ago: counts for nothing in the last 90 days, but is the course's last update.
  post('m0', '103', 'material', 300),
]

const PEOPLE: CoursePerson[] = [
  { course_id: '101', user_id: 's1', role: 'student', full_name: 'Me Myself' },
  { course_id: '101', user_id: 't1', role: 'teacher', full_name: 'Sato Hana' },
  // More than fit: the rest are counted.
  ...Array.from({ length: 7 }, (_, i) => ({
    course_id: '102', user_id: `t${i}`, role: 'teacher', full_name: `Teacher ${i}`,
  })),
]

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      listCourses: vi.fn(async () => ({ items: COURSES, total: COURSES.length })),
      listPosts: vi.fn(async () => ({ items: POSTS, count: POSTS.length })),
      listPeople: vi.fn(async () => ({ items: PEOPLE })),
    },
  }
})
vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>()
  return {
    ...actual,
    // No router in this test: a plain anchor carrying the target.
    Link: ({ to, params, children, ...rest }: Record<string, unknown>) => (
      <a href={String(to).replace('$courseId', String((params as { courseId: string }).courseId))} {...rest}>
        {children as React.ReactNode}
      </a>
    ),
  }
})
vi.mock('./layout-header', () => ({ ClassroomHeader: () => null }))

const names = () =>
  [...document.querySelectorAll('tbody tr td a span span:first-child')].map((el) => el.textContent)

describe('CoursesListPage', () => {
  beforeEach(async () => {
    await page.viewport(1440, 900)
    useAuthStore.getState().auth.setUser({
      id: 1, email: 'user@example.com', name: null, picture_url: null, role: 'user',
      permissions: ['courses:view', 'sync:use'],
    })
  })

  it('lists courses with their activity, status and KPIs', async () => {
    const screen = await render(<CoursesListPage />)
    await expect.element(screen.getByRole('link', { name: /Web Engineering/ })).toBeInTheDocument()
    // Default order: latest update first.
    expect(names()).toEqual(['【AI07】Machine Learning', '【AI07】Web Engineering', 'Homeroom'])
    const rows = [...document.querySelectorAll('tbody tr')].map((tr) => tr.textContent ?? '')
    expect(rows[0]).toContain('Today') // held on today's weekday
    expect(rows[1]).toContain('Active') // updated in the period
    expect(rows[2]).toContain('Quiet') // nothing in the last 90 days
    // Two courses were updated in the period; one announcement, two coursework, one material.
    const kpis = [...document.querySelectorAll('.\\@5xl\\:grid-cols-4 > div')].map((el) => el.textContent ?? '')
    expect(kpis.map((text) => text.replace(/\D+/g, ' ').trim().split(' ')[0])).toEqual(['2', '1', '2', '1'])
  })

  it('puts the week first, the course id in a tooltip and the people in avatars', async () => {
    const screen = await render(<CoursesListPage />)
    await expect.element(screen.getByRole('link', { name: /Web Engineering/ })).toBeInTheDocument()
    const heads = [...document.querySelectorAll('thead th')].map((th) => th.textContent)
    expect(heads.slice(0, 3)).toEqual(['Week', 'Course name', 'People'])
    expect(heads).not.toContain('Course ID')

    // Teachers first; a hovered avatar names its person and role.
    const sato = screen.getByLabelText('Sato Hana (teacher)')
    await expect.element(sato).toBeInTheDocument()
    const avatars = [...document.querySelectorAll('tbody tr:first-child td:nth-child(3) [aria-label]')]
    expect(avatars.map((el) => el.getAttribute('aria-label'))).toEqual(['Sato Hana (teacher)', 'Me Myself (student)'])
    await userEvent.hover(sato)
    await expect.element(screen.getByText('Sato Hana')).toBeVisible()
    expect(document.querySelector('tbody tr:nth-child(2)')?.textContent).toContain('+2')
    expect(document.querySelector('tbody tr:nth-child(3) td:nth-child(3)')?.textContent).toBe('—')

    await userEvent.hover(screen.getByRole('link', { name: /Machine Learning/ }))
    await expect.element(screen.getByRole('tooltip')).toHaveTextContent('Course ID: 101')
  })

  it('filters by tab, search and activity, and sorts by a column', async () => {
    const screen = await render(<CoursesListPage />)
    await expect.element(screen.getByRole('link', { name: /Web Engineering/ })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('tab', { name: 'Active' }))
    expect(names()).toEqual(['【AI07】Web Engineering'])
    await userEvent.click(screen.getByRole('tab', { name: 'All courses' }))

    await userEvent.fill(screen.getByRole('searchbox'), 'homeroom')
    expect(names()).toEqual(['Homeroom'])
    await userEvent.fill(screen.getByRole('searchbox'), '')

    await userEvent.click(screen.getByRole('button', { name: 'Updates' }))
    expect(names()).toEqual(['Homeroom', '【AI07】Machine Learning', '【AI07】Web Engineering'])
    await userEvent.click(screen.getByRole('button', { name: 'Updates' }))
    expect(names()[0]).toBe('【AI07】Web Engineering')
  })

  it('opens the details sheet and hides a column from Manage Table', async () => {
    const screen = await render(<CoursesListPage />)
    await expect.element(screen.getByRole('link', { name: /Web Engineering/ })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Manage Table' }))
    await userEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Week' }))
    await userEvent.keyboard('{Escape}')
    expect(document.querySelector('thead')?.textContent).not.toContain('Week')

    await userEvent.click(screen.getByRole('button', { name: 'Actions for 【AI07】Web Engineering' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'View details' }))
    await expect.element(screen.getByRole('dialog')).toBeInTheDocument()
    await expect.element(screen.getByText('Course basics')).toBeInTheDocument()
    await expect.element(screen.getByText('coursework w1')).toBeInTheDocument()
  })

  it('shows one card per course on a phone', async () => {
    await page.viewport(390, 844)
    const screen = await render(<CoursesListPage />)
    await expect.element(screen.getByRole('listitem').first()).toBeInTheDocument()
    expect(document.querySelectorAll('ul > li').length).toBe(3)
  })
})
