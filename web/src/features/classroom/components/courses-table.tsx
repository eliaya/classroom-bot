import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  type Cell,
  type ColumnOrderState,
  type Header,
  type SortingState,
  type VisibilityState,
  flexRender,
  getCoreRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table'
import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { restrictToHorizontalAxis } from '@dnd-kit/modifiers'
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { animate } from 'animejs'
import { BookOpen, GripVertical, Radio, Users } from 'lucide-react'
import { cn } from '@/lib/utils'
import { type NavigateFn, useTableUrlState } from '@/hooks/use-table-url-state'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { DataTableToolbar } from '@/components/data-table'
import {
  api,
  type ClassworkItem,
  type ClassworkResponse,
  type Course,
  type StreamItem,
} from '@/lib/api'
import { coursesColumns } from './courses-columns'
import { AttachmentView } from './attachment-view'

// ─── Types ───────────────────────────────────────────────────────────────────

type SectionKey = 'classwork' | 'stream' | 'people'
type UnifiedCW = ClassworkItem & { _kind: 'coursework' | 'material' }
type PersonItem = {
  user_id: string
  role: string
  full_name?: string | null
  email?: string | null
}

// ─── Constants ───────────────────────────────────────────────────────────────

type SectionDef = {
  key: SectionKey
  label: string
  Icon: React.ComponentType<{ className?: string }>
}
const SECTION_NAV: SectionDef[] = [
  { key: 'classwork', label: 'Classwork', Icon: BookOpen },
  { key: 'stream',    label: 'Stream',    Icon: Radio },
  { key: 'people',    label: 'People',    Icon: Users },
]

const COLUMN_VISIBILITY_KEY = 'courses-table:column-visibility'
const DEFAULT_COLUMN_VISIBILITY: VisibilityState = {}

function loadColumnVisibility(): VisibilityState {
  if (typeof window === 'undefined') return DEFAULT_COLUMN_VISIBILITY
  try {
    const raw = window.localStorage.getItem(COLUMN_VISIBILITY_KEY)
    if (raw) return JSON.parse(raw) as VisibilityState
  } catch { /* ignore */ }
  return DEFAULT_COLUMN_VISIBILITY
}

const COLUMN_ORDER_KEY = 'courses-table:column-order'

function loadColumnOrder(): ColumnOrderState {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(COLUMN_ORDER_KEY)
    if (raw) return JSON.parse(raw) as ColumnOrderState
  } catch { /* ignore */ }
  return []
}

const SORTING_KEY = 'courses-table:sorting'

function loadSorting(): SortingState {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(SORTING_KEY)
    if (raw) return JSON.parse(raw) as SortingState
  } catch { /* ignore */ }
  return []
}

// ─── Draggable header + drag-along body cell (column reordering) ──────────────

function DraggableHeader({ header }: { header: Header<Course, unknown> }) {
  const { attributes, isDragging, listeners, setNodeRef, transform } = useSortable({
    id: header.column.id,
  })
  const style: React.CSSProperties = {
    opacity: isDragging ? 0.8 : 1,
    position: 'relative',
    transform: CSS.Translate.toString(transform),
    transition: 'transform 0.2s ease-in-out',
    whiteSpace: 'nowrap',
    zIndex: isDragging ? 1 : 0,
  }
  const hasTitle = header.column.columnDef.header != null
  return (
    <TableHead
      ref={setNodeRef}
      colSpan={header.colSpan}
      style={style}
      className={cn(header.column.columnDef.meta?.className)}
    >
      <div className='flex items-center gap-1'>
        {hasTitle && !header.isPlaceholder && (
          <button
            type='button'
            aria-label='Drag to reorder column'
            className='cursor-grab touch-none text-muted-foreground/40 transition-colors hover:text-foreground'
            {...attributes}
            {...listeners}
          >
            <GripVertical className='size-3.5' />
          </button>
        )}
        {header.isPlaceholder
          ? null
          : flexRender(header.column.columnDef.header, header.getContext())}
      </div>
    </TableHead>
  )
}

