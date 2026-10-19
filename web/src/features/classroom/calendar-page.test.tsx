import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'
import '@/lib/i18n'
import '@/styles/index.css'
import { api, type CalendarEvent, type Course, type Post } from '@/lib/api'
import { gridOffset, layoutColumns, monthGrid } from './calendar-layout'
import { CalendarPage } from './calendar-page'

const at = (hour: number, minute = 0) => {
  const d = new Date()
  d.setHours(hour, minute, 0, 0)
  return d.toISOString()
}

// Course weekdays are 1 (Mon) … 7 (Sun).
const TODAY = new Date().getDay() || 7

const COURSES: Course[] = [
  { id: '101', name: 'Machine Learning', section: '1-2 / Sato', week: TODAY },
  { id: '102', name: 'Web Engineering', section: '3-4 / Abe', week: TODAY },
  // Held on another weekday: no column in the day view, even with a post today.
  { id: '103', name: 'English Communication', week: (TODAY % 7) + 1 },
  { id: '105', name: 'Physical Education', week: (TODAY % 7) + 1 },
  // Held on today's weekday, but not on today's timetable (a past term's course):
  // a column only when there is no timetable to tell.
  { id: '104', name: 'Homeroom', week: TODAY },
]
const POSTS: Post[] = [
  { id: 'a1', course_id: '101', type: 'announcement', title: 'Room change', time: at(9) },
  { id: 'w1', course_id: '101', type: 'coursework', title: 'Report 3', time: at(9, 15) },
  { id: 'm1', course_id: '102', type: 'material', title: 'Slides week 5', time: at(13, 30) },
  // Outside the default 8:00-19:00 grid.
  { id: 'w2', course_id: '102', type: 'coursework', title: 'Late quiz', time: at(22) },
  { id: 'w3', course_id: '105', type: 'coursework', title: 'Essay draft', time: at(10) },
]
const localDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const tomorrow = new Date(Date.now() + 86_400_000)
// Google Calendar events, as saved by the sync.
const EVENTS: CalendarEvent[] = [
  // A class on the timetable calendar, matched to its course by the server.
  { id: 'e1', calendar: 'Timetable', course_id: '102', title: 'Web lesson', all_day: false, start: at(11), end: at(12, 30), link: 'https://calendar.example/e1', location: 'Room 301', description: 'Bring a <b>laptop</b><br>and a charger' },
  // Machine Learning's lesson today.
  { id: 'e5', calendar: 'Timetable', course_id: '101', title: 'ML lesson', all_day: false, start: at(9), end: at(10, 30) },
  // All-day: a date, with the end exclusive. Shown in its course's column.
  { id: 'e2', calendar: 'Machine Learning', course_id: '101', title: 'Report due', all_day: true, start: localDate(new Date()), end: localDate(tomorrow) },
  // A make-up class of a course held on another weekday: the course gets a column.
  { id: 'e3', calendar: 'Timetable', course_id: '103', title: 'Make-up class', all_day: false, start: at(15), end: at(16) },
  // Of no course.
  { id: 'e4', calendar: 'Holidays', course_id: null, title: 'Sports Day', all_day: true, start: localDate(new Date()), end: localDate(tomorrow) },
  // A deadline today of a course held on another weekday: no column, listed above the columns.
  { id: 'e6', calendar: 'Physical Education', course_id: '105', title: 'Fitness log due', all_day: true, start: localDate(new Date()), end: localDate(tomorrow) },
]

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      listCourses: vi.fn(async () => ({ items: COURSES, total: COURSES.length })),
      listPosts: vi.fn(async () => ({ items: POSTS, count: POSTS.length })),
      listCalendarEvents: vi.fn(async () => ({ granted: true, items: EVENTS })),
      getClasswork: vi.fn(async () => ({
        coursework: [],
        topics: [],
        materials: [
          {
            id: 'm1',
            attachments: [
              { id: 1, source: 'form', title: 'Week 5 quiz', source_url: 'https://forms.example/q', fetch_status: 'skipped' },
              { id: 2, source: 'link', title: 'Reading', source_url: 'https://example.com/r', fetch_status: 'skipped' },
            ],
          },
        ],
      })),
    },
  }
})
vi.mock('./layout-header', () => ({ ClassroomHeader: () => null }))

describe('layoutColumns', () => {
  it('puts overlapping posts side by side and leaves the others full width', () => {
    const layout = layoutColumns([
      { id: 'a', start: 540 },
      { id: 'b', start: 555 },
      { id: 'c', start: 810 },
    ], 45)
    expect(layout.get('a')).toEqual({ left: 0, width: 0.5 })
    expect(layout.get('b')).toEqual({ left: 0.5, width: 0.5 })
    expect(layout.get('c')).toEqual({ left: 0, width: 1 })
  })

  it('uses an item\'s own duration when it has one', () => {
    // A two-hour event still overlaps what starts an hour into it.
    const layout = layoutColumns([
      { id: 'long', start: 540, duration: 120 },
      { id: 'later', start: 600 },
    ], 45)
    expect(layout.get('long')).toEqual({ left: 0, width: 0.5 })
    expect(layout.get('later')).toEqual({ left: 0.5, width: 0.5 })
  })
})

