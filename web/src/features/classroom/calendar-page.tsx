// Layout, class names and behaviour follow Shadcn Studio "Event Calendar 04"
// (https://shadcnstudio.com/blocks/dashboard-and-application/event-calendar):
// its staff columns are courses here, its bookings are Stream and Classwork
// posts, and its booking statuses are the post types. Posts come from the
// read-only Classroom cache, so the block's create/edit/drag/resize are left out.
// The user's Google Calendar events (saved by the sync) are shown with the
// course they belong to.
import { Fragment, useEffect, useState } from 'react'
import {
  addDays,
  addMonths,
  addYears,
  isSameDay,
  isSameMonth,
  startOfDay,
  startOfWeek,
  startOfYear,
} from 'date-fns'
import { useTranslation } from 'react-i18next'
import {
  BookOpen,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Clock,
  ExternalLink,
  Filter,
  GraduationCap,
  MapPin,
  Megaphone,
} from 'lucide-react'
import { api, type Attachment, type CalendarEvent, type Course, type Post } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Main } from '@/components/layout/main'
import { gridOffset, layoutColumns, monthGrid } from './calendar-layout'
import { AttachmentView } from './components/attachment-view'
import { ClassroomHeader } from './layout-header'

const HOUR_HEIGHT = 72
// The grid shows at least these hours and grows to hold earlier or later posts.
const FIRST_HOUR = 8
const LAST_HOUR = 19
// Posts have no duration; 45 minutes is the shortest block that shows its time line.
const NOMINAL_MINUTES = 45
const VIEWS = ['day', 'week', 'month', 'list', 'year'] as const
type View = (typeof VIEWS)[number]
// The list view covers this many days from the chosen one.
const LIST_DAYS = 30
// A month cell shows this many posts and events, then a link to the day.
const MONTH_CELL_ITEMS = 3

type PostType = Post['type']
type TimedPost = Post & { at: Date }
/** A Google Calendar event with its local start (inclusive) and end (exclusive). */
type TimedEvent = CalendarEvent & { from: Date; to: Date }
// What the Filters menu toggles: the post types, and Google Calendar events.
type Kind = PostType | 'event'

// Stream first, then the two kinds of Classwork.
const TYPES: PostType[] = ['announcement', 'coursework', 'material']
const KINDS: Kind[] = [...TYPES, 'event']

const EVENT_TONE = {
  block:
    'bg-card bg-linear-to-r from-violet-200/50 to-violet-200/50 text-violet-950/80 dark:from-violet-400/25 dark:to-violet-400/25 dark:text-violet-200',
  dot: 'bg-violet-600 dark:bg-violet-400',
  icon: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',
  Icon: CalendarDays,
}

const TONES: Record<
  PostType,
  { block: string; badge: string; dot: string; icon: string; Icon: typeof Megaphone }
> = {
  announcement: {
    block:
      'bg-card bg-linear-to-r from-sky-200/50 to-sky-200/50 text-sky-950/80 dark:from-sky-400/25 dark:to-sky-400/25 dark:text-sky-200',
    badge: 'bg-sky-300/50 text-sky-900 dark:bg-sky-400/25 dark:text-sky-200',
    dot: 'bg-sky-600 dark:bg-sky-400',
    icon: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
    Icon: Megaphone,
  },
  coursework: {
    block:
      'bg-card bg-linear-to-r from-amber-200/50 to-amber-200/50 text-amber-950/80 dark:from-amber-400/25 dark:to-amber-400/25 dark:text-amber-200',
    badge: 'bg-amber-300/50 text-amber-900 dark:bg-amber-400/25 dark:text-amber-200',
    dot: 'bg-amber-600 dark:bg-amber-400',
    icon: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
    Icon: ClipboardList,
  },
  material: {
    block:
      'bg-card bg-linear-to-r from-emerald-200/50 to-emerald-200/50 text-emerald-950/80 dark:from-emerald-400/25 dark:to-emerald-400/25 dark:text-emerald-200',
    badge: 'bg-emerald-300/50 text-emerald-900 dark:bg-emerald-400/25 dark:text-emerald-200',
    dot: 'bg-green-600 dark:bg-green-400',
    icon: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
    Icon: BookOpen,
  },
}

const minutesOf = (d: Date) => d.getHours() * 60 + d.getMinutes()
const postKey = (p: Post) => `${p.type}:${p.id}`
/** Google Calendar descriptions may hold HTML: their text, keeping line breaks. */
const plainText = (html: string) =>
  new DOMParser()
    .parseFromString(html.replace(/<br\s*\/?>|<\/(p|div|li)>/gi, '$&\n'), 'text/html')
    .body.textContent?.trim() ?? ''
const toggled = <T,>(set: Set<T>, value: T) => {
  const next = new Set(set)
  if (!next.delete(value)) next.add(value)
  return next
}

