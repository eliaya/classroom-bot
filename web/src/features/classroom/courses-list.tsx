import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, Search, SlidersHorizontal } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { api, type Course, type CoursePerson, type Post } from '@/lib/api'
import { cn, fullTimestamp, humanReadableTime, weekdayLabel } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Main } from '@/components/layout/main'
import AnimatedTooltipMotion from '@/components/shadcn-space/tooltip/tooltip-03'
import {
  CourseSheet,
  StatusBadge,
  type CourseRow,
} from './components/course-sheet'
import { ClassroomHeader } from './layout-header'
import { DashboardBoard } from './dashboard-board'

type Period = '30' | '90' | 'year'
type Band = 'all' | 'high' | 'mid' | 'low'
type StatusTab = 'today' | 'all' | 'todo' | 'archived'
type ColumnKey = 'day' | 'name' | 'people' | 'updates' | 'coursework' | 'status' | 'last'

const COLUMNS: { key: ColumnKey; label: string }[] = [
  { key: 'day', label: 'courses.week' },
  { key: 'name', label: 'courses.courseName' },
  { key: 'people', label: 'courses.people' },
  { key: 'updates', label: 'courses.updates' },
  { key: 'coursework', label: 'courses.coursework' },
  { key: 'status', label: 'courses.status' },
  { key: 'last', label: 'courses.lastUpdate' },
]

const DAY_MS = 86_400_000
// Avatars shown per course before the rest are counted as "+N".
const MAX_AVATARS = 5

// Per-device: the table keeps the last sort order.
const SORT_KEY = 'courses-sort'
type Sort = { key: ColumnKey; desc: boolean }
function savedSort(): Sort {
  try {
    const saved = JSON.parse(localStorage.getItem(SORT_KEY) ?? 'null') as Sort | null
    if (saved && COLUMNS.some((c) => c.key === saved.key)) return { key: saved.key, desc: !!saved.desc }
  } catch {
    // private mode or a bad value: the default
  }
  return { key: 'last', desc: true }
}

/** Start of the selected period. */
function periodStart(period: Period, now: number) {
  return period === 'year'
    ? new Date(new Date(now).getFullYear(), 0, 1).getTime()
    : now - Number(period) * DAY_MS
}

