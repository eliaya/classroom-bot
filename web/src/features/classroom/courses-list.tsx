import { useEffect, useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import {
  BookOpen,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  FileText,
  Megaphone,
  MoreHorizontal,
  RefreshCw,
  Search,
  SlidersHorizontal,
  type LucideIcon,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useSyncStatusStore } from '@/stores/sync-status-store'
import { api, type Course, type CoursePerson, type Post } from '@/lib/api'
import { useCan } from '@/lib/permissions'
import { cn, fullTimestamp, humanReadableTime, weekdayLabel } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Main } from '@/components/layout/main'
import AnimatedTooltipMotion from '@/components/shadcn-space/tooltip/tooltip-03'
import {
  CourseSheet,
  StatusBadge,
  type CourseRow,
} from './components/course-sheet'
import { ClassroomHeader } from './layout-header'

type Period = '30' | '90' | 'year'
type Band = 'all' | 'high' | 'mid' | 'low'
type StatusTab = 'all' | 'today' | 'active'
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
const SPARK_POINTS = 12
// Avatars shown per course before the rest are counted as "+N".
const MAX_AVATARS = 5
// ponytail: one request for two years of posts, sliced in the browser for every
// period; page the API if a user's history ever makes this slow.
const HISTORY_MS = 730 * DAY_MS

/** Start of the selected period and of the equally long one before it. */
function periodBounds(period: Period, now: number) {
  const start =
    period === 'year'
      ? new Date(new Date(now).getFullYear(), 0, 1).getTime()
      : now - Number(period) * DAY_MS
  return { start, prevStart: start - (now - start) }
}

/** Percent change, or null when there is nothing to compare with. */
function change(current: number, previous: number): number | null {
  return previous === 0 ? null : ((current - previous) / previous) * 100
}

function Sparkline({ points, className }: { points: number[]; className?: string }) {
  const max = Math.max(...points, 1)
  const coords = points
    .map((p, i) => `${(i / (points.length - 1)) * 78 + 1},${34 - (p / max) * 32}`)
    .join(' ')
  return (
    <svg viewBox='0 0 80 36' aria-hidden='true' className={cn('h-9 w-20 shrink-0', className)}>
      <polyline
        points={coords}
        fill='none'
        strokeWidth='1.5'
        strokeLinejoin='round'
        strokeLinecap='round'
        vectorEffect='non-scaling-stroke'
        className='stroke-sky-500'
      />
    </svg>
  )
}

type Kpi = { label: string; icon: LucideIcon; value: number; delta: number | null; points: number[] }

/** One KPI. `compact` is the card used below md: the label gets the full width. */
function KpiBody({ kpi, compact }: { kpi: Kpi; compact?: boolean }) {
  const { t } = useTranslation()
  const Icon = kpi.icon
  const label = (
    <span className={cn('flex items-center gap-2 text-muted-foreground', compact ? 'text-xs' : 'text-sm')}>
      <Icon className='size-4 shrink-0' aria-hidden='true' />
      <span className='truncate'>{t(kpi.label)}</span>
    </span>
  )
  const figures = (
    <span className={cn('flex', compact ? 'flex-col' : 'items-baseline gap-2')}>
      <span className={cn('font-semibold tabular-nums', compact ? 'text-lg' : 'text-2xl')}>
        {kpi.value.toLocaleString()}
      </span>
      {kpi.delta !== null && (
        <span
          className={cn(
            'font-medium tabular-nums',
            compact ? 'text-xs' : 'text-sm',
            kpi.delta < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'
          )}
        >
          {kpi.delta >= 0 ? '+' : ''}
          {kpi.delta.toFixed(1)}%
        </span>
      )}
    </span>
  )
  if (compact) {
    return (
      <div className='flex w-full min-w-0 flex-col gap-2'>
        {label}
        <div className='flex items-end justify-between gap-2'>
          {figures}
          <Sparkline points={kpi.points} className='h-7 w-14' />
        </div>
      </div>
    )
  }
  return (
    <>
      <div className='flex min-w-0 flex-col gap-2'>
        {label}
        {figures}
      </div>
      <Sparkline points={kpi.points} />
    </>
  )
}