export function CalendarPage() {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const [date, setDate] = useState(() => new Date())
  const [view, setView] = useState<View>('day')
  const [posts, setPosts] = useState<Post[]>([])
  const [courses, setCourses] = useState<Course[]>([])
  const [error, setError] = useState<string | null>(null)
  const [hiddenCourses, setHiddenCourses] = useState<Set<string>>(() => new Set())
  const [types, setTypes] = useState<Set<Kind>>(() => new Set(KINDS))
  const [events, setEvents] = useState<CalendarEvent[]>([])
  // null until known; false when the user has not allowed calendar access yet.
  const [calendarGranted, setCalendarGranted] = useState<boolean | null>(null)
  const [opened, setOpened] = useState<TimedPost | TimedEvent | null>(null)
  // Ticks every minute, for the day view's current-time line.
  const [today, setToday] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setToday(new Date()), 60_000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    api
      .listCourses()
      .then((res) => setCourses(res.items))
      .catch(() => undefined) // columns fall back to the course id
  }, [])

  const weekStart = startOfWeek(date)
  const monthDays = monthGrid(date)
  // What the view shows, end exclusive: the day and week views load the week.
  const from =
    view === 'year'
      ? startOfYear(date)
      : view === 'month'
        ? monthDays[0]
        : view === 'list'
          ? startOfDay(date)
          : weekStart
  const to =
    view === 'year'
      ? addYears(from, 1)
      : addDays(from, view === 'month' ? monthDays.length : view === 'list' ? LIST_DAYS : 7)
  const fromTime = from.getTime()
  const toTime = to.getTime()
  useEffect(() => {
    let stale = false
    const start = new Date(fromTime).toISOString()
    const end = new Date(toTime).toISOString()
    api
      .listPosts(start, end)
      .then((res) => {
        if (stale) return
        setPosts(res.items)
        setError(null)
      })
      .catch((e) => !stale && setError(e instanceof Error ? e.message : String(e)))
    // Google Calendar is an extra: without it the page still shows Classroom.
    api
      .listCalendarEvents(start, end)
      .then((res) => {
        if (stale) return
        setEvents(res.items)
        setCalendarGranted(res.granted)
      })
      .catch(() => !stale && setEvents([]))
    return () => {
      stale = true
    }
  }, [fromTime, toTime])

  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  // Courses that posted but are missing from the course list still get a column.
  const allCourses: Course[] = [
    ...courses,
    ...[...new Set(posts.map((p) => p.course_id))]
      .filter((id) => !courses.some((c) => c.id === id))
      .map((id) => ({ id, name: id })),
  ]
  const courseOf = (id: string) => allCourses.find((c) => c.id === id)

  // Only this range's: the previous range's posts stay in state until the next load.
  const inRange: TimedPost[] = posts
    .map((p) => ({ ...p, at: new Date(p.time) }))
    .filter(
      (p) =>
        types.has(p.type) &&
        !hiddenCourses.has(p.course_id) &&
        p.at >= from &&
        p.at < to
    )
  // An all-day date is a calendar day wherever the viewer is, not UTC midnight.
  // Shown or not, they tell which courses are held on a day.
  const allRangeEvents: TimedEvent[] = events
    .map((e) => {
      const at = (value: string) => new Date(e.all_day ? `${value}T00:00:00` : value)
      const from = at(e.start)
      return { ...e, from, to: e.end ? at(e.end) : from }
    })
    .filter((e) => e.from < to && e.to >= from)
  const rangeEvents = types.has('event') ? allRangeEvents : []
  /** Events on `day`; a zero-length one belongs to the day it starts on. */
  const eventsOn = (day: Date, ofHiddenCourses = false, list = rangeEvents) => {
    const from = startOfDay(day)
    return list.filter(
      (e) =>
        (ofHiddenCourses || !hiddenCourses.has(e.course_id ?? '')) &&
        e.from < addDays(from, 1) &&
        (e.to > from || e.from >= from)
    )
  }
  const dayEvents = eventsOn(date)

  // Day columns: the courses with an event today (a class, a make-up class, a
  // deadline), in class order (the section starts with the weekday and period).
  // The course's weekday counts only without a timetable: a past term's course
  // keeps its weekday and stays active in Classroom after its last class.
  // ponytail: "timetable" = any timed course event in the loaded week; a week
  // with none (a holiday week) falls back to the weekdays.
  // Course weekdays are 1 (Mon) … 7 (Sun).
  // Posts of that day from any other course show in the week view and the log only.
  const weekday = date.getDay() || 7
  const timetable = allRangeEvents.some((e) => e.course_id && !e.all_day)
  const heldToday = courses
    .filter(
      (c) =>
        (!timetable && c.week === weekday) ||
        eventsOn(date, true, allRangeEvents).some((e) => e.course_id === c.id)
    )
    .sort((a, b) => (a.section ?? '').localeCompare(b.section ?? ''))
  const dayCourses = heldToday.filter((c) => !hiddenCourses.has(c.id))
  // The course picker offers what the view can show: the day's courses, or all of them.
  const pickerCourses = view === 'day' ? heldToday : allCourses
  const inDay = inRange.filter(
    (p) => isSameDay(p.at, date) && dayCourses.some((c) => c.id === p.course_id)
  )
  const inView = view === 'day' ? inDay : inRange
  // Events of no course (a holiday, a school trip): listed above the day's columns.
  const looseEvents = dayEvents.filter((e) => !heldToday.some((c) => c.id === e.course_id))
  const timedOf = (list: TimedEvent[]) => list.filter((e) => !e.all_day)
  const eventTime = (e: TimedEvent) =>
    e.all_day ? t('dashboard.allDay') : `${timeOf(e.from)} – ${timeOf(e.to)}`
  /** Minutes into the shown day; an event from the day before starts at 0. */
  const span = (e: TimedEvent) => {
    const start = isSameDay(e.from, date) ? minutesOf(e.from) : 0
    const end = isSameDay(e.to, date) ? minutesOf(e.to) : 24 * 60
    return { start, duration: Math.max(NOMINAL_MINUTES, end - start) }
  }

  // Timed events that start and end on one day stretch the grid like posts do.
  const sameDay = timedOf(rangeEvents).filter((e) => isSameDay(e.from, e.to))
  const firstHour = Math.min(
    FIRST_HOUR,
    ...inRange.map((p) => p.at.getHours()),
    ...sameDay.map((e) => e.from.getHours())
  )
  const lastHour = Math.max(
    LAST_HOUR,
    ...inRange.map((p) => Math.min(24, Math.ceil((minutesOf(p.at) + NOMINAL_MINUTES) / 60))),
    ...sameDay.map((e) => Math.min(24, Math.ceil(minutesOf(e.to) / 60)))
  )
  const hours = Array.from({ length: lastHour - firstHour }, (_, i) => firstHour + i)
  const gridHeight = hours.length * HOUR_HEIGHT
  const blockHeight = (NOMINAL_MINUTES / 60) * HOUR_HEIGHT - 2

  const timeOf = (d: Date) => d.toLocaleTimeString(lang, { hour: 'numeric', minute: '2-digit' })
  const hourLabel = (h: number) =>
    new Date(2000, 0, 1, h).toLocaleTimeString(lang, { hour: 'numeric' })
  const heading =
    view === 'week'
      ? t('calendar.weekOf', {
          date: weekStart.toLocaleDateString(lang, { year: 'numeric', month: 'short', day: 'numeric' }),
        })
      : view === 'month'
        ? date.toLocaleDateString(lang, { year: 'numeric', month: 'long' })
        : view === 'year'
          ? date.toLocaleDateString(lang, { year: 'numeric' })
          : view === 'list'
            ? `${from.toLocaleDateString(lang, { month: 'short' })} – ${addDays(to, -1).toLocaleDateString(lang, { year: 'numeric', month: 'short' })}`
            : date.toLocaleDateString(lang, {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })
  const move = (dir: 1 | -1) =>
    setDate((d) =>
      view === 'month'
        ? addMonths(d, dir)
        : view === 'year'
          ? addYears(d, dir)
          : addDays(d, dir * (view === 'week' ? 7 : view === 'list' ? LIST_DAYS : 1))
    )
  const openDay = (day: Date) => {
    setDate(day)
    setView('day')
  }
  const fullDate = (day: Date) => day.toLocaleDateString(lang, { dateStyle: 'full' })
  // Sunday first, like the grids.
  const weekdayNames = (weekday: 'short' | 'narrow') =>
    monthDays.slice(0, 7).map((day) => day.toLocaleDateString(lang, { weekday }))
  /** The posts and events of `day` in time order, all-day events first. */
  // ponytail: scans every loaded post per day; bucket by day if a year of posts gets slow.
  const entriesOn = (day: Date) =>
    [
      ...eventsOn(day).map((e) => ({
        key: e.id,
        sort: e.all_day ? 0 : e.from.getTime(),
        title: e.title || t('dashboard.untitledEvent'),
        time: eventTime(e),
        where: [courseOf(e.course_id ?? '')?.name ?? e.calendar, e.location]
          .filter(Boolean)
          .join(' · '),
        tone: EVENT_TONE,
        open: () => setOpened(e),
      })),
      ...inRange
        .filter((p) => isSameDay(p.at, day))
        .map((p) => ({
          key: postKey(p),
          sort: p.at.getTime(),
          title: p.title,
          time: timeOf(p.at),
          where: `${courseOf(p.course_id)?.name ?? ''} · ${t(`courses.${p.type}`)}`,
          tone: TONES[p.type],
          open: () => setOpened(p),
        })),
    ].sort((a, b) => a.sort - b.sort)
  const listDays =
    view === 'list'
      ? Array.from({ length: LIST_DAYS }, (_, i) => addDays(from, i))
          .map((day) => ({ day, entries: entriesOn(day) }))
          .filter(({ entries }) => entries.length > 0)
      : []
  const nowTop = isSameDay(date, today)
    ? gridOffset(minutesOf(today), firstHour, lastHour, HOUR_HEIGHT)
    : null

  /** A Google Calendar event: opens its details. */
  const eventBlock = (
    e: TimedEvent,
    className: string,
    children?: React.ReactNode,
    style?: React.CSSProperties
  ) => (
    <button
      key={e.id}
      type='button'
      onClick={() => setOpened(e)}
      title={`${e.title || t('dashboard.untitledEvent')} · ${e.calendar} · ${eventTime(e)}`}
      style={style}
      className={cn('text-left transition-opacity hover:opacity-90', EVENT_TONE.block, className)}
    >
      {children ?? (e.title || t('dashboard.untitledEvent'))}
    </button>
  )

  const openedPost = opened && 'at' in opened ? opened : null
  const openedEvent = opened && !('at' in opened) ? opened : null
  const openedTone = openedPost ? TONES[openedPost.type] : EVENT_TONE
  const openedCourse = courseOf(opened?.course_id ?? '')
  const openedLink = openedPost ? openedPost.alternate_link : openedEvent?.link
  // Posts carry no attachments: a Classwork post's come from its course's classwork.
  const [loaded, setLoaded] = useState<{ key: string; list: Attachment[] } | null>(null)
  const classworkKey =
    openedPost && openedPost.type !== 'announcement'
      ? `${openedPost.course_id}/${openedPost.id}`
      : null
  useEffect(() => {
    if (!classworkKey) return
    const [courseId, id] = classworkKey.split('/')
    let stale = false
    api
      .getClasswork(courseId)
      .then((res) => {
        const item = [...res.coursework, ...res.materials].find((i) => i.id === id)
        if (!stale) setLoaded({ key: classworkKey, list: item?.attachments ?? [] })
      })
      .catch(() => undefined) // the drawer still shows the post without them
    return () => {
      stale = true
    }
  }, [classworkKey])
  const attachments = loaded && loaded.key === classworkKey ? loaded.list : []
  const forms = attachments.filter((a) => a.source === 'form')
  const files = attachments.filter((a) => a.source !== 'form')

  const lineTrigger =
    'relative flex-none rounded-none border-0 px-2 py-1 text-foreground/60 shadow-none after:absolute after:inset-x-0 after:bottom-[-5px] after:h-0.5 after:bg-foreground after:opacity-0 after:transition-opacity hover:text-foreground data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none data-[state=active]:after:opacity-100 dark:data-[state=active]:bg-transparent'

  return (
    <>
      <ClassroomHeader fixed title={t('calendar.title')} description={t('calendar.desc')} />
      <Main>
        <Tabs
          defaultValue='calendar'
          className='flex h-[calc(100dvh-7rem)] min-h-125 flex-col gap-0 overflow-hidden rounded-xl border bg-card'
        >
          <div className='flex items-center justify-between gap-2 border-b p-2 sm:p-3'>
            <TabsList className='h-auto gap-1 rounded-none bg-transparent p-0'>
              <TabsTrigger value='calendar' className={lineTrigger}>
                {t('calendar.title')}
              </TabsTrigger>
              <TabsTrigger value='log' className={lineTrigger}>
                {t('calendar.log')}
              </TabsTrigger>
            </TabsList>
            <Badge variant='secondary' className='hidden sm:inline-flex'>
              {t('calendar.inView', { count: inView.length })}
            </Badge>
          </div>

          <TabsContent value='calendar' className='flex min-h-0 flex-1 flex-col'>
            <div className='flex flex-wrap items-center justify-between gap-2 border-b p-2 sm:p-3'>
              <div className='flex items-center gap-1'>
                <Button variant='outline' size='sm' onClick={() => setDate(new Date())}>
                  {t('calendar.today')}
                </Button>
                <Button
                  variant='ghost'
                  size='icon'
                  className='size-8'
                  aria-label={t('common.prev')}
                  onClick={() => move(-1)}
                >
                  <ChevronLeft />
                </Button>
                <h2 className='text-sm font-semibold sm:text-base'>{heading}</h2>
                <Button
                  variant='ghost'
                  size='icon'
                  className='size-8'
                  aria-label={t('common.next')}
                  onClick={() => move(1)}
                >
                  <ChevronRight />
                </Button>
              </div>
              <div className='flex flex-wrap items-center gap-2'>
                <div role='group' className='flex w-fit items-stretch'>
                  {VIEWS.map((v) => (
                    <Button
                      key={v}
                      variant={view === v ? 'default' : 'outline'}
                      size='sm'
                      className='rounded-none border-l-0 first:rounded-l-md first:border-l last:rounded-r-md'
                      aria-pressed={view === v}
                      onClick={() => setView(v)}
                    >
                      {t(`calendar.${v}`)}
                    </Button>
                  ))}
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant='outline' size='sm'>
                      <GraduationCap className='size-4' />
                      <span>
                        {t('calendar.coursesShown', {
                          shown: pickerCourses.filter((c) => !hiddenCourses.has(c.id)).length,
                          total: pickerCourses.length,
                        })}
                      </span>
                      <ChevronDown className='size-3.5 opacity-60' />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align='end' className='w-64'>
                    <DropdownMenuGroup className='max-h-72 overflow-y-auto'>
                      <DropdownMenuLabel>{t('courses.title')}</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      {pickerCourses.map((c) => (
                        <DropdownMenuCheckboxItem
                          key={c.id}
                          checked={!hiddenCourses.has(c.id)}
                          onCheckedChange={() => setHiddenCourses((s) => toggled(s, c.id))}
                          onSelect={(e) => e.preventDefault()} // stay open while picking
                        >
                          <span className='flex min-w-0 flex-col'>
                            <span className='truncate text-sm'>{c.name}</span>
                            {c.section && (
                              <span className='truncate text-xs text-muted-foreground'>
                                {c.section}
                              </span>
                            )}
                          </span>
                        </DropdownMenuCheckboxItem>
                      ))}
                    </DropdownMenuGroup>
                    <DropdownMenuSeparator />
                    <div className='flex items-center gap-1 p-1'>
                      <Button
                        variant='ghost'
                        size='sm'
                        className='flex-1'
                        onClick={() => setHiddenCourses(new Set())}
                      >
                        {t('calendar.selectAll')}
                      </Button>
                      <Button
                        variant='ghost'
                        size='sm'
                        className='flex-1'
                        onClick={() => setHiddenCourses(new Set(pickerCourses.map((c) => c.id)))}
                      >
                        {t('common.reset')}
                      </Button>
                    </div>
                  </DropdownMenuContent>
                </DropdownMenu>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant='outline' size='sm'>
                      <Filter className='size-4' />
                      <span>{t('calendar.filters')}</span>
                      <Badge variant='secondary' className='px-1.5 py-0 text-[10px]'>
                        {types.size}
                      </Badge>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align='end' className='w-52'>
                    <DropdownMenuGroup>
                      <DropdownMenuLabel>{t('calendar.type')}</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      {KINDS.map((kind) => (
                        <DropdownMenuCheckboxItem
                          key={kind}
                          checked={types.has(kind)}
                          onCheckedChange={() => setTypes((s) => toggled(s, kind))}
                          onSelect={(e) => e.preventDefault()}
                        >
                          <span
                            className={cn(
                              'size-2 shrink-0 rounded-full',
                              kind === 'event' ? EVENT_TONE.dot : TONES[kind].dot
                            )}
                          />
                          <span>
                            {kind === 'event' ? t('dashboard.googleCalendar') : t(`courses.${kind}`)}
                          </span>
                        </DropdownMenuCheckboxItem>
                      ))}
                    </DropdownMenuGroup>
                    <DropdownMenuSeparator />
                    <div className='flex items-center gap-1 p-1'>
                      <Button
                        variant='ghost'
                        size='sm'
                        className='flex-1'
                        onClick={() => setTypes(new Set(KINDS))}
                      >
                        {t('calendar.selectAll')}
                      </Button>
                      <Button
                        variant='ghost'
                        size='sm'
                        className='flex-1'
                        onClick={() => setTypes(new Set())}
                      >
                        {t('common.reset')}
                      </Button>
                    </div>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            {error && (
              <p role='alert' className='border-b p-3 text-sm text-destructive'>
                {error}
              </p>
            )}
            {calendarGranted === false && (
              <p className='border-b p-3 text-xs text-muted-foreground'>
                {t('dashboard.calendarNotGranted')}
              </p>
            )}

            {view === 'day' && looseEvents.length > 0 && (
              <div className='flex flex-wrap items-center gap-1.5 border-b p-2 sm:px-3'>
                <span className='flex items-center gap-1.5 text-xs text-muted-foreground'>
                  <CalendarDays className='size-4 shrink-0' />
                  {t('dashboard.googleCalendar')} ·{' '}
                  {t('calendar.eventCount', { count: looseEvents.length })}
                </span>
                {looseEvents.map((e) =>
                  eventBlock(
                    e,
                    'max-w-72 truncate rounded-md px-1.5 py-0.5 text-[11px] font-medium',
                    `${eventTime(e)} · ${e.title || t('dashboard.untitledEvent')}`
                  )
                )}
              </div>
            )}

            {view === 'month' ? (
              <div className='flex min-h-0 flex-1 flex-col overflow-auto'>
                <div className='sticky top-0 z-20 grid grid-cols-7 border-b border-border/70 bg-card'>
                  {weekdayNames('short').map((name) => (
                    <div key={name} className='py-2 text-center text-sm text-muted-foreground/70'>
                      {name}
                    </div>
                  ))}
                </div>
                <div className='grid flex-1 auto-rows-fr grid-cols-7'>
                  {monthDays.map((day) => {
                    const entries = entriesOn(day)
                    const more = entries.length - MONTH_CELL_ITEMS
                    return (
                      <div
                        key={day.getTime()}
                        className={cn(
                          'flex min-h-28 min-w-0 flex-col gap-0.5 border-r border-b border-border/70 px-0.5 py-1 sm:px-1 [&:nth-child(7n)]:border-r-0',
                          !isSameMonth(day, date) && 'bg-muted/25 text-muted-foreground/70'
                        )}
                      >
                        <button
                          type='button'
                          aria-label={fullDate(day)}
                          onClick={() => openDay(day)}
                          className={cn(
                            'mt-1 inline-flex size-6 items-center justify-center rounded-full text-sm transition-colors hover:bg-primary/10',
                            isSameDay(day, today) &&
                              'bg-primary text-primary-foreground hover:bg-primary/90'
                          )}
                        >
                          {day.getDate()}
                        </button>
                        {entries.slice(0, MONTH_CELL_ITEMS).map((entry) => (
                          <button
                            key={entry.key}
                            type='button'
                            onClick={entry.open}
                            title={`${entry.time} · ${entry.title}`}
                            className={cn(
                              'flex h-6 w-full min-w-0 shrink-0 items-center overflow-hidden rounded-sm px-1 text-left text-[10px] font-medium transition-opacity hover:opacity-90 sm:px-2 sm:text-xs',
                              entry.tone.block
                            )}
                          >
                            <span className='truncate'>
                              <span className='font-normal opacity-70 max-sm:hidden sm:text-[11px]'>
                                {entry.time}
                              </span>{' '}
                              {entry.title}
                            </span>
                          </button>
                        ))}
                        {more > 0 && (
                          <button
                            type='button'
                            onClick={() => openDay(day)}
                            className='h-6 truncate rounded-sm px-1 text-left text-[10px] text-muted-foreground hover:bg-muted/50 hover:text-foreground sm:px-2 sm:text-xs'
                          >
                            {t('calendar.more', { count: more })}
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            ) : view === 'list' ? (
              <div className='min-h-0 flex-1 overflow-y-auto px-4'>
                {listDays.length === 0 ? (
                  <p className='py-4 text-sm text-muted-foreground'>{t('calendar.emptyRange')}</p>
                ) : (
                  listDays.map(({ day, entries }) => (
                    <section
                      key={day.getTime()}
                      className='relative my-12 border-t border-border/70 first:mt-8'
                    >
                      <h3
                        className={cn(
                          'absolute -top-3 left-0 flex h-6 items-center bg-card pe-4 text-[10px] uppercase sm:text-xs',
                          isSameDay(day, today) && 'font-medium'
                        )}
                      >
                        {day.toLocaleDateString(lang, {
                          day: 'numeric',
                          month: 'short',
                          weekday: 'long',
                        })}
                      </h3>
                      <div className='space-y-2 pt-6'>
                        {entries.map((entry) => (
                          <button
                            key={entry.key}
                            type='button'
                            onClick={entry.open}
                            className={cn(
                              'flex w-full flex-col gap-1 rounded p-2 text-left transition-opacity hover:opacity-90',
                              entry.tone.block
                            )}
                          >
                            <span className='text-sm font-medium'>{entry.title}</span>
                            <span className='text-xs opacity-70'>
                              <span className='uppercase'>{entry.time}</span>
                              <span className='px-1 opacity-35'>·</span>
                              {entry.where}
                            </span>
                          </button>
                        ))}
                      </div>
                    </section>
                  ))
                )}
              </div>
            ) : view === 'year' ? (
              <div className='min-h-0 flex-1 overflow-y-auto'>
                <div className='grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'>
                  {Array.from({ length: 12 }, (_, m) => addMonths(from, m)).map((month) => (
                    <div key={month.getTime()} className='rounded-lg border bg-card p-3'>
                      <h3 className='mb-2 text-center text-sm font-semibold'>
                        {month.toLocaleDateString(lang, { month: 'long' })}
                      </h3>
                      <div className='grid grid-cols-7'>
                        {weekdayNames('narrow').map((name, i) => (
                          <div
                            key={i}
                            className='py-1 text-center text-[10px] font-normal text-muted-foreground/70'
                          >
                            {name}
                          </div>
                        ))}
                        {monthGrid(month).map((day) =>
                          isSameMonth(day, month) ? (
                            <div key={day.getTime()} className='flex flex-col items-center'>
                              <button
                                type='button'
                                aria-label={fullDate(day)}
                                onClick={() => openDay(day)}
                                className={cn(
                                  'flex size-9 flex-col items-center justify-center gap-0.5 rounded-lg text-[11px] transition-colors select-none',
                                  isSameDay(day, today)
                                    ? 'bg-primary font-semibold text-primary-foreground'
                                    : 'hover:bg-primary/10 dark:hover:bg-primary/20'
                                )}
                              >
                                <span>{day.getDate()}</span>
                                <span className='flex min-h-2 items-center gap-px'>
                                  {entriesOn(day)
                                    .slice(0, 3)
                                    .map((entry) => (
                                      <span
                                        key={entry.key}
                                        className={cn('size-1 shrink-0 rounded-full', entry.tone.dot)}
                                      />
                                    ))}
                                </span>
                              </button>
                            </div>
                          ) : (
                            <div
                              key={day.getTime()}
                              aria-hidden
                              className='flex size-9 flex-col items-center justify-center gap-0.5 justify-self-center text-[11px] opacity-25'
                            >
                              {day.getDate()}
                              <span className='min-h-2' />
                            </div>
                          )
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : view === 'week' ? (
              <div className='min-h-0 flex-1 overflow-auto'>
                <div className='grid min-w-[1080px] grid-cols-[4rem_repeat(7,minmax(9rem,1fr))]'>
                  <div className='sticky top-0 z-20 border-r border-b bg-card' />
                  {days.map((day) => (
                    <div
                      key={day.getTime()}
                      className='sticky top-0 z-20 border-r border-b bg-card p-2 text-center last:border-r-0'
                    >
                      <p className='text-[11px] font-medium text-muted-foreground uppercase'>
                        {day.toLocaleDateString(lang, { weekday: 'short' })}
                      </p>
                      <p
                        className={cn(
                          'text-sm font-semibold',
                          isSameDay(day, today) && 'text-primary'
                        )}
                      >
                        {day.getDate()}
                      </p>
                      {eventsOn(day)
                        .filter((e) => e.all_day)
                        .map((e) => eventBlock(e, 'mt-1 block w-full truncate rounded-md px-1.5 py-0.5 text-[10px] font-medium'))}
                    </div>
                  ))}
                  {hours.map((hour) => (
                    <Fragment key={hour}>
                      <div className='border-r border-b p-1 text-right text-[10px] text-muted-foreground'>
                        {hourLabel(hour)}
                      </div>
                      {days.map((day) => (
                        <div
                          key={day.getTime()}
                          className={cn(
                            'flex min-h-16 flex-col gap-1 border-r border-b p-1 last:border-r-0',
                            isSameDay(day, today) && 'bg-primary/5'
                          )}
                        >
                          {inRange
                            .filter((p) => isSameDay(p.at, day) && p.at.getHours() === hour)
                            .sort((a, b) => a.at.getTime() - b.at.getTime())
                            .map((p) => (
                              <button
                                key={postKey(p)}
                                type='button'
                                onClick={() => setOpened(p)}
                                className={cn(
                                  'w-full overflow-hidden rounded-lg px-2 py-1.5 text-left leading-tight transition-opacity hover:opacity-90',
                                  TONES[p.type].block
                                )}
                              >
                                <span className='block truncate text-[11px] font-semibold'>
                                  {p.title}
                                </span>
                                <span className='block truncate text-[10px] opacity-80'>
                                  {timeOf(p.at)} · {courseOf(p.course_id)?.name}
                                </span>
                              </button>
                            ))}
                          {timedOf(eventsOn(day))
                            .filter((e) => isSameDay(e.from, day) && e.from.getHours() === hour)
                            .map((e) =>
                              eventBlock(
                                e,
                                'block w-full overflow-hidden rounded-lg px-2 py-1.5 leading-tight',
                                <>
                                  <span className='block truncate text-[11px] font-semibold'>
                                    {e.title || t('dashboard.untitledEvent')}
                                  </span>
                                  <span className='block truncate text-[10px] opacity-80'>
                                    {eventTime(e)} · {e.calendar}
                                  </span>
                                </>
                              )
                            )}
                        </div>
                      ))}
                    </Fragment>
                  ))}
                </div>
              </div>
            ) : dayCourses.length === 0 && dayEvents.length === 0 ? (
              <p className='p-3 text-sm text-muted-foreground sm:p-4'>{t('dashboard.noPosts')}</p>
            ) : (
              <div className='min-h-0 flex-1 overflow-auto'>
                <div className='flex min-w-fit flex-col'>
                  <div className='sticky top-0 z-20 flex border-b bg-card'>
                    <div className='flex flex-1 bg-muted/40'>
                      <div className='w-16 shrink-0 border-r' />
                      {dayCourses.map((c) => (
                        <div
                          key={c.id}
                          className='min-w-45 flex-1 border-r p-2 last:border-r-0 sm:p-3'
                        >
                          {/* w-0 min-w-full: a long name is cut off instead of widening the column. */}
                          <div className='w-0 min-w-full'>
                            <p className='truncate text-sm font-semibold'>{c.name}</p>
                            <p className='truncate text-xs text-muted-foreground'>
                              {c.section && `${c.section} · `}
                              {t('calendar.postCount', {
                                count: inDay.filter((p) => p.course_id === c.id).length,
                              })}
                            </p>
                            {dayEvents
                              .filter((e) => e.all_day && e.course_id === c.id)
                              .map((e) => eventBlock(e, 'mt-1 block w-full truncate rounded-md px-1.5 py-0.5 text-[11px] font-medium'))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className='relative flex'>
                    {nowTop !== null && (
                      <div
                        data-slot='now-line'
                        aria-hidden
                        className='pointer-events-none absolute right-0 left-16 z-10 flex items-center'
                        style={{ top: nowTop }}
                      >
                        <div className='absolute -left-1 size-2 rounded-full bg-primary' />
                        <div className='h-0.5 w-full bg-primary' />
                      </div>
                    )}
                    <div className='relative w-16 shrink-0 border-r' style={{ height: gridHeight }}>
                      {hours.map(
                        (hour, i) =>
                          i > 0 && (
                            <span
                              key={hour}
                              className='absolute right-2 -translate-y-1/2 text-[10px] text-muted-foreground'
                              style={{ top: i * HOUR_HEIGHT }}
                            >
                              {hourLabel(hour)}
                            </span>
                          )
                      )}
                    </div>
                    {dayCourses.map((c) => {
                      const mine = inDay.filter((p) => p.course_id === c.id)
                      const lessons = timedOf(dayEvents).filter((e) => e.course_id === c.id)
                      const layout = layoutColumns(
                        [
                          ...mine.map((p) => ({ id: postKey(p), start: minutesOf(p.at) })),
                          ...lessons.map((e) => ({ id: e.id, ...span(e) })),
                        ],
                        NOMINAL_MINUTES
                      )
                      return (
                        <div
                          key={c.id}
                          className='relative min-w-45 flex-1 border-r last:border-r-0'
                          style={{ height: gridHeight }}
                        >
                          {hours.map((hour) => (
                            <div
                              key={hour}
                              className='border-b border-border/70'
                              style={{ height: HOUR_HEIGHT }}
                            />
                          ))}
                          {mine.map((p) => {
                            const { left, width } = layout.get(postKey(p))!
                            const top = ((minutesOf(p.at) - firstHour * 60) / 60) * HOUR_HEIGHT + 1
                            return (
                              <button
                                key={postKey(p)}
                                type='button'
                                onClick={() => setOpened(p)}
                                style={{
                                  // A post just before midnight stays inside the grid.
                                  top: Math.min(top, gridHeight - blockHeight - 1),
                                  height: blockHeight,
                                  left: `calc(${left * 100}% + 2px)`,
                                  width: `calc(${width * 100}% - 4px)`,
                                }}
                                className={cn(
                                  '@container absolute z-10 flex flex-col overflow-hidden rounded-lg px-2.5 py-1.5 text-left leading-tight transition-opacity hover:opacity-90',
                                  TONES[p.type].block
                                )}
                              >
                                <div className='flex items-center justify-between gap-1'>
                                  <span className='truncate text-xs font-semibold'>{p.title}</span>
                                  <Badge
                                    variant='outline'
                                    className={cn(
                                      // Side-by-side blocks are too narrow for it: the colour still tells the type.
                                      'hidden shrink-0 border-transparent px-1.5 py-0 text-[10px] leading-tight @[9rem]:inline-flex',
                                      TONES[p.type].badge
                                    )}
                                  >
                                    {t(`courses.${p.type}`)}
                                  </Badge>
                                </div>
                                <span className='mt-0.5 truncate text-[11px] opacity-80'>
                                  {timeOf(p.at)}
                                </span>
                              </button>
                            )
                          })}
                          {lessons.map((e) => {
                            const { left, width } = layout.get(e.id)!
                            const { start, duration } = span(e)
                            const top = Math.max(0, ((start - firstHour * 60) / 60) * HOUR_HEIGHT + 1)
                            const height = Math.min((duration / 60) * HOUR_HEIGHT - 2, gridHeight - top - 1)
                            return eventBlock(
                              e,
                              'absolute z-10 flex flex-col overflow-hidden rounded-lg px-2.5 py-1.5 leading-tight',
                              <>
                                <span className='truncate text-xs font-semibold'>
                                  {e.title || t('dashboard.untitledEvent')}
                                </span>
                                <span className='mt-0.5 truncate text-[11px] opacity-80'>
                                  {eventTime(e)}
                                </span>
                              </>,
                              {
                                top,
                                height: Math.max(height, blockHeight),
                                left: `calc(${left * 100}% + 2px)`,
                                width: `calc(${width * 100}% - 4px)`,
                              }
                            )
                          })}
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value='log' className='min-h-0 flex-1 overflow-y-auto'>
            <div className='flex flex-col gap-4 p-3 sm:p-4'>
              <div className='flex flex-wrap items-center justify-between gap-2'>
                <span className='text-sm font-semibold'>
                  {t('calendar.recentUpdates', { count: inRange.length })}
                </span>
                <div className='flex flex-wrap gap-2'>
                  {TYPES.map((type) => (
                    <Badge key={type} variant='secondary'>
                      {t(`courses.${type}`)} {inRange.filter((p) => p.type === type).length}
                    </Badge>
                  ))}
                </div>
              </div>
              {inRange.length === 0 ? (
                <p className='text-sm text-muted-foreground'>{t('calendar.emptyRange')}</p>
              ) : (
                <div className='flex flex-col divide-y rounded-lg border'>
                  {[...inRange]
                    .sort((a, b) => b.at.getTime() - a.at.getTime())
                    .map((p) => {
                      const { Icon, icon } = TONES[p.type]
                      return (
                        <button
                          key={postKey(p)}
                          type='button'
                          onClick={() => setOpened(p)}
                          className='flex items-start gap-3 p-3 text-left hover:bg-accent/40'
                        >
                          <span
                            className={cn(
                              'flex size-8 shrink-0 items-center justify-center rounded-full',
                              icon
                            )}
                          >
                            <Icon className='size-4' />
                          </span>
                          <div className='min-w-0 flex-1'>
                            <div className='flex items-center justify-between gap-2'>
                              <span className='truncate text-sm font-medium'>
                                {p.title}{' '}
                                <Badge variant='secondary' className='ml-1 align-middle'>
                                  {t(`courses.${p.type}`)}
                                </Badge>
                              </span>
                              <span className='shrink-0 text-xs text-muted-foreground'>
                                {p.at.toLocaleString(lang, {
                                  month: 'short',
                                  day: 'numeric',
                                  hour: 'numeric',
                                  minute: '2-digit',
                                })}
                              </span>
                            </div>
                            <p className='truncate text-xs text-muted-foreground'>
                              {courseOf(p.course_id)?.name}
                            </p>
                          </div>
                        </button>
                      )
                    })}
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </Main>

      <Sheet open={!!opened} onOpenChange={(open) => !open && setOpened(null)}>
        <SheetContent className='flex flex-col gap-0 sm:max-w-100'>
          {opened && (
            <>
              <SheetHeader>
                <div className='flex items-center gap-3 pe-6'>
                  <span
                    className={cn(
                      'flex size-10 shrink-0 items-center justify-center rounded-full',
                      openedTone.icon
                    )}
                  >
                    <openedTone.Icon className='size-5' />
                  </span>
                  <div className='min-w-0'>
                    <SheetTitle className='line-clamp-2'>
                      {opened.title || t('dashboard.untitledEvent')}
                    </SheetTitle>
                    <Badge variant='outline' className={cn('mt-1', openedTone.block)}>
                      {openedPost ? t(`courses.${openedPost.type}`) : t('dashboard.googleCalendar')}
                    </Badge>
                  </div>
                </div>
                <SheetDescription className='sr-only'>{opened.title}</SheetDescription>
              </SheetHeader>
              <div className='flex flex-1 flex-col gap-3 overflow-y-auto px-4 text-sm'>
                {openedCourse && (
                  <div className='flex items-center gap-2'>
                    <GraduationCap className='size-4 shrink-0 text-muted-foreground' />
                    <span>
                      {openedCourse.name}{' '}
                      {openedCourse.section && (
                        <span className='text-muted-foreground'>· {openedCourse.section}</span>
                      )}
                    </span>
                  </div>
                )}
                {openedEvent && (
                  <div className='flex items-center gap-2'>
                    <CalendarDays className='size-4 shrink-0 text-muted-foreground' />
                    <span>{openedEvent.calendar}</span>
                  </div>
                )}
                <div className='flex items-center gap-2'>
                  <Clock className='size-4 shrink-0 text-muted-foreground' />
                  <span>
                    {openedPost
                      ? openedPost.at.toLocaleString(lang, { dateStyle: 'full', timeStyle: 'short' })
                      : openedEvent &&
                        `${openedEvent.from.toLocaleDateString(lang, { dateStyle: 'full' })} · ${eventTime(openedEvent)}`}
                  </span>
                </div>
                {openedEvent?.location && (
                  <div className='flex items-center gap-2'>
                    <MapPin className='size-4 shrink-0 text-muted-foreground' />
                    <span>{openedEvent.location}</span>
                  </div>
                )}
                {openedEvent?.description && (
                  <p className='border-t pt-3 break-words whitespace-pre-wrap'>
                    {plainText(openedEvent.description)}
                  </p>
                )}
                {[
                  { key: 'forms', label: t('calendar.googleForms', { count: forms.length }), list: forms },
                  { key: 'files', label: t('classwork.attachments', { count: files.length }), list: files },
                ].map(
                  ({ key, label, list }) =>
                    list.length > 0 && (
                      <div key={key} className='space-y-2 border-t pt-3'>
                        <p className='text-xs font-medium text-muted-foreground uppercase'>{label}</p>
                        {list.map((att) => (
                          <AttachmentView key={att.id} att={att} />
                        ))}
                      </div>
                    )
                )}
              </div>
              {openedLink && (
                <SheetFooter className='flex-row justify-end'>
                  <Button asChild>
                    <a href={openedLink} target='_blank' rel='noreferrer'>
                      <ExternalLink />
                      <span>
                        {openedPost
                          ? t('courses.openInClassroom')
                          : t('calendar.openInGoogleCalendar')}
                      </span>
                    </a>
                  </Button>
                </SheetFooter>
              )}
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  )
}
