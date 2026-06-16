import { useEffect, useMemo, useRef, useState } from 'react'
import { ExternalLink, ClipboardList } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Main } from '@/components/layout/main'
import { api, type Course, type TodoItem } from '@/lib/api'
import { ClassroomHeader } from './layout-header'

type FilterTab = 'all' | 'missing' | 'not_turned_in' | 'turned_in'

const NOT_TURNED_IN = new Set(['new', 'created'])
const TURNED_IN = new Set(['turned_in', 'returned', 'reclaimed_by_student'])

function isMissing(item: TodoItem): boolean {
  if (!item.due_date) return false
  const today = new Date().toISOString().slice(0, 10)
  return NOT_TURNED_IN.has((item.status || '').toLowerCase()) && item.due_date < today
}

function statusVariant(item: TodoItem): 'secondary' | 'destructive' | 'outline' | 'default' {
  const s = (item.status || '').toLowerCase()
  if (isMissing(item)) return 'destructive'
  if (TURNED_IN.has(s)) return 'default'
  return 'secondary'
}

function formatDueDate(due: string | null | undefined): string | null {
  if (!due) return null
  const d = new Date(due)
  if (isNaN(d.getTime())) return due
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function dueDateClass(item: TodoItem): string {
  if (isMissing(item)) return 'text-destructive'
  return 'text-muted-foreground'
}

function statusLabel(status: string | null | undefined): string {
  switch ((status || '').toLowerCase()) {
    case 'new': return 'New'
    case 'created': return 'Not submitted'
    case 'turned_in': return 'Submitted'
    case 'returned': return 'Returned'
    case 'reclaimed_by_student': return 'Unsubmitted'
    default: return status || '—'
  }
}

const TABS: { value: FilterTab; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'missing', label: 'Missing' },
  { value: 'not_turned_in', label: 'Not submitted' },
  { value: 'turned_in', label: 'Submitted' },
]

const PAGE_SIZE = 10

function ItemRowSkeleton() {
  return (
    <div className='flex items-center gap-3 px-4 py-3'>
      <div className='min-w-0 flex-1 space-y-1.5'>
        <Skeleton className='h-4 w-2/3' />
        <Skeleton className='h-3 w-1/3' />
      </div>
      <Skeleton className='h-5 w-16 shrink-0 rounded-full' />
      <Skeleton className='size-7 shrink-0 rounded-md' />
    </div>
  )
}

