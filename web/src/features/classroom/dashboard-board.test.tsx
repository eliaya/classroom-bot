import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'
import '@/lib/i18n'
import '@/styles/index.css'
import { api, type ClassworkResponse, type Course, type CoursePerson, type Post } from '@/lib/api'
import type { Board } from './board-model'
import { DashboardBoard } from './dashboard-board'

const ago = (ms: number) => new Date(Date.now() - ms).toISOString()
// Course weekdays are 1 (Mon) … 7 (Sun).
const today = new Date().getDay() || 7
const otherDay = (today % 7) + 1
const d = new Date()
const LESSON = `lesson:101:${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

const COURSES: Course[] = [
  { id: '101', name: 'Machine Learning', section: 'Mon 1-2', week: today },
  { id: '103', name: 'Statistics', section: 'Mon 3-4', week: today },
  { id: '102', name: 'Web Engineering', section: 'Tue 3-4', week: otherDay },
]
const post = (id: string, course_id: string, type: Post['type'], age: number): Post => ({
  id, course_id, type, title: `${type} ${id}`, time: ago(age),
})
const POSTS: Post[] = [
  post('a1', '101', 'announcement', 60_000),
  post('w1', '101', 'coursework', 120_000),
  post('s1', '103', 'material', 60_000),
]
const PEOPLE: CoursePerson[] = [
  { course_id: '101', user_id: 't1', role: 'teacher', full_name: 'Sato Hana' },
  { course_id: '101', user_id: 's1', role: 'student', full_name: 'Me Myself' },
  { course_id: '102', user_id: 't2', role: 'teacher', full_name: 'Abe Ken' },
]
const CLASSWORK: ClassworkResponse = {
  coursework: [
    { id: 'w1', title: 'Lesson 3 worksheet', topic_id: 't3', work_type: 'ASSIGNMENT' },
    { id: 'w0', title: 'Lesson 2 worksheet', topic_id: 't2', work_type: 'ASSIGNMENT' },
  ],
  materials: [],
  topics: [
    { id: 't3', name: 'Lesson 3' },
    { id: 't2', name: 'Lesson 2' },
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
      getClasswork: vi.fn(async () => CLASSWORK),
      getBoard: vi.fn(async () => ({ data: null })),
      saveBoard: vi.fn(async (data: unknown) => ({ data })),
    },
  }
})

const columns = () => [...document.querySelectorAll('[data-slot="kanban-column"]')] as HTMLElement[]
const lastSaved = () => vi.mocked(api.saveBoard).mock.lastCall?.[0] as Board

/** Drags `el` to `x`, `y` in small steps: dnd-kit needs the moves in between. */
async function drag(el: Element, to: { x: number; y: number }, drop = true) {
  const start = el.getBoundingClientRect()
  let [x, y] = [start.left + 40, start.top + 20]
  const at = () => ({ bubbles: true, clientX: x, clientY: y, pointerId: 1, isPrimary: true, button: 0, buttons: 1 })
  el.dispatchEvent(new PointerEvent('pointerdown', at()))
  for (let step = 20; step > 0; step--) {
    x += (to.x - x) / step
    y += (to.y - y) / step
    document.dispatchEvent(new PointerEvent('pointermove', at()))
    await new Promise((resolve) => setTimeout(resolve, 16))
  }
  if (drop) document.dispatchEvent(new PointerEvent('pointerup', at()))
}

describe('DashboardBoard', () => {
  beforeEach(async () => {
    await page.viewport(1440, 900)
    vi.mocked(api.saveBoard).mockClear()
  })

  it('shows one column per lesson of today, holding its posts, then the week', async () => {
    const screen = await render(<DashboardBoard />)
    await expect.element(screen.getByText('Machine Learning')).toBeInTheDocument()
    expect(columns()).toHaveLength(2)
    const first = columns()[0]
    expect(first.textContent).toContain('Sato Hana')
    expect([...first.querySelectorAll('[data-slot="kanban-item"]')].map((c) => c.textContent)).toEqual([
      expect.stringContaining('announcement a1'),
      expect.stringContaining('coursework w1'),
    ])
    expect(columns()[1].textContent).toContain('material s1')
    expect(document.body.textContent).not.toContain('Web Engineering')

    await screen.getByRole('tab', { name: 'Week' }).click()
    await expect.element(screen.getByText('Web Engineering')).toBeInTheDocument()
    expect(columns()).toHaveLength(3)
  })

  it('filters the lessons by teacher', async () => {
    const screen = await render(<DashboardBoard />)
    await screen.getByRole('tab', { name: 'Week' }).click()
    await screen.getByRole('button', { name: 'Filter by teacher' }).click()
    await screen.getByRole('menuitemradio', { name: 'Abe Ken' }).click()
    await expect.poll(() => document.body.textContent?.includes('Machine Learning')).toBe(false)
    expect(document.body.textContent).toContain('Web Engineering')
  })

  it('opens a card on its Classwork topic', async () => {
    const screen = await render(<DashboardBoard />)
    await screen.getByText('coursework w1').click()
    await expect.element(screen.getByText('Lesson 3 worksheet')).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('Lesson 2 worksheet')
  })

  it('reorders a card within its lesson, and keeps it there when dropped on another', async () => {
    const screen = await render(<DashboardBoard />)
    await expect.element(screen.getByText('Machine Learning')).toBeInTheDocument()
    const [a1, w1] = columns()[0].querySelectorAll('[data-slot="kanban-item"]')
    const other = columns()[1].getBoundingClientRect()
    await drag(a1, { x: other.left + 100, y: other.top + 80 }, false)
    // Until the drop the card stays in its column, tilted on the overlay.
    expect(document.querySelector('.rotate-1.shadow-xl')).not.toBeNull()
    document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }))
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(api.saveBoard).not.toHaveBeenCalled()
    expect(columns()[0].textContent).toContain('announcement a1')

    const below = w1.getBoundingClientRect()
    await drag(a1, { x: below.left + 40, y: below.bottom - 5 })
    await expect.poll(() => vi.mocked(api.saveBoard).mock.calls.length).toBe(1)
    expect(lastSaved().cards[LESSON]).toEqual(['coursework:w1', 'announcement:a1'])
  })
})
