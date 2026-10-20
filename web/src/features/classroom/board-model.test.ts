import { describe, expect, it } from 'vitest'
import type { Course, Post } from '@/lib/api'
import { addDays, lessonsOf, ordered, prune, reorder, toBoard, weekStart } from './board-model'

describe('board model', () => {
  it('shows saved keys in their order and new ones after', () => {
    expect(ordered(['b', 'gone', 'a'], ['a', 'new', 'b'])).toEqual(['b', 'a', 'new'])
    expect(ordered(undefined, ['a', 'b'])).toEqual(['a', 'b'])
  })

  it('keeps hidden keys after the shown ones when reordering', () => {
    expect(reorder(['a', 'hidden', 'b'], ['b', 'a'])).toEqual(['b', 'a', 'hidden'])
  })

  it('reads only a board it saved and forgets lessons before a day', () => {
    expect(toBoard(null)).toEqual({ columns: [], cards: {} })
    // The former status-column board.
    expect(toBoard({ columns: [{ id: 'todo', items: [] }] })).toEqual({ columns: [], cards: {} })
    const board = {
      columns: ['lesson:a:2026-10-09', 'lesson:b:2026-10-12'],
      cards: { 'lesson:a:2026-10-09': ['x'], 'lesson:b:2026-10-12': ['y'] },
    }
    expect(prune(board, new Date(2026, 9, 12).getTime())).toEqual({
      columns: ['lesson:b:2026-10-12'],
      cards: { 'lesson:b:2026-10-12': ['y'] },
    })
  })
})

describe('lessonsOf', () => {
  // Wednesday 2026-10-14, 15:00 local.
  const now = new Date(2026, 9, 14, 15).getTime()
  const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).toISOString()
  const courses: Course[] = [
    { id: 'mon', name: 'Monday course', week: 1 },
    { id: 'wed', name: 'Wednesday course', week: 3 },
    { id: 'fri', name: 'Friday course', week: 5 },
    { id: 'other', name: 'No weekday', week: 8 },
  ]
  const post = (id: string, course_id: string, time: string): Post => ({
    id, course_id, type: 'coursework', title: id, time,
  })
  const posts = [
    post('w-in', 'wed', at(2026, 10, 8)), // after last week's lesson, before this one's day
    post('w-new', 'wed', at(2026, 10, 14, 9)),
    post('w-old', 'wed', at(2026, 10, 7)), // last week's lesson day
    post('m-in', 'mon', at(2026, 10, 12, 8)),
    post('m-prev', 'mon', at(2026, 10, 6)), // Tuesday after the previous Monday
    post('m-late', 'mon', at(2026, 10, 13)), // after this Monday's lesson
    post('f-in', 'fri', at(2026, 10, 13)), // before Friday
  ]

  it('finds the week start and steps over days', () => {
    expect(new Date(weekStart(now))).toEqual(new Date(2026, 9, 12))
    expect(new Date(addDays(weekStart(now), -6))).toEqual(new Date(2026, 9, 6))
  })

  it('holds today’s lessons with what was posted that day', () => {
    const lessons = lessonsOf(courses, posts, 'today', now)
    expect(lessons.map((l) => l.key)).toEqual(['lesson:wed:2026-10-14'])
    expect(lessons[0].posts.map((p) => p.id)).toEqual(['w-new'])
  })

  it('holds every weekly course on its day of this week', () => {
    const lessons = lessonsOf(courses, posts, 'week', now)
    expect(lessons.map((l) => [l.key, l.posts.map((p) => p.id)])).toEqual([
      ['lesson:mon:2026-10-12', ['m-in']],
      ['lesson:wed:2026-10-14', ['w-new']],
      ['lesson:fri:2026-10-16', []],
    ])
  })
})