export function TodoPage() {
  const [items, setItems] = useState<TodoItem[]>([])
  const [courses, setCourses] = useState<Course[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<FilterTab>('all')
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [loadingMore, setLoadingMore] = useState(false)
  const sentinelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setLoading(true)
    Promise.all([api.listTodos(), api.listCourses()])
      .then(([todosRes, coursesRes]) => {
        setItems(todosRes.items)
        setCourses(coursesRes.items)
        setError(null)
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false))
  }, [])

  // Reset progressive reveal whenever the active tab changes.
  useEffect(() => {
    setVisibleCount(PAGE_SIZE)
  }, [tab])

  const courseMap = useMemo(
    () => Object.fromEntries(courses.map((c) => [c.id, c.name])),
    [courses]
  )

  const filtered = useMemo(() => {
    if (tab === 'missing') return items.filter(isMissing)
    if (tab === 'not_turned_in')
      return items.filter((it) => NOT_TURNED_IN.has((it.status || '').toLowerCase()))
    if (tab === 'turned_in')
      return items.filter((it) => TURNED_IN.has((it.status || '').toLowerCase()))
    return items
  }, [items, tab])

  const visibleItems = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount])
  const hasMore = filtered.length > visibleCount

  // Group by course_id, preserve insertion order
  const grouped = useMemo(() => {
    const map = new Map<string, TodoItem[]>()
    for (const item of visibleItems) {
      const arr = map.get(item.course_id) || []
      arr.push(item)
      map.set(item.course_id, arr)
    }
    return map
  }, [visibleItems])

  // Infinite scroll: reveal the next page once the sentinel enters the
  // viewport. The slight delay simulates an async fetch so the skeleton
  // screen is visible instead of an instant pop-in.
  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel || !hasMore) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !loadingMore) {
          setLoadingMore(true)
          setTimeout(() => {
            setVisibleCount((c) => c + PAGE_SIZE)
            setLoadingMore(false)
          }, 400)
        }
      },
      { threshold: 0.1 }
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasMore, loadingMore])

  const counts = useMemo(() => ({
    all: items.length,
    missing: items.filter(isMissing).length,
    not_turned_in: items.filter((it) => NOT_TURNED_IN.has((it.status || '').toLowerCase())).length,
    turned_in: items.filter((it) => TURNED_IN.has((it.status || '').toLowerCase())).length,
  }), [items])

  return (
    <>
      <ClassroomHeader fixed />
      <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>
        <div>
          <h2 className='text-2xl font-bold tracking-tight'>To-do</h2>
          <p className='text-muted-foreground'>
            Assignments across all courses (from local cache)
          </p>
        </div>

        {error && (
          <p className='text-destructive text-sm'>{error}</p>
        )}

        <Tabs value={tab} onValueChange={(v) => setTab(v as FilterTab)}>
          <TabsList>
            {TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>
                {t.label}
                {!loading && counts[t.value] > 0 && (
                  <span className='ml-1.5 rounded bg-background/60 px-1 text-[10px] tabular-nums'>
                    {counts[t.value]}
                  </span>
                )}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {loading ? (
          <div className='space-y-3'>
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className='h-12 w-full rounded-md' />
            ))}
          </div>
        ) : grouped.size === 0 ? (
          <div className='flex flex-col items-center gap-3 py-16 text-center'>
            <ClipboardList className='size-10 text-muted-foreground' />
            <p className='text-muted-foreground text-sm'>
              {tab === 'missing' && 'No missing assignments.'}
              {tab === 'not_turned_in' && 'No unsubmitted assignments.'}
              {tab === 'turned_in' && 'No submitted assignments in cache.'}
              {tab === 'all' && 'No to-do items in cache. Run a sync first.'}
            </p>
          </div>
        ) : (
          <div className='space-y-6'>
            {[...grouped.entries()].map(([courseId, courseItems], groupIdx) => (
              <div key={courseId}>
                {groupIdx > 0 && <Separator className='mb-6' />}
                <h3 className='mb-3 text-sm font-semibold'>
                  {courseMap[courseId] || courseId}
                  <span className='text-muted-foreground ml-2 font-normal'>
                    ({courseItems.length})
                  </span>
                </h3>
                <div className='overflow-hidden rounded-md border'>
                  {courseItems.map((item, idx) => (
                    <div key={item.item_id}>
                      {idx > 0 && <Separator />}
                      <div className='flex items-center gap-3 px-4 py-3'>
                        <div className='min-w-0 flex-1'>
                          <p className='truncate text-sm font-medium'>
                            {item.title || '—'}
                          </p>
                          {item.due_date && (
                            <p className={`mt-0.5 text-xs ${dueDateClass(item)}`}>
                              Due {formatDueDate(item.due_date)}
                              {isMissing(item) && (
                                <span className='ml-1 font-semibold'>· Missing</span>
                              )}
                            </p>
                          )}
                        </div>
                        <Badge variant={statusVariant(item)} className='shrink-0 text-[11px]'>
                          {statusLabel(item.status)}
                        </Badge>
                        {item.course_work_link && (
                          <Button
                            variant='ghost'
                            size='sm'
                            className='h-7 shrink-0 px-2'
                            asChild
                          >
                            <a
                              href={item.course_work_link}
                              target='_blank'
                              rel='noreferrer'
                              title='Open in Google Classroom'
                            >
                              <ExternalLink className='size-3.5' />
                            </a>
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {loadingMore && (
              <div className='overflow-hidden rounded-md border'>
                {[...Array(3)].map((_, i) => (
                  <div key={i}>
                    {i > 0 && <Separator />}
                    <ItemRowSkeleton />
                  </div>
                ))}
              </div>
            )}

            {hasMore && <div ref={sentinelRef} className='h-1' />}

            {!hasMore && filtered.length > PAGE_SIZE && (
              <p className='text-muted-foreground text-center text-xs'>
                Showing all {filtered.length} items
              </p>
            )}
          </div>
        )}
      </Main>
    </>
  )
}