describe('monthGrid', () => {
  it('covers whole weeks around the month', () => {
    const days = monthGrid(new Date(2026, 9, 13))
    expect(days).toHaveLength(35)
    expect(days[0]).toEqual(new Date(2026, 8, 27))
    expect(days[34]).toEqual(new Date(2026, 9, 31))
    // February 2026 starts on a Sunday and ends on a Saturday: no outside days.
    expect(monthGrid(new Date(2026, 1, 1))).toHaveLength(28)
  })
})

describe('gridOffset', () => {
  it('places a time in the grid and leaves out what the grid does not show', () => {
    expect(gridOffset(9 * 60 + 30, 8, 19, 72)).toBe(108)
    expect(gridOffset(7 * 60, 8, 19, 72)).toBeNull()
    expect(gridOffset(20 * 60, 8, 19, 72)).toBeNull()
  })
})

describe('CalendarPage', () => {
  it('shows the posts by course, by week, filtered and in the log', async () => {
    await page.viewport(1280, 900)
    render(<CalendarPage />)

    // Day view: a column per course on today's timetable, and the grid grows to
    // hold the 22:00 post.
    await expect.element(page.getByText('Room change')).toBeVisible()
    await expect.element(page.getByText('Machine Learning')).toBeVisible()
    expect(document.body.textContent).not.toContain('Homeroom')
    expect(document.body.textContent).not.toContain('Physical Education')
    expect(document.body.textContent).not.toContain('Essay draft')
    await expect.element(page.getByText('Late quiz')).toBeInTheDocument()
    await expect.element(page.getByText('4 posts in view')).toBeVisible()
    // The current-time line shows while the grid (8:00-23:00 here) holds the time.
    const minutes = new Date().getHours() * 60 + new Date().getMinutes()
    expect(!!document.querySelector('[data-slot="now-line"]')).toBe(minutes >= 480 && minutes <= 1380)

    // The course picker counts the day's courses only.
    await expect.element(page.getByRole('button', { name: '3 of 3 courses' })).toBeVisible()

    // Filter out coursework.
    await page.getByRole('button', { name: 'Filters' }).click()
    await page.getByRole('menuitemcheckbox', { name: 'Coursework' }).click()
    await expect.element(page.getByText('2 posts in view')).toBeVisible()
    expect(document.body.textContent).not.toContain('Report 3')
    await page.getByRole('button', { name: 'Select all' }).click()
    await expect.element(page.getByText('4 posts in view')).toBeVisible()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))

    await page.getByRole('button', { name: 'Week', exact: true }).click()
    await expect.element(page.getByText('Slides week 5')).toBeVisible()
    // The week view shows every course's posts.
    await expect.element(page.getByRole('button', { name: '5 of 5 courses' })).toBeVisible()
    await expect.element(page.getByText('Essay draft')).toBeVisible()
    await expect.element(page.getByRole('heading', { name: /^Week of/ })).toBeVisible()

    // A post opens its details.
    await page.getByText('Slides week 5').click()
    await expect.element(page.getByRole('dialog')).toHaveTextContent('Web Engineering')
    // Its Google Forms and other attachments are listed apart.
    await expect.element(page.getByText('Google Forms (1)')).toBeVisible()
    await expect.element(page.getByText('Attachments (1)')).toBeVisible()
    await expect
      .element(page.getByRole('link', { name: /Week 5 quiz/ }))
      .toHaveAttribute('href', 'https://forms.example/q')
    await expect.element(page.getByRole('link', { name: /Reading/ })).toBeVisible()
    await page.getByRole('button', { name: 'Close' }).click()

    await page.getByRole('tab', { name: 'Log history' }).click()
    await expect.element(page.getByText('Recent updates · 5 posts')).toBeVisible()
  })

  it('falls back to the courses\' weekdays without a timetable', async () => {
    await page.viewport(1280, 900)
    vi.mocked(api.listCalendarEvents).mockResolvedValueOnce({ granted: false, items: [] })
    render(<CalendarPage />)
    await expect.element(page.getByText('Homeroom')).toBeVisible()
    await expect.element(page.getByText('Web Engineering')).toBeVisible()
    expect(document.body.textContent).not.toContain('English Communication')
  })

  it('keeps the day\'s columns when calendar events are hidden', async () => {
    await page.viewport(1280, 900)
    render(<CalendarPage />)
    await expect.element(page.getByText('English Communication')).toBeVisible()
    await page.getByRole('button', { name: 'Filters' }).click()
    await page.getByRole('menuitemcheckbox', { name: 'Google Calendar' }).click()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(document.body.textContent).not.toContain('Make-up class')
    await expect.element(page.getByText('English Communication')).toBeVisible()
    expect(document.body.textContent).not.toContain('Homeroom')
  })

  it('shows Google Calendar events with their course, opens them, and can hide them', async () => {
    await page.viewport(1280, 900)
    render(<CalendarPage />)

    // Day view: events sit in their course's column; a course with an event
    // today gets one; an event of no course is listed above the columns.
    await expect.element(page.getByRole('button', { name: /Web lesson/ })).toBeVisible()
    await expect.element(page.getByText('Report due', { exact: true })).toBeVisible()
    await expect.element(page.getByText('English Communication')).toBeVisible()
    await expect.element(page.getByText('Google Calendar · 2 events')).toBeVisible()
    await expect.element(page.getByRole('button', { name: /Sports Day/ })).toBeVisible()
    await expect.element(page.getByRole('button', { name: /Fitness log due/ })).toBeVisible()
    expect(document.body.textContent).not.toContain('Physical Education')
    const lesson = page.getByRole('button', { name: /Web lesson/ }).element().getBoundingClientRect()
    const column = page.getByText('Web Engineering').element().getBoundingClientRect()
    expect(Math.abs(lesson.left - column.left)).toBeLessThan(40)

    // An event opens its content.
    await page.getByRole('button', { name: /Web lesson/ }).click()
    const dialog = page.getByRole('dialog')
    await expect.element(dialog).toHaveTextContent('Web Engineering')
    await expect.element(dialog).toHaveTextContent('Room 301')
    await expect.element(dialog).toHaveTextContent('Bring a laptop')
    expect(dialog.element().textContent).not.toContain('<b>')
    await expect
      .element(page.getByRole('link', { name: 'Open in Google Calendar' }))
      .toHaveAttribute('href', 'https://calendar.example/e1')
    await page.getByRole('button', { name: 'Close' }).click()

    await page.getByRole('button', { name: 'Week', exact: true }).click()
    await expect.element(page.getByRole('button', { name: /Web lesson/ })).toBeVisible()
    await expect.element(page.getByText('Report due', { exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'Filters' }).click()
    await page.getByRole('menuitemcheckbox', { name: 'Google Calendar' }).click()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(document.body.textContent).not.toContain('Web lesson')
    expect(document.body.textContent).not.toContain('Sports Day')
  })

  it('leaves out an archived course, with its posts and events', async () => {
    await page.viewport(1280, 900)
    vi.mocked(api.listCourses).mockResolvedValueOnce({
      items: COURSES.map((c) => (c.id === '102' ? { ...c, archived: true } : c)),
      total: COURSES.length,
    })
    render(<CalendarPage />)
    await expect.element(page.getByText('Room change')).toBeVisible()
    await page.getByRole('button', { name: 'Week', exact: true }).click()
    await expect.element(page.getByText('Essay draft')).toBeVisible()
    for (const text of ['Web Engineering', 'Web lesson', 'Slides week 5', 'Late quiz'])
      expect(document.body.textContent).not.toContain(text)
  })

  it('shows the month, the list and the year, and opens a day from them', async () => {
    await page.viewport(1280, 900)
    render(<CalendarPage />)
    const now = new Date()
    const fullDate = now.toLocaleDateString('en', { dateStyle: 'full' })

    await page.getByRole('button', { name: 'Month', exact: true }).click()
    await expect
      .element(page.getByRole('heading', { name: now.toLocaleDateString('en', { year: 'numeric', month: 'long' }) }))
      .toBeVisible()
    // Eleven items today: three show, the rest are behind the link to the day.
    await expect.element(page.getByRole('button', { name: /Sports Day/ })).toBeVisible()
    await expect.element(page.getByRole('button', { name: '+8 more' })).toBeVisible()

    await page.getByRole('button', { name: 'List', exact: true }).click()
    await expect.element(page.getByRole('button', { name: /Late quiz/ })).toBeVisible()
    await expect.element(page.getByRole('button', { name: /Web lesson/ })).toHaveTextContent('Room 301')
    await page.getByRole('button', { name: /Essay draft/ }).click()
    await expect.element(page.getByRole('dialog')).toHaveTextContent('Physical Education')
    await page.getByRole('button', { name: 'Close' }).click()

    await page.getByRole('button', { name: 'Year', exact: true }).click()
    await expect.element(page.getByRole('heading', { name: 'January' })).toBeVisible()
    const day = page.getByRole('button', { name: fullDate })
    expect(day.element().querySelectorAll('.rounded-full')).toHaveLength(3)
    await day.click()
    // Back in the day view, on that day.
    await expect.element(page.getByText('Room change')).toBeVisible()
    await expect.element(page.getByRole('button', { name: '3 of 3 courses' })).toBeVisible()
  })
})