function DragAlongCell({
  cell,
  onClick,
}: {
  cell: Cell<Course, unknown>
  onClick?: () => void
}) {
  const { isDragging, setNodeRef, transform } = useSortable({ id: cell.column.id })
  const style: React.CSSProperties = {
    opacity: isDragging ? 0.8 : 1,
    position: 'relative',
    transform: CSS.Translate.toString(transform),
    transition: 'transform 0.2s ease-in-out',
    zIndex: isDragging ? 1 : 0,
  }
  return (
    <TableCell
      ref={setNodeRef}
      style={style}
      className={cn(cell.column.columnDef.meta?.className)}
      onClick={onClick}
    >
      {flexRender(cell.column.columnDef.cell, cell.getContext())}
    </TableCell>
  )
}


// ─── CoursesTable (main export) ───────────────────────────────────────────────

type CoursesTableProps = {
  data: Course[]
  search: Record<string, unknown>
  navigate: NavigateFn
  selectedCourse: Course | null
  onSelectCourse: (course: Course | null) => void
}

export function CoursesTable({ data, search, navigate, selectedCourse, onSelectCourse }: CoursesTableProps) {
  const [rowSelection, setRowSelection] = useState({})
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(loadColumnVisibility)
  const [sorting, setSorting] = useState<SortingState>(loadSorting)
  const [visibleCount, setVisibleCount] = useState(10)
  const sentinelRef = useRef<HTMLDivElement>(null)

  // Today's weekday (1=Mon … 7=Sun) from server time, to highlight matching rows.
  const [todayWeek, setTodayWeek] = useState<number | null>(null)
  useEffect(() => {
    api
      .serverTime()
      .then((r) => setTodayWeek(r.weekday))
      .catch(() => setTodayWeek(null))
  }, [])

  const columns = useMemo(() => coursesColumns(onSelectCourse), [onSelectCourse])

  // Resolved id of every column, in their definition order.
  const defaultColumnOrder = useMemo<ColumnOrderState>(
    () =>
      columns.map(
        (c) => ((c as { id?: string }).id ?? (c as { accessorKey?: string }).accessorKey) as string
      ),
    [columns]
  )

  // Restore a saved order, dropping stale ids and appending any new columns.
  const [columnOrder, setColumnOrder] = useState<ColumnOrderState>(() => {
    const stored = loadColumnOrder()
    if (!stored.length) return defaultColumnOrder
    const valid = stored.filter((id) => defaultColumnOrder.includes(id))
    const missing = defaultColumnOrder.filter((id) => !valid.includes(id))
    return [...valid, ...missing]
  })

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } }),
    useSensor(KeyboardSensor)
  )

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    setColumnOrder((order) => {
      const from = order.indexOf(active.id as string)
      const to = order.indexOf(over.id as string)
      return from < 0 || to < 0 ? order : arrayMove(order, from, to)
    })
  }, [])

  useEffect(() => {
    try {
      window.localStorage.setItem(COLUMN_VISIBILITY_KEY, JSON.stringify(columnVisibility))
    } catch { /* ignore */ }
  }, [columnVisibility])

  useEffect(() => {
    try {
      window.localStorage.setItem(COLUMN_ORDER_KEY, JSON.stringify(columnOrder))
    } catch { /* ignore */ }
  }, [columnOrder])

  useEffect(() => {
    try {
      window.localStorage.setItem(SORTING_KEY, JSON.stringify(sorting))
    } catch { /* ignore */ }
  }, [sorting])

  const { columnFilters, onColumnFiltersChange } = useTableUrlState({
    search,
    navigate,
    globalFilter: { enabled: false },
    columnFilters: [{ columnId: 'name', searchKey: 'name', type: 'string' }],
  })

  useEffect(() => { setVisibleCount(10) }, [columnFilters])

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return
    const observer = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting) setVisibleCount((c) => c + 10) },
      { threshold: 0.1 }
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [])

  // When the split-screen detail panel is open, keep only Course name + Week.
  const effectiveColumnVisibility: VisibilityState = selectedCourse
    ? { section: false, state: false, synced_at: false, actions: false }
    : columnVisibility

  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data,
    columns,
    state: { sorting, rowSelection, columnFilters, columnVisibility: effectiveColumnVisibility, columnOrder },
    onColumnFiltersChange,
    onRowSelectionChange: setRowSelection,
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    onColumnOrderChange: setColumnOrder,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
  })

  const allRows = table.getRowModel().rows
  const visibleRows = allRows.slice(0, visibleCount)

  return (
    <div className='flex flex-col gap-4'>
      <DataTableToolbar table={table} searchPlaceholder='Filter courses…' searchKey='name' />
      <div className='flex flex-col gap-3 lg:flex-row lg:items-start'>
        <div className={cn('overflow-hidden rounded-md border transition-[width] duration-300 ease-out', selectedCourse ? 'lg:w-[30%]' : 'w-full')}>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToHorizontalAxis]}
            onDragEnd={handleDragEnd}
          >
            <Table>
              <TableHeader>
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow key={headerGroup.id}>
                    <SortableContext
                      items={columnOrder}
                      strategy={horizontalListSortingStrategy}
                    >
                      {headerGroup.headers.map((header) => (
                        <DraggableHeader key={header.id} header={header} />
                      ))}
                    </SortableContext>
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {visibleRows.length ? (
                  visibleRows.map((row) => {
                    const isSelected = selectedCourse?.id === row.original.id
                    // todayWeek is always 1-7 (server isoweekday), so その他 (8)
                    // can never match — no extra guard needed.
                    const isToday =
                      todayWeek != null && row.original.week === todayWeek
                    return (
                      <TableRow
                        key={row.id}
                        data-state={isSelected ? 'selected' : undefined}
                        className={cn(
                          'cursor-pointer',
                          // Amber highlight — subtle enough to keep text readable
                          // in both light and dark themes.
                          isToday &&
                            'bg-amber-200/50 hover:bg-amber-200/70 dark:bg-amber-400/15 dark:hover:bg-amber-400/25'
                        )}
                      >
                        {row.getVisibleCells().map((cell) => (
                          <SortableContext
                            key={cell.id}
                            items={columnOrder}
                            strategy={horizontalListSortingStrategy}
                          >
                            <DragAlongCell
                              cell={cell}
                              onClick={() =>
                                onSelectCourse(isSelected ? null : row.original)
                              }
                            />
                          </SortableContext>
                        ))}
                      </TableRow>
                    )
                  })
                ) : (
                  <TableRow>
                    <TableCell colSpan={columns.length} className='h-24 text-center'>
                      No courses in cache. Run a sync first.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </DndContext>
        </div>

        {selectedCourse && (
          <CourseDetail
            course={selectedCourse}
            onClose={() => onSelectCourse(null)}
          />
        )}
      </div>
      <div ref={sentinelRef} className='h-1' />
      {allRows.length > visibleCount && (
        <p className='text-center text-xs text-muted-foreground'>
          Showing {visibleCount} of {allRows.length} courses
        </p>
      )}
    </div>
  )
}