export function CoursesListPage() {
  const { t, i18n } = useTranslation()
  const [courses, setCourses] = useState<Course[]>([])
  // The posts of each period, fetched the first time it is chosen.
  const [posts, setPosts] = useState<Partial<Record<Period, Post[]>>>({})
  const [people, setPeople] = useState<CoursePerson[]>([])
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<StatusTab>('today')
  const [query, setQuery] = useState('')
  const [period, setPeriod] = useState<Period>('90')
  const [band, setBand] = useState<Band>('all')
  const [hidden, setHidden] = useState<ColumnKey[]>([])
  const [sort, setSort] = useState<Sort>(savedSort)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // Fixed for the page's lifetime so the periods do not shift while it is open.
  const [now] = useState(() => Date.now())

  useEffect(() => {
    try {
      localStorage.setItem(SORT_KEY, JSON.stringify(sort))
    } catch {
      // private mode: not remembered
    }
  }, [sort])

  // Loaded in batches, none waiting for another: the courses (with their last
  // update) fill the table, then the period's posts and the people fill in.
  useEffect(() => {
    api
      .listCourses()
      .then((res) => setCourses(res.items))
      .catch((e) => setError(e instanceof Error ? e.message : t('common.loadFailed')))
    // An extra: without it the People column stays empty.
    api
      .listPeople()
      .then((res) => setPeople(res.items))
      .catch(() => undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (posts[period]) return
    api
      .listPosts(new Date(periodStart(period, now)).toISOString(), new Date(now + DAY_MS).toISOString())
      .then((res) => setPosts((all) => ({ ...all, [period]: res.items })))
      .catch((e) => setError(e instanceof Error ? e.message : t('common.loadFailed')))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period])

  // Optimistic: the row fades at once and comes back if the save fails.
  const archive = (id: string, archived: boolean) => {
    const apply = (value: boolean) =>
      setCourses((all) => all.map((c) => (c.id === id ? { ...c, archived: value } : c)))
    apply(archived)
    api.setCourseArchived(id, archived).catch(() => {
      apply(!archived)
      toast.error(t('common.saveFailed'))
    })
  }

  // Teachers first, as the API orders them within a course ("student" < "teacher").
  const peopleOf = (courseId: string) =>
    people.filter((p) => p.course_id === courseId).sort((a, b) => b.role.localeCompare(a.role))

  const rows = useMemo(() => {
    const current = posts[period] ?? []
    // Course weekdays are 1 (Mon) … 7 (Sun); getDay() is 0 (Sun) … 6 (Sat).
    const todayWeek = new Date(now).getDay() || 7

    return courses.map((course): CourseRow => {
      const mine = current.filter((p) => p.course_id === course.id)
      return {
        course,
        updates: mine.length,
        announcements: mine.filter((p) => p.type === 'announcement').length,
        coursework: mine.filter((p) => p.type === 'coursework').length,
        materials: mine.filter((p) => p.type === 'material').length,
        last: course.last_update ? new Date(course.last_update).getTime() : null,
        status: course.week === todayWeek ? 'today' : mine.length ? 'active' : 'quiet',
        pending: !posts[period],
      }
    })
  }, [courses, posts, period, now])

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const value = (row: CourseRow): string | number => {
      switch (sort.key) {
        case 'day':
          return row.course.week ?? 9
        case 'name':
          return row.course.name
        case 'people':
          return people.filter((p) => p.course_id === row.course.id).length
        case 'updates':
          return row.updates
        case 'coursework':
          return row.coursework
        case 'status':
          return row.status
        case 'last':
          return row.last ?? 0
      }
    }
    return rows
      // Archived courses are listed under their own tab only.
      .filter((row) => (tab === 'archived') === !!row.course.archived)
      .filter((row) => tab !== 'today' || row.status === 'today')
      .filter(
        (row) =>
          !needle ||
          [row.course.name, row.course.section, row.course.id].some((text) =>
            (text ?? '').toLowerCase().includes(needle)
          )
      )
      .filter(
        (row) =>
          band === 'all' ||
          (band === 'high' ? row.updates >= 10 : band === 'mid' ? row.updates >= 3 && row.updates < 10 : row.updates < 3)
      )
      .sort((a, b) => {
        const [x, y] = [value(a), value(b)]
        const order = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))
        return sort.desc ? -order : order
      })
  }, [rows, tab, query, band, sort, people])

  const shown = COLUMNS.filter((column) => !hidden.includes(column.key))
  const lastUpdate = (row: CourseRow) =>
    row.last
      ? new Date(row.last).toLocaleDateString(i18n.language, { year: 'numeric', month: 'short', day: '2-digit' })
      : t('common.dash')

  const pending = <Skeleton className='h-4 w-8' />
  const cell = (row: CourseRow, key: ColumnKey) => {
    switch (key) {
      case 'day':
        return weekdayLabel(row.course.week, i18n.language) ?? t('common.dash')
      case 'name':
        return (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type='button'
                onClick={() => setSelectedId(row.course.id)}
                className='block max-w-full truncate rounded-sm text-start font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring'
              >
                {row.course.name}
              </button>
            </TooltipTrigger>
            <TooltipContent side='top' align='start'>
              {t('courses.courseId')}: <span className='tabular-nums'>{row.course.id}</span>
            </TooltipContent>
          </Tooltip>
        )
      case 'people': {
        const mine = peopleOf(row.course.id)
        if (!mine.length) return t('common.dash')
        return (
          <AnimatedTooltipMotion
            items={mine.slice(0, MAX_AVATARS).map((p) => ({
              id: `${p.role}-${p.user_id}`,
              name: p.full_name || p.user_id,
              designation: p.role,
              image: p.photo_url,
            }))}
            more={mine.length - MAX_AVATARS}
          />
        )
      }
      case 'updates':
        return row.pending ? pending : <span className='tabular-nums'>{row.updates}</span>
      case 'coursework':
        return row.pending ? pending : <span className='tabular-nums'>{row.coursework}</span>
      case 'status':
        return row.pending && row.status !== 'today' ? pending : <StatusBadge status={row.status} />
      case 'last':
        return (
          <span title={row.last ? fullTimestamp(new Date(row.last).toISOString()) || undefined : undefined}>
            {lastUpdate(row)}
          </span>
        )
    }
  }

  const empty = !courses.length
    ? t('courses.noCourses')
    : tab === 'archived' && !query && band === 'all'
      ? t('courses.noArchived')
      : t('courses.noMatch')

  const tabs: { key: StatusTab; label: string }[] = [
    { key: 'today', label: 'courses.statusName.today' },
    { key: 'all', label: 'courses.allCourses' },
    { key: 'todo', label: 'courses.todo' },
    { key: 'archived', label: 'courses.archived' },
  ]

  return (
    <>
      <ClassroomHeader fixed title={t('courses.title')} />
      <Main fluid className='flex flex-1 flex-col gap-4 sm:gap-6'>
        {error && (
          <p role='alert' className='text-sm text-destructive'>
            {error}
          </p>
        )}

        <div className='flex flex-col gap-4'>
          <div role='tablist' aria-label={t('courses.status')} className='flex gap-1 border-b'>
            {tabs.map(({ key, label }) => (
              <button
                key={key}
                type='button'
                role='tab'
                aria-selected={tab === key}
                onClick={() => setTab(key)}
                className={cn(
                  '-mb-px h-9 border-b-2 px-4 text-sm font-medium whitespace-nowrap transition-colors outline-none first:ps-1 focus-visible:ring-2 focus-visible:ring-ring',
                  tab === key
                    ? 'border-foreground text-foreground'
                    : 'border-transparent text-foreground/60 hover:text-foreground'
                )}
              >
                {t(label)}
              </button>
            ))}
          </div>

          {tab === 'todo' ? (
            <DashboardBoard />
          ) : (
            <>
              <div className='flex flex-col gap-3 md:flex-row md:items-center'>
                <div className='relative md:w-56'>
                  <Search
                    className='pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground'
                    aria-hidden='true'
                  />
                  <Input
                    type='search'
                    aria-label={t('courses.searchCourses')}
                    placeholder={t('courses.searchCourses')}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    className='ps-9'
                  />
                </div>
                <div className='grid grid-cols-2 gap-3 md:flex'>
                  <Select value={period} onValueChange={(value) => setPeriod(value as Period)}>
                    <SelectTrigger aria-label={t('courses.period')} className='w-full md:w-40'>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value='30'>{t('courses.last30')}</SelectItem>
                      <SelectItem value='90'>{t('courses.last90')}</SelectItem>
                      <SelectItem value='year'>{t('courses.thisYear')}</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={band} onValueChange={(value) => setBand(value as Band)}>
                    <SelectTrigger aria-label={t('courses.activityBand')} className='w-full md:w-40'>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(['all', 'high', 'mid', 'low'] as const).map((value) => (
                        <SelectItem key={value} value={value}>
                          {t(`courses.band.${value}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant='outline' className='hidden md:ms-auto md:inline-flex'>
                      <SlidersHorizontal aria-hidden='true' />
                      {t('courses.manageTable')}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align='end'>
                    {COLUMNS.map(({ key, label }) => (
                      <DropdownMenuCheckboxItem
                        key={key}
                        checked={!hidden.includes(key)}
                        onSelect={(e) => e.preventDefault()}
                        onCheckedChange={(checked) =>
                          setHidden((keys) => (checked ? keys.filter((k) => k !== key) : [...keys, key]))
                        }
                      >
                        {t(label)}
                      </DropdownMenuCheckboxItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              {/* Desktop: sortable table. */}
              {/* relative: keeps the table's sr-only (absolute) labels inside the scroll area. */}
              <div className='relative hidden overflow-x-auto md:block'>
                <table className='w-full text-sm'>
                  <thead>
                    <tr className='bg-muted/50 text-left'>
                      {shown.map(({ key, label }) => (
                        <th
                          key={key}
                          scope='col'
                          aria-sort={sort.key === key ? (sort.desc ? 'descending' : 'ascending') : 'none'}
                          className='h-10 px-2 font-medium first:ps-3'
                        >
                          <button
                            type='button'
                            onClick={() =>
                              setSort((s) => ({ key, desc: s.key === key ? !s.desc : false }))
                            }
                            className={cn(
                              'inline-flex items-center gap-1 rounded-sm text-xs whitespace-nowrap outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring',
                              sort.key === key ? 'text-foreground' : 'text-muted-foreground'
                            )}
                          >
                            {t(label)}
                            {sort.key === key && !sort.desc ? (
                              <ChevronUp className='size-3' aria-hidden='true' />
                            ) : (
                              <ChevronDown className='size-3' aria-hidden='true' />
                            )}
                          </button>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((row) => (
                      <tr
                        key={row.course.id}
                        className={cn(
                          'border-b transition-colors hover:bg-muted/40',
                          row.course.archived && 'opacity-50'
                        )}
                      >
                        {shown.map(({ key }) => (
                          <td key={key} className={cn('h-14 px-2 first:ps-3', key === 'name' && 'max-w-80')}>
                            {cell(row, key)}
                          </td>
                        ))}
                      </tr>
                    ))}
                    {!visible.length && (
                      <tr>
                        <td colSpan={shown.length} className='h-24 text-center text-muted-foreground'>
                          {empty}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Below md: one card per course. */}
              <ul className='flex flex-col gap-3 md:hidden'>
                {visible.map((row) => (
                  <li key={row.course.id} className={cn('rounded-lg border p-4', row.course.archived && 'opacity-50')}>
                    <span className='text-xs text-muted-foreground tabular-nums'>{row.course.id}</span>
                    <div className='mt-1'>{cell(row, 'name')}</div>
                    <div className='mt-3'>
                      <StatusBadge status={row.status} />
                    </div>
                    <dl className='mt-4 grid grid-cols-2 gap-3 text-sm'>
                      <div>
                        <dt className='text-xs text-muted-foreground'>{t('courses.updates')}</dt>
                        <dd className='font-medium tabular-nums'>{row.updates}</dd>
                      </div>
                      <div>
                        <dt className='text-xs text-muted-foreground'>{t('courses.lastUpdate')}</dt>
                        <dd className='font-medium'>{lastUpdate(row)}</dd>
                      </div>
                    </dl>
                  </li>
                ))}
                {!visible.length && (
                  <li className='rounded-lg border p-6 text-center text-sm text-muted-foreground'>
                    {empty}
                  </li>
                )}
              </ul>
            </>
          )}
        </div>
      </Main>

      <CourseSheet
        row={rows.find((row) => row.course.id === selectedId) ?? null}
        periodLabel={t(period === 'year' ? 'courses.thisYear' : `courses.last${period}`)}
        relative={(time) => humanReadableTime(time, t('common.dash'))}
        onClose={() => setSelectedId(null)}
        onArchive={(archived) => selectedId && archive(selectedId, archived)}
      />
    </>
  )
}