export function CoursesListPage() {
  const { t, i18n } = useTranslation()
  const canSync = useCan('sync:use')
  const [courses, setCourses] = useState<Course[]>([])
  const [posts, setPosts] = useState<Post[]>([])
  const [people, setPeople] = useState<CoursePerson[]>([])
  const [error, setError] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [tab, setTab] = useState<StatusTab>('all')
  const [query, setQuery] = useState('')
  const [period, setPeriod] = useState<Period>('90')
  const [band, setBand] = useState<Band>('all')
  const [hidden, setHidden] = useState<ColumnKey[]>([])
  const [sort, setSort] = useState<{ key: ColumnKey; desc: boolean }>({ key: 'last', desc: true })
  const [selected, setSelected] = useState<CourseRow | null>(null)
  // Fixed for the page's lifetime so the periods do not shift while it is open.
  const [now] = useState(() => Date.now())

  useEffect(() => {
    Promise.all([
      api.listCourses(),
      api.listPosts(new Date(now - HISTORY_MS).toISOString(), new Date(now + DAY_MS).toISOString()),
    ])
      .then(([courseRes, postRes]) => {
        setCourses(courseRes.items)
        setPosts(postRes.items)
      })
      .catch((e) => setError(e instanceof Error ? e.message : t('common.loadFailed')))
    // An extra: without it the People column stays empty.
    api
      .listPeople()
      .then((res) => setPeople(res.items))
      .catch(() => undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Teachers first, as the API orders them within a course ("student" < "teacher").
  const peopleOf = (courseId: string) =>
    people.filter((p) => p.course_id === courseId).sort((a, b) => b.role.localeCompare(a.role))

  const { rows, kpis } = useMemo(() => {
    const { start, prevStart } = periodBounds(period, now)
    const timed = posts.map((p) => ({ ...p, at: new Date(p.time).getTime() }))
    const current = timed.filter((p) => p.at >= start)
    const previous = timed.filter((p) => p.at >= prevStart && p.at < start)
    // Course weekdays are 1 (Mon) … 7 (Sun); getDay() is 0 (Sun) … 6 (Sat).
    const todayWeek = new Date(now).getDay() || 7

    const rows: CourseRow[] = courses.map((course) => {
      const mine = current.filter((p) => p.course_id === course.id)
      const all = timed.filter((p) => p.course_id === course.id)
      const last = all.length ? Math.max(...all.map((p) => p.at)) : null
      return {
        course,
        updates: mine.length,
        announcements: mine.filter((p) => p.type === 'announcement').length,
        coursework: mine.filter((p) => p.type === 'coursework').length,
        materials: mine.filter((p) => p.type === 'material').length,
        last,
        status: course.week === todayWeek ? 'today' : mine.length ? 'active' : 'quiet',
        recent: all.sort((a, b) => b.at - a.at).slice(0, 8),
      }
    })

    const bucket = (at: number) =>
      Math.min(SPARK_POINTS - 1, Math.floor(((at - start) / (now - start)) * SPARK_POINTS))
    const series = (items: typeof current) => {
      const points = Array<number>(SPARK_POINTS).fill(0)
      items.forEach((p) => (points[bucket(p.at)] += 1))
      return points
    }
    const activeSeries = Array.from({ length: SPARK_POINTS }, (_, i) =>
      new Set(current.filter((p) => bucket(p.at) === i).map((p) => p.course_id)).size
    )
    const ofType = (items: typeof current, type: Post['type']) => items.filter((p) => p.type === type)
    const typed = (label: string, icon: LucideIcon, type: Post['type']): Kpi => ({
      label,
      icon,
      value: ofType(current, type).length,
      delta: change(ofType(current, type).length, ofType(previous, type).length),
      points: series(ofType(current, type)),
    })
    const kpis: Kpi[] = [
      {
        label: 'courses.activeCourses',
        icon: BookOpen,
        value: new Set(current.map((p) => p.course_id)).size,
        delta: change(
          new Set(current.map((p) => p.course_id)).size,
          new Set(previous.map((p) => p.course_id)).size
        ),
        points: activeSeries,
      },
      typed('courses.announcements', Megaphone, 'announcement'),
      typed('courses.coursework', ClipboardList, 'coursework'),
      typed('courses.materials', FileText, 'material'),
    ]
    return { rows, kpis }
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
      .filter((row) => tab === 'all' || row.status === tab)
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

  const sync = async () => {
    setSyncing(true)
    try {
      await api.triggerSync()
      useSyncStatusStore.getState().startPolling()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('sync.syncFailed'))
    } finally {
      setSyncing(false)
    }
  }

  const shown = COLUMNS.filter((column) => !hidden.includes(column.key))
  const lastUpdate = (row: CourseRow) =>
    row.last
      ? new Date(row.last).toLocaleDateString(i18n.language, { year: 'numeric', month: 'short', day: '2-digit' })
      : t('common.dash')

  const cell = (row: CourseRow, key: ColumnKey) => {
    switch (key) {
      case 'day':
        return weekdayLabel(row.course.week, i18n.language) ?? t('common.dash')
      case 'name':
        return (
          <Tooltip>
            <TooltipTrigger asChild>
              <Link
                to='/courses/$courseId'
                params={{ courseId: row.course.id }}
                className='flex min-w-0 items-center gap-3 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring'
              >
                <span className='min-w-0'>
                  <span className='block truncate font-medium'>{row.course.name}</span>
                  <span className='block truncate text-xs text-muted-foreground'>
                    {row.course.section || t('common.dash')}
                  </span>
                </span>
              </Link>
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
        return <span className='tabular-nums'>{row.updates}</span>
      case 'coursework':
        return <span className='tabular-nums'>{row.coursework}</span>
      case 'status':
        return <StatusBadge status={row.status} />
      case 'last':
        return (
          <span title={row.last ? fullTimestamp(new Date(row.last).toISOString()) || undefined : undefined}>
            {lastUpdate(row)}
          </span>
        )
    }
  }

  const rowMenu = (row: CourseRow) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant='ghost' size='icon' className='size-8' aria-label={t('courses.rowActions', { name: row.course.name })}>
          <MoreHorizontal aria-hidden='true' />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end'>
        <DropdownMenuItem onSelect={() => setSelected(row)}>{t('courses.viewDetails')}</DropdownMenuItem>
        {(['stream', 'classwork', 'people'] as const).map((page) => (
          <DropdownMenuItem key={page} asChild>
            <Link to={`/courses/$courseId/${page}`} params={{ courseId: row.course.id }}>
              {t(`courses.${page}`)}
            </Link>
          </DropdownMenuItem>
        ))}
        {row.course.alternate_link && (
          <DropdownMenuItem asChild>
            <a href={row.course.alternate_link} target='_blank' rel='noreferrer'>
              {t('courses.openInClassroom')}
            </a>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )

  const tabs: { key: StatusTab; label: string }[] = [
    { key: 'all', label: 'courses.allCourses' },
    { key: 'today', label: 'courses.statusName.today' },
    { key: 'active', label: 'courses.statusName.active' },
  ]

  return (
    <>
      <ClassroomHeader fixed />
      <Main fluid className='flex flex-1 flex-col gap-6'>
        <div className='flex flex-col gap-4 md:flex-row md:items-start md:justify-between'>
          <div>
            <h1 className='text-3xl font-medium tracking-tight'>{t('courses.title')}</h1>
            <p className='mt-1 text-sm text-muted-foreground'>{t('courses.desc')}</p>
          </div>
          {canSync && (
            <Button onClick={() => void sync()} disabled={syncing} className='w-full md:w-auto'>
              <RefreshCw className={cn(syncing && 'animate-spin')} aria-hidden='true' />
              {t('sync.syncNow')}
            </Button>
          )}
        </div>

        {error && (
          <p role='alert' className='text-sm text-destructive'>
            {error}
          </p>
        )}

        {/* KPI row: one bordered strip when the content area is wide, a card grid
            otherwise. Sized by the container: the sidebar takes part of the viewport. */}
        <div className='@container'>
        <div className='hidden overflow-hidden rounded-lg border @5xl:grid @5xl:grid-cols-4'>
          {kpis.map((kpi, i) => (
            <div
              key={kpi.label}
              className={cn('flex min-h-28 items-end justify-between gap-3 p-5', i < kpis.length - 1 && 'border-r')}
            >
              <KpiBody kpi={kpi} />
            </div>
          ))}
        </div>
        <div className='grid grid-cols-2 gap-3 @2xl:grid-cols-4 @5xl:hidden'>
          {kpis.map((kpi) => (
            <div key={kpi.label} className='rounded-lg border p-4'>
              <KpiBody kpi={kpi} compact />
            </div>
          ))}
        </div>
        </div>

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
                  <th scope='col' className='w-12'>
                    <span className='sr-only'>{t('common.actions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => (
                  <tr key={row.course.id} className='border-b transition-colors hover:bg-muted/40'>
                    {shown.map(({ key }) => (
                      <td key={key} className={cn('h-14 px-2 first:ps-3', key === 'name' && 'max-w-80')}>
                        {cell(row, key)}
                      </td>
                    ))}
                    <td className='px-2 text-end'>{rowMenu(row)}</td>
                  </tr>
                ))}
                {!visible.length && (
                  <tr>
                    <td colSpan={shown.length + 1} className='h-24 text-center text-muted-foreground'>
                      {courses.length ? t('courses.noMatch') : t('courses.noCourses')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Below md: one card per course. */}
          <ul className='flex flex-col gap-3 md:hidden'>
            {visible.map((row) => (
              <li key={row.course.id} className='rounded-lg border p-4'>
                <div className='flex items-center justify-between'>
                  <span className='text-xs text-muted-foreground tabular-nums'>{row.course.id}</span>
                  {rowMenu(row)}
                </div>
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
                {courses.length ? t('courses.noMatch') : t('courses.noCourses')}
              </li>
            )}
          </ul>
        </div>
      </Main>

      <CourseSheet
        row={selected}
        periodLabel={t(period === 'year' ? 'courses.thisYear' : `courses.last${period}`)}
        relative={(time) => humanReadableTime(time, t('common.dash'))}
        onClose={() => setSelected(null)}
      />
    </>
  )
}