// ─── CourseNavSidebar ─────────────────────────────────────────────────────────

// ─── InlineClasswork ──────────────────────────────────────────────────────────

function InlineClasswork({
  courseId,
  onCountChange,
}: {
  courseId: string
  onCountChange?: (count: number) => void
}) {
  const [data, setData] = useState<ClassworkResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [visibleCount, setVisibleCount] = useState(10)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const PAGE_SIZE = 10

  useEffect(() => {
    setLoading(true)
    setVisibleCount(10)
    api
      .getClasswork(courseId)
      .then((d) => { setData(d); setError(null) })
      .catch((e) => setError(e instanceof Error ? e.message : 'Load failed'))
      .finally(() => setLoading(false))
  }, [courseId])

  const items = useMemo<UnifiedCW[]>(() => {
    if (!data) return []
    const cw = (data.coursework || []).map((c) => ({ ...c, _kind: 'coursework' as const }))
    const mat = (data.materials || []).map((m) => ({ ...m, _kind: 'material' as const }))
    return [...cw, ...mat].sort((a, b) =>
      String(b.update_time || '').localeCompare(String(a.update_time || ''))
    )
  }, [data])

  useEffect(() => {
    if (!loading) onCountChange?.(items.length)
  }, [loading, items.length, onCountChange])

  // Infinite scroll (client-side progressive reveal after initial async load)
  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && visibleCount < items.length && !isLoadingMore) {
          setIsLoadingMore(true)
          // Simulate async load of next batch
          setTimeout(() => {
            setVisibleCount((c) => Math.min(c + PAGE_SIZE, items.length))
            setIsLoadingMore(false)
          }, 250)
        }
      },
      { threshold: 0.1 }
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [visibleCount, items.length, isLoadingMore])

  return (
    <>
      {loading ? (
        <div className='flex flex-col gap-2 p-4'>
          {[...Array(6)].map((_, i) => <Skeleton key={i} className='h-12 w-full rounded-md' />)}
        </div>
      ) : error ? (
        <p className='p-4 text-sm text-destructive'>{error}</p>
      ) : items.length === 0 ? (
        <p className='p-4 text-sm text-muted-foreground'>No classwork in cache. Run a sync.</p>
      ) : (
        <ScrollArea className='flex-1 min-h-0'>
          <div>
            {items.slice(0, visibleCount).map((item, idx) => {
              const attCount = item.attachments?.length ?? 0
              const isMaterial = item._kind === 'material'
              const typeLabel = isMaterial ? 'Attachment' : String(item.work_type || 'Coursework')
              const dateStr = item.update_time ? String(item.update_time).slice(0, 10) : ''
              const description = String(item.description || '').trim()
              return (
                <div key={`${item._kind}-${String(item.id)}`}>
                  {idx > 0 && <Separator />}
                  <div className='px-4 py-4 text-left'>
                    <p className='truncate text-sm font-medium leading-snug'>
                      {String(item.title || '—')}
                    </p>

                    {/* $type, $date, $file-counts as labels BELOW title (label style) */}
                    <div className='mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground'>
                      <span className='rounded bg-muted px-1.5 py-0.5'>{typeLabel}</span>
                      {dateStr && <span className='rounded bg-muted px-1.5 py-0.5'>{dateStr}</span>}
                      {attCount > 0 && <span className='rounded bg-muted px-1.5 py-0.5'>{attCount} files</span>}
                    </div>

                    {/* Attachments — same rich design as the Classwork page
                        (icon + label + source badge + Open/Download links). */}
                    {attCount > 0 && (
                      <div className='mt-2 flex flex-col gap-2'>
                        {item.attachments?.map((att, i) => (
                          <AttachmentView key={att.id ?? i} att={att} />
                        ))}
                      </div>
                    )}

                    {/* Description (plain, no accordion) */}
                    {description && (
                      <p className='mt-2 text-sm text-foreground whitespace-pre-wrap'>
                        {description}
                      </p>
                    )}
                  </div>
                </div>
              )
            })}

            {visibleCount < items.length && <div ref={sentinelRef} className='h-1' />}
            {isLoadingMore && (
              <div className='px-4 py-2'>
                {[...Array(2)].map((_, i) => (
                  <Skeleton key={i} className='my-1 h-10 w-full rounded-md' />
                ))}
              </div>
            )}
          </div>
        </ScrollArea>
      )}
    </>
  )
}

