import { useEffect, useMemo, useRef, useState } from 'react'
import { ExternalLink, ClipboardList } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Main } from '@/components/layout/main'
import { api, type Course, type TodoItem } from '@/lib/api'
import { ClassroomHeader } from './layout-header'

const PAGE_SIZE = 10

const NOT_TURNED_IN = new Set(['new', 'created'])
const TURNED_IN = new Set(['turned_in', 'returned', 'reclaimed_by_student'])

type ColumnKey = 'missing' | 'todo' | 'submitted'

function isMissing(item: TodoItem): boolean {
  if (!item.due_date) return false
  const today = new Date().toISOString().slice(0, 10)
  return NOT_TURNED_IN.has((item.status || '').toLowerCase()) && item.due_date < today
}

// Which Kanban column an item belongs to.
function columnOf(item: TodoItem): ColumnKey {
  const s = (item.status || '').toLowerCase()
  if (TURNED_IN.has(s)) return 'submitted'
  if (isMissing(item)) return 'missing'
  return 'todo'
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

const COLUMNS: { key: ColumnKey; label: string; dotClass: string }[] = [
  { key: 'missing', label: 'Missing', dotClass: 'bg-destructive' },
  { key: 'todo', label: 'To do', dotClass: 'bg-amber-500' },
  { key: 'submitted', label: 'Submitted', dotClass: 'bg-emerald-500' },
]

function TodoCard({
  item,
  courseName,
}: {
  item: TodoItem
  courseName: string
}) {
  return (
    <div className='flex flex-col gap-2 rounded-md border bg-card p-3 shadow-sm'>
      <p className='text-sm font-medium leading-snug'>{item.title || '—'}</p>
      <p className='truncate text-xs text-muted-foreground'>{courseName}</p>
      <div className='flex items-center justify-between gap-2'>
        <Badge variant={statusVariant(item)} className='text-[11px]'>
          {statusLabel(item.status)}
        </Badge>
        {item.course_work_link && (
          <Button variant='ghost' size='sm' className='h-7 shrink-0 px-2' asChild>
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
      {item.due_date && (
        <p className={cn('text-xs', dueDateClass(item))}>
          Due {formatDueDate(item.due_date)}
          {isMissing(item) && <span className='ml-1 font-semibold'>· Missing</span>}
        </p>
      )}
    </div>
  )
}

function KanbanColumn({
  label,
  dotClass,
  items,
  courseMap,
}: {
  label: string
  dotClass: string
  items: TodoItem[]
  courseMap: Record<string, string>
}) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [loadingMore, setLoadingMore] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)

  // Reset progressive reveal whenever the column's data changes.
  useEffect(() => {
    setVisibleCount(PAGE_SIZE)
  }, [items])

  const hasMore = items.length > visibleCount
  const shown = items.slice(0, visibleCount)

  // Infinite scroll within this column. The observer root is the column's own
  // scroll container so it fires as the user scrolls inside the column, not the
  // page. A short delay simulates an async fetch so the skeleton is visible.
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
      { root: rootRef.current, threshold: 0.1 }
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasMore, loadingMore])

  return (
    <div className='flex max-h-[75vh] flex-col rounded-lg border bg-muted/30'>
      <div className='flex items-center gap-2 border-b px-3 py-2.5'>
        <span className={cn('size-2 rounded-full', dotClass)} />
        <h3 className='text-sm font-semibold'>{label}</h3>
        <span className='ml-auto rounded bg-background px-1.5 text-xs tabular-nums text-muted-foreground'>
          {items.length}
        </span>
      </div>
      <div ref={rootRef} className='flex-1 overflow-y-auto'>
        <div className='flex flex-col gap-2 p-3'>
          {items.length === 0 ? (
            <p className='px-1 py-6 text-center text-xs text-muted-foreground'>
              Nothing here.
            </p>
          ) : (
            shown.map((item) => (
              <TodoCard
                key={item.item_id}
                item={item}
                courseName={courseMap[item.course_id] || item.course_id}
              />
            ))
          )}
          {loadingMore &&
            [...Array(2)].map((_, i) => (
              <Skeleton key={i} className='h-20 w-full rounded-md' />
            ))}
          {hasMore && <div ref={sentinelRef} className='h-1' />}
        </div>
      </div>
    </div>
  )
}

export function TodoPage() {
  const [items, setItems] = useState<TodoItem[]>([])
  const [courses, setCourses] = useState<Course[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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

  const courseMap = useMemo(
    () => Object.fromEntries(courses.map((c) => [c.id, c.name])),
    [courses]
  )

  // Bucket every item into its Kanban column.
  const board = useMemo(() => {
    const map: Record<ColumnKey, TodoItem[]> = { missing: [], todo: [], submitted: [] }
    for (const item of items) map[columnOf(item)].push(item)
    return map
  }, [items])

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

        {error && <p className='text-destructive text-sm'>{error}</p>}

        {loading ? (
          <div className='grid gap-4 md:grid-cols-3'>
            {COLUMNS.map((col) => (
              <div key={col.key} className='flex flex-col gap-3 rounded-lg border bg-muted/30 p-3'>
                <Skeleton className='h-5 w-24' />
                {[...Array(3)].map((_, i) => (
                  <Skeleton key={i} className='h-20 w-full rounded-md' />
                ))}
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className='flex flex-col items-center gap-3 py-16 text-center'>
            <ClipboardList className='size-10 text-muted-foreground' />
            <p className='text-muted-foreground text-sm'>
              No to-do items in cache. Run a sync first.
            </p>
          </div>
        ) : (
          <div className='grid gap-4 md:grid-cols-3'>
            {COLUMNS.map((col) => (
              <KanbanColumn
                key={col.key}
                label={col.label}
                dotClass={col.dotClass}
                items={board[col.key]}
                courseMap={courseMap}
              />
            ))}
          </div>
        )}
      </Main>
    </>
  )
}
