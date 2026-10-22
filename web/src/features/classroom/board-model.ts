/** The dashboard Kanban as saved for the user (GET/PUT /api/dashboard/board):
 * one column per lesson, holding the lesson's posts as cards. */
import { BookOpen, ClipboardList, Megaphone } from 'lucide-react'
import type { Course, Post } from '@/lib/api'

export const POST_ICON = { announcement: Megaphone, coursework: ClipboardList, material: BookOpen }

export function initials(name: string) {
  const words = name.replace(/【[^】]*】/g, '').trim().split(/\s+/).filter(Boolean)
  return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? name).slice(0, 2)).toUpperCase()
}

// Per-device: how many of the latest posts the dashboard lists (Settings → Language).
const LIMIT_KEY = 'dashboard-limit'
export const LIMITS = [10, 20, 50, 100] as const
export const dashboardLimit = (): number => {
  try {
    const saved = Number(localStorage.getItem(LIMIT_KEY))
    return (LIMITS as readonly number[]).includes(saved) ? saved : 20
  } catch {
    return 20
  }
}
export const setDashboardLimit = (n: number) => {
  try {
    localStorage.setItem(LIMIT_KEY, String(n))
  } catch {
    // private mode: keep the default
  }
}

/** The user's order: lesson keys (columns), and each lesson's card keys. */
export type Board = { columns: string[]; cards: Record<string, string[]> }

export type Tab = 'today' | 'week'

/** One column: a course's lesson on `day`, with what was posted for it. */
export type Lesson = { key: string; course: Course; day: number; posts: Post[] }

/** A saved board, or an empty one when there is none or it is not one. */
export function toBoard(data: unknown): Board {
  const board = data as Partial<Board> | null
  const cards = board?.cards
  return {
    columns: Array.isArray(board?.columns) ? board.columns.filter((key) => typeof key === 'string') : [],
    cards: cards && typeof cards === 'object' && !Array.isArray(cards) ? cards : {},
  }
}

export const cardKey = (post: Post) => `${post.type}:${post.id}`

/** `ms` moved by `days` calendar days (local time, so DST-safe). */
export function addDays(ms: number, days: number) {
  const d = new Date(ms)
  d.setDate(d.getDate() + days)
  return d.getTime()
}

export function startOfDay(ms: number) {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** Monday 00:00 (local) of the week `ms` is in. */
export function weekStart(ms: number) {
  const day = startOfDay(ms)
  return addDays(day, -((new Date(day).getDay() + 6) % 7))
}

function dateKey(ms: number) {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** The tab's lessons: today's courses, or every weekly course on its day of
 * this week. A lesson holds what its course posted on its own day. */
export function lessonsOf(courses: Course[], posts: Post[], tab: Tab, now: number): Lesson[] {
  const todayWeek = new Date(now).getDay() || 7
  const monday = weekStart(now)
  return courses
    .filter((c) => !!c.week && c.week <= 7 && (tab === 'week' || c.week === todayWeek))
    .map((course) => {
      const day = tab === 'today' ? startOfDay(now) : addDays(monday, course.week! - 1)
      const [from, to] = [day, addDays(day, 1)]
      return {
        key: `lesson:${course.id}:${dateKey(day)}`,
        course,
        day,
        posts: posts
          .filter((p) => p.course_id === course.id && Date.parse(p.time) >= from && Date.parse(p.time) < to)
          .sort((a, b) => Date.parse(b.time) - Date.parse(a.time)),
      }
    })
    .sort((a, b) => a.day - b.day || a.course.name.localeCompare(b.course.name))
}

/** `keys` in their saved order; those not saved yet keep theirs, after. */
export function ordered(saved: string[] = [], keys: string[]): string[] {
  const shown = new Set(keys)
  const first = saved.filter((key) => shown.has(key))
  const placed = new Set(first)
  return [...first, ...keys.filter((key) => !placed.has(key))]
}

/** A new order for the shown keys; saved keys not shown keep theirs, after. */
export function reorder(saved: string[] = [], shown: string[]): string[] {
  const set = new Set(shown)
  return [...shown, ...saved.filter((key) => !set.has(key))]
}

/** Forgets the order of lessons before `since`, so the saved board stays small. */
export function prune(board: Board, since: number): Board {
  const keep = (key: string) => key.slice(-10) >= dateKey(since)
  return {
    columns: board.columns.filter(keep),
    cards: Object.fromEntries(Object.entries(board.cards).filter(([key]) => keep(key))),
  }
}