// ─── InlineStream ─────────────────────────────────────────────────────────────

function InlineStream({
  courseId,
  onCountChange,
}: {
  courseId: string
  onCountChange?: (count: number) => void
}) {
  const [data, setData] = useState<{ items: StreamItem[] } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [visibleCount, setVisibleCount] = useState(10)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const PAGE_SIZE = 10

  useEffect(() => {
    setLoading(true)
    setVisibleCount(10)
    api
      .getStream(courseId, 100) // load reasonable amount for client-side infinite; real pagination possible via limit/offset
      .then((r) => { setData({ items: r.items }); setError(null) })
      .catch((e) => setError(e instanceof Error ? e.message : 'Load failed'))
      .finally(() => setLoading(false))
  }, [courseId])

  const items = useMemo<StreamItem[]>(() => data?.items || [], [data])

  useEffect(() => {
    if (!loading) onCountChange?.(items.length)
  }, [loading, items.length, onCountChange])

  // Infinite scroll (client-side progressive reveal after initial async load)
  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && visibleCount < items.length && !isLoadingMore) {
          setIsLoadingMore(true)
          setTimeout(() => {
            setVisibleCount((c) => Math.min(c + PAGE_SIZE, items.length))
            setIsLoadingMore(false)
          }, 250)
        }
      },
      { threshold: 0.1 }
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [visibleCount, items.length, isLoadingMore])

  return (
    <>
      {loading ? (
        <div className='flex flex-col gap-2 p-4'>
          {[...Array(5)].map((_, i) => <Skeleton key={i} className='h-14 w-full rounded-md' />)}
        </div>
      ) : error ? (
        <p className='p-4 text-sm text-destructive'>{error}</p>
      ) : items.length === 0 ? (
        <p className='p-4 text-sm text-muted-foreground'>No stream items in cache.</p>
      ) : (
        <ScrollArea className='flex-1 min-h-0'>
          <div>
            {items.slice(0, visibleCount).map((item, idx) => {
              const typeLabel = item.type === 'announcement' ? 'Announcement' : String(item.work_type || 'Assignment')
              const dateStr = item.update_time ? String(item.update_time).slice(0, 10) : ''
              const description = String(item.text || '').trim()
              return (
                <div key={`${item.type}-${item.id}`}>
                  {idx > 0 && <Separator />}
                  <div className='px-4 py-4 text-left'>
                    <p className='truncate text-sm font-medium leading-snug'>
                      {String(item.title || '—')}
                    </p>

                    {/* $type, $date as labels BELOW title (label style) */}
                    <div className='mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground'>
                      <span className='rounded bg-muted px-1.5 py-0.5'>{typeLabel}</span>
                      {dateStr && <span className='rounded bg-muted px-1.5 py-0.5'>{dateStr}</span>}
                    </div>

                    {/* Description (plain, no accordion) */}
                    {description && (
                      <p className='mt-2 text-sm text-foreground whitespace-pre-wrap'>
                        {description}
                      </p>
                    )}
                  </div>
                </div>
              )
            })}

            {visibleCount < items.length && <div ref={sentinelRef} className='h-1' />}
            {isLoadingMore && (
              <div className='px-4 py-2'>
                {[...Array(2)].map((_, i) => (
                  <Skeleton key={i} className='my-1 h-10 w-full rounded-md' />
                ))}
              </div>
            )}
          </div>
        </ScrollArea>
      )}
    </>
  )
}

// ─── InlinePeople ─────────────────────────────────────────────────────────────

function InlinePeople({
  courseId,
  onCountChange,
}: {
  courseId: string
  onCountChange?: (count: number) => void
}) {
  const [people, setPeople] = useState<PersonItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    api
      .getPeople(courseId)
      .then((r) => { setPeople(r.items); setError(null) })
      .catch((e) => setError(e instanceof Error ? e.message : 'Load failed'))
      .finally(() => setLoading(false))
  }, [courseId])

  useEffect(() => {
    if (!loading) onCountChange?.(people.length)
  }, [loading, people.length, onCountChange])

  const teachers = people.filter((p) => p.role === 'teacher')
  const students = people.filter((p) => p.role === 'student')

  return (
    <>
      {loading ? (
        <div className='flex flex-col gap-2 p-4'>
          {[...Array(4)].map((_, i) => <Skeleton key={i} className='h-10 w-full rounded-md' />)}
        </div>
      ) : error ? (
        <p className='p-4 text-sm text-destructive'>{error}</p>
      ) : people.length === 0 ? (
        <p className='p-4 text-sm text-muted-foreground'>No people in cache.</p>
      ) : (
        <ScrollArea className='flex-1 min-h-0'>
          {teachers.length > 0 && (
            <div className='px-4 pb-1 pt-3'>
              <p className='mb-1.5 text-[11px] font-semibold uppercase text-muted-foreground'>
                Teachers ({teachers.length})
              </p>
              <div className='flex flex-col gap-1'>
                {teachers.map((p) => (
                  <PersonRow key={`${p.user_id}-${p.role}`} person={p} />
                ))}
              </div>
            </div>
          )}
          {teachers.length > 0 && students.length > 0 && <Separator className='my-2' />}
          {students.length > 0 && (
            <div className='px-4 pb-3 pt-1'>
              <p className='mb-1.5 text-[11px] font-semibold uppercase text-muted-foreground'>
                Students ({students.length})
              </p>
              <div className='flex flex-col gap-1'>
                {students.map((p) => (
                  <PersonRow key={`${p.user_id}-${p.role}`} person={p} />
                ))}
              </div>
            </div>
          )}
        </ScrollArea>
      )}
    </>
  )
}

function PersonRow({ person }: { person: PersonItem }) {
  return (
    <div className='flex items-center gap-2 rounded-md px-2 py-1.5'>
      <div className='flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground'>
        {(person.full_name || person.email || '?')[0].toUpperCase()}
      </div>
      <div className='min-w-0'>
        <p className='truncate text-sm font-medium'>{person.full_name || '—'}</p>
        {person.email && (
          <p className='truncate text-[11px] text-muted-foreground'>{person.email}</p>
        )}
      </div>
    </div>
  )
}

// ─── CourseDetail (split mode) ────────────────────────────────────────────────

function CourseDetail({
  course,
  onClose,
}: {
  course: Course
  onClose: () => void
}) {
  const [tab, setTab] = useState<SectionKey>('classwork')
  const [counts, setCounts] = useState<Partial<Record<SectionKey, number>>>({})
  const panelRef = useRef<HTMLDivElement>(null)

  // Slide + fade the detail panel in when it opens or switches course.
  useEffect(() => {
    const el = panelRef.current
    if (!el) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    animate(el, {
      opacity: [0, 1],
      translateX: [36, 0],
      duration: 420,
      ease: 'outExpo',
    })
  }, [course.id])

  const setCount = useCallback((key: SectionKey, n: number) => {
    setCounts((c) => (c[key] === n ? c : { ...c, [key]: n }))
  }, [])
  const onClassworkCount = useCallback((n: number) => setCount('classwork', n), [setCount])
  const onStreamCount = useCallback((n: number) => setCount('stream', n), [setCount])
  const onPeopleCount = useCallback((n: number) => setCount('people', n), [setCount])

  return (
    <div
      ref={panelRef}
      className='flex max-h-[80vh] h-[80vh] flex-col overflow-hidden rounded-md border lg:w-[70%]'
    >
      {/* Header */}
      <div className='flex items-start justify-between gap-2 border-b p-3'>
        <div className='min-w-0'>
          {course.synced_at ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <h3 className='truncate font-medium' title={undefined}>
                  {course.name}
                </h3>
              </TooltipTrigger>
              <TooltipContent>Synced {course.synced_at}</TooltipContent>
            </Tooltip>
          ) : (
            <h3 className='truncate font-medium' title={course.name}>
              {course.name}
            </h3>
          )}
          <div className='text-muted-foreground mt-0.5 flex flex-wrap items-center gap-2 text-xs'>
            {course.section && (
              <span className='rounded bg-muted px-1.5 py-0.5'>{course.section}</span>
            )}
          </div>
        </div>
        <Button variant='ghost' size='sm' className='h-7 px-2' onClick={onClose}>
          ✕
        </Button>
      </div>

      {/* Section tabs + async content */}
      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as SectionKey)}
        className='flex min-h-0 flex-1 flex-col overflow-hidden gap-0'
      >
        <TabsList className='w-full justify-start rounded-none border-b bg-transparent px-2 py-5'>
          {SECTION_NAV.map(({ key, label, Icon }) => (
            <TabsTrigger key={key} value={key} className='gap-3 px-6 py-6'>
              <Icon className='size-3.5' />
              {label}
              {counts[key] !== undefined && (
                <span
                  className={
                    'rounded px-1.5 py-0.5 text-[10px] tabular-nums ' +
                    (key === 'classwork'
                      ? 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300'
                      : key === 'stream'
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                        : 'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300')
                  }
                >
                  {counts[key]}
                </span>
              )}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* Always mount all tab contents so counts/badges auto-populate on open (without needing to click tab first).
            Only the active one is visible. 
            Wrappers are flex containers so the inner ScrollArea (flex-1) gets proper height constraint for scrolling to work. */}
        <div className={tab === 'classwork' ? 'flex flex-1 min-h-0 overflow-hidden' : 'hidden'}>
          <InlineClasswork courseId={course.id} onCountChange={onClassworkCount} />
        </div>
        <div className={tab === 'stream' ? 'flex flex-1 min-h-0 overflow-hidden' : 'hidden'}>
          <InlineStream courseId={course.id} onCountChange={onStreamCount} />
        </div>
        <div className={tab === 'people' ? 'flex flex-1 min-h-0 overflow-hidden' : 'hidden'}>
          <InlinePeople courseId={course.id} onCountChange={onPeopleCount} />
        </div>
      </Tabs>
    </div>
  )
}
