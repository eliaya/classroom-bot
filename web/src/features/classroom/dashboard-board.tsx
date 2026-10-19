import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MeasuringStrategy,
  PointerSensor,
  defaultDropAnimationSideEffects,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type DropAnimation,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  defaultAnimateLayoutChanges,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  type AnimateLayoutChanges,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { BookOpen, ClipboardList, EllipsisVertical, GripVertical, Layers, Megaphone, PanelRightOpen } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { api, type Course, type CoursePerson, type Post } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  cardKey,
  lessonsOf,
  ordered,
  postsSince,
  prune,
  reorder,
  startOfDay,
  toBoard,
  weekStart,
  type Board,
  type Lesson,
  type Tab,
} from './board-model'
import { CourseClassworkPage } from './course-classwork'

const DAY = 86_400_000

type Tone = 'neutral' | 'info' | 'purple'

const DOT: Record<Tone, string> = { neutral: 'bg-zinc-500', info: 'bg-blue-500', purple: 'bg-violet-500' }

const BADGE: Record<Tone, string> = {
  neutral:
    'bg-zinc-600/10 text-zinc-600 border-zinc-600/30 dark:bg-zinc-400/10 dark:text-zinc-400 dark:border-zinc-400/30',
  info: 'bg-blue-600/10 text-blue-600 border-blue-600/30 dark:bg-blue-400/10 dark:text-blue-400 dark:border-blue-400/30',
  purple:
    'bg-violet-600/10 text-violet-600 border-violet-600/30 dark:bg-violet-400/10 dark:text-violet-400 dark:border-violet-400/30',
}

const POST_ICON = { announcement: Megaphone, coursework: ClipboardList, material: BookOpen }
const POST_TONE: Record<Post['type'], Tone> = { announcement: 'neutral', coursework: 'info', material: 'purple' }

// The reference design's Card surface (radius × 1.4, 1px foreground/10 ring) and pill badge.
const SURFACE = 'overflow-hidden rounded-xl bg-card text-sm text-card-foreground ring-1 ring-foreground/10'
const PILL =
  'inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap'

// As the reference Kanban: sortables keep animating after a drop, the overlay
// lands with the source faded to 0.4, and droppables are always re-measured.
const animateLayoutChanges: AnimateLayoutChanges = (args) =>
  defaultAnimateLayoutChanges({ ...args, wasDragging: true })
const dropAnimation: DropAnimation = {
  sideEffects: defaultDropAnimationSideEffects({ styles: { active: { opacity: '0.4' } } }),
}
const measuring = { droppable: { strategy: MeasuringStrategy.Always } }
const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

function initials(name: string) {
  const words = name.replace(/【[^】]*】/g, '').trim().split(/\s+/).filter(Boolean)
  return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? name).slice(0, 2)).toUpperCase()
}

const columnKey = (key: string) => `col:${key}`

/** Lesson key -> its card keys, in order. */
type Arrangement = Record<string, string[]>

/** Dashboard: one column per lesson of today or this week, holding the
 * lesson's classwork and stream posts as cards. Only their order is saved;
 * Classroom is untouched. */
export function DashboardBoard() {
  const { t } = useTranslation()
  const [courses, setCourses] = useState<Course[] | null>(null)
  const [posts, setPosts] = useState<Post[]>([])
  const [people, setPeople] = useState<CoursePerson[]>([])
  const [board, setBoard] = useState<Board | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('today')
  const [teacher, setTeacher] = useState('')
  // The cards' order while one is dragged; the saved order otherwise.
  const [live, setLive] = useState<Arrangement | null>(null)
  const [dragging, setDragging] = useState<{ type: 'card' | 'column'; id: string } | null>(null)
  const [open, setOpen] = useState<{ lesson: string; card?: string } | null>(null)
  // Fixed for the page's lifetime so the tabs do not shift while it is open.
  const [now] = useState(() => Date.now())
  const frame = useRef<number | null>(null)
  const pendingOver = useRef<DragOverEvent | null>(null)

  useEffect(() => {
    Promise.all([
      api.listCourses(),
      api.listPosts(new Date(postsSince(now)).toISOString(), new Date(now + DAY).toISOString()),
      api.getBoard<Board>(),
    ])
      .then(([coursesRes, postsRes, boardRes]) => {
        setCourses(coursesRes.items.filter((c) => !c.archived))
        setPosts(postsRes.items)
        setBoard(toBoard(boardRes.data))
      })
      .catch((e) => setError(e instanceof Error ? e.message : t('common.loadFailed')))
    // An extra: without it the columns show no teacher.
    api
      .listPeople()
      .then((res) => setPeople(res.items))
      .catch(() => undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Each course's teachers, as the API orders them.
  const teachersOf = useMemo(() => {
    const map = new Map<string, CoursePerson[]>()
    for (const p of people) if (p.role === 'teacher') map.set(p.course_id, [...(map.get(p.course_id) ?? []), p])
    return map
  }, [people])

  const tabLessons = useMemo(() => lessonsOf(courses ?? [], posts, tab, now), [courses, posts, tab, now])

  // The teachers of the tab's lessons, once each.
  const teachers = useMemo(() => {
    const seen = new Map<string, CoursePerson>()
    for (const lesson of tabLessons)
      for (const p of teachersOf.get(lesson.course.id) ?? []) if (!seen.has(p.user_id)) seen.set(p.user_id, p)
    return [...seen.values()]
  }, [tabLessons, teachersOf])

  const selected = teachers.some((p) => p.user_id === teacher) ? teacher : ''
  const lessonMap = useMemo(
    () =>
      new Map(
        tabLessons
          .filter((l) => !selected || teachersOf.get(l.course.id)?.some((p) => p.user_id === selected))
          .map((l) => [l.key, l])
      ),
    [tabLessons, teachersOf, selected]
  )
  const columns = useMemo(() => (board ? ordered(board.columns, [...lessonMap.keys()]) : []), [board, lessonMap])
  const arrangement = useMemo(
    () =>
      live ??
      Object.fromEntries(
        [...lessonMap.values()].map((l) => [l.key, ordered(board?.cards[l.key], l.posts.map(cardKey))])
      ),
    [live, board, lessonMap]
  )

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 10 } }),
    // Enter opens a card, so Space picks one up.
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space', 'Enter'] },
    })
  )

  if (error) {
    return (
      <p role='alert' className='text-sm text-destructive'>
        {error}
      </p>
    )
  }

  if (!courses || !board) {
    return (
      <div className='flex flex-col gap-3'>
        <Skeleton className='h-9 w-40' />
        <div className='flex gap-4 overflow-hidden p-1'>
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className='h-64 w-72 shrink-0 rounded-xl' />
          ))}
        </div>
      </div>
    )
  }

  // Lessons before this week drop out of the saved order.
  const save = (next: Board) => {
    const kept = prune(next, weekStart(now))
    setBoard(kept)
    api.saveBoard(kept).catch(() => toast.error(t('common.saveFailed')))
  }

  const cancelFrame = () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    frame.current = null
    pendingOver.current = null
  }

  const lessonOfCard = (arr: Arrangement, key: string) => Object.keys(arr).find((id) => arr[id].includes(key))

  const onDragStart = ({ active }: DragStartEvent) => {
    const type = active.data.current?.type as 'card' | 'column'
    setDragging({ type, id: String(active.id) })
    if (type === 'card') setLive(arrangement)
  }

  // A card belongs to its lesson, so it only moves within its column (once a frame).
  const onDragOver = (event: DragOverEvent) => {
    pendingOver.current = event
    if (frame.current !== null) return
    frame.current = requestAnimationFrame(() => {
      frame.current = null
      const pending = pendingOver.current
      pendingOver.current = null
      if (!pending?.over || pending.active.data.current?.type !== 'card') return
      const [key, over] = [String(pending.active.id), String(pending.over.id)]
      setLive((arr) => {
        const lesson = arr && lessonOfCard(arr, key)
        if (!arr || !lesson || !arr[lesson].includes(over)) return arr
        const [from, to] = [arr[lesson].indexOf(key), arr[lesson].indexOf(over)]
        return from === to ? arr : { ...arr, [lesson]: arrayMove(arr[lesson], from, to) }
      })
    })
  }

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    cancelFrame()
    setDragging(null)
    const current = live ?? arrangement
    setLive(null)
    if (!over) return
    if (active.data.current?.type === 'column') {
      const ids = columns.map(columnKey)
      const [from, to] = [ids.indexOf(String(active.id)), ids.indexOf(String(over.id))]
      if (to >= 0 && from !== to) save({ ...board, columns: reorder(board.columns, arrayMove(columns, from, to)) })
      return
    }
    const key = String(active.id)
    const lesson = lessonOfCard(current, key)
    if (!lesson) return
    // `current` already holds the reordering done while dragging; a drop on
    // another lesson leaves the card in its own.
    const order = current[lesson]
    const to = order.indexOf(String(over.id))
    const next = to < 0 ? order : arrayMove(order, order.indexOf(key), to)
    const saved = ordered(board.cards[lesson], lessonMap.get(lesson)?.posts.map(cardKey) ?? [])
    if (next.join() !== saved.join())
      save({ ...board, cards: { ...board.cards, [lesson]: reorder(board.cards[lesson], next) } })
  }

  const onDragCancel = () => {
    cancelFrame()
    setDragging(null)
    setLive(null)
  }

  const today = startOfDay(now)
  const columnProps = (lesson: Lesson) => {
    const byKey = new Map(lesson.posts.map((p) => [cardKey(p), p]))
    return {
      lesson,
      posts: (arrangement[lesson.key] ?? []).flatMap((key) => byKey.get(key) ?? []),
      teacher: teachersOf.get(lesson.course.id)?.[0],
      today,
    }
  }

  const draggedPost =
    dragging?.type === 'card' ? posts.find((p) => cardKey(p) === dragging.id) : undefined
  const draggedLesson = dragging?.type === 'column' ? lessonMap.get(dragging.id.slice(4)) : undefined
  const openLesson = open ? lessonMap.get(open.lesson) : undefined

  return (
    <div className='flex flex-col gap-3'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)}>
          <TabsList>
            {(['today', 'week'] as const).map((key) => (
              <TabsTrigger
                key={key}
                value={key}
                className='text-foreground/60 hover:text-foreground data-[state=active]:text-foreground'
              >
                {t(`board.${key}`)}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <TeacherFilter teachers={teachers} selected={selected} onSelect={setTeacher} />
      </div>

      {!columns.length ? (
        <div className='flex flex-col items-center gap-2 rounded-xl border border-dashed px-3 py-12 text-center'>
          <Layers className='size-6 text-muted-foreground' aria-hidden='true' />
          <p className='text-sm font-medium'>{t(`board.noLessons.${tab}`)}</p>
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          measuring={measuring}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDragEnd={onDragEnd}
          onDragCancel={onDragCancel}
        >
          <div data-slot='kanban' data-dragging={dragging !== null} className={cn(dragging && 'cursor-grabbing!')}>
            <ScrollArea className='w-full'>
              <div className='flex items-start gap-4 p-1 pe-4 pb-4'>
                <SortableContext items={columns.map(columnKey)} strategy={horizontalListSortingStrategy}>
                  <div data-slot='kanban-board' className='flex items-start gap-4 p-0'>
                    {columns.map((key) => {
                      const lesson = lessonMap.get(key)!
                      return (
                        <SortableColumn
                          key={key}
                          {...columnProps(lesson)}
                          onOpen={(card) => setOpen({ lesson: key, card })}
                        />
                      )
                    })}
                  </div>
                </SortableContext>
              </div>
              <ScrollBar orientation='horizontal' />
            </ScrollArea>
          </div>
          {createPortal(
            <DragOverlay dropAnimation={reduceMotion() ? null : dropAnimation} className='z-50 cursor-grabbing'>
              {draggedPost && <PostCard post={draggedPost} overlay />}
              {draggedLesson && <ColumnView {...columnProps(draggedLesson)} />}
            </DragOverlay>,
            document.body
          )}
        </DndContext>
      )}

      <LessonSheet
        lesson={openLesson}
        post={openLesson?.posts.find((p) => cardKey(p) === open?.card)}
        onClose={() => setOpen(null)}
      />
    </div>
  )
}

function TeacherAvatar({ person, className }: { person: CoursePerson; className?: string }) {
  const name = person.full_name || person.user_id
  return (
    <Avatar className={className}>
      {person.photo_url && <AvatarImage src={person.photo_url} alt={name} loading='lazy' />}
      <AvatarFallback className='text-xs text-muted-foreground'>{initials(name)}</AvatarFallback>
    </Avatar>
  )
}

/** The tab's teachers as stacked avatars; picking one shows only their lessons. */
function TeacherFilter({
  teachers,
  selected,
  onSelect,
}: {
  teachers: CoursePerson[]
  selected: string
  onSelect: (id: string) => void
}) {
  const { t } = useTranslation()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant='outline' className='h-8 gap-0 px-3' aria-label={t('board.filterTeachers')}>
          <div className='flex -space-x-2'>
            {teachers.map((p) => (
              <TeacherAvatar
                key={p.user_id}
                person={p}
                className={cn(
                  'size-6 ring-2 ring-background transition-opacity',
                  !selected || selected === p.user_id ? 'z-1' : 'opacity-30'
                )}
              />
            ))}
            {!selected && (
              <div className='relative z-2 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground ring-2 ring-background'>
                {t('common.all')}
              </div>
            )}
          </div>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end' className='min-w-48 p-1'>
        <DropdownMenuRadioGroup value={selected} onValueChange={onSelect}>
          <DropdownMenuRadioItem value='' className='gap-2'>
            <div className='flex -space-x-2'>
              {teachers.slice(0, 3).map((p) => (
                <TeacherAvatar key={p.user_id} person={p} className='size-6 ring-2 ring-background' />
              ))}
            </div>
            <span>{t('common.all')}</span>
          </DropdownMenuRadioItem>
          {teachers.map((p) => (
            <DropdownMenuRadioItem key={p.user_id} value={p.user_id} className='gap-2'>
              <TeacherAvatar person={p} className='size-6' />
              <span>{p.full_name || p.user_id}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

type ColumnProps = {
  lesson: Lesson
  posts: Post[]
  teacher: CoursePerson | undefined
  today: number
}

function SortableColumn({ onOpen, ...props }: ColumnProps & { onOpen: (card?: string) => void }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: columnKey(props.lesson.key), data: { type: 'column' }, animateLayoutChanges })
  return (
    <ColumnView
      {...props}
      nodeRef={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition: reduceMotion() ? undefined : transition }}
      dragging={isDragging}
      handle={{ ref: setActivatorNodeRef, ...attributes, ...listeners }}
      onOpen={onOpen}
    />
  )
}

/** A lesson's column; without `onOpen` it is the drag overlay's copy: no actions, no sortables. */
function ColumnView({
  lesson,
  posts,
  teacher,
  today,
  nodeRef,
  style,
  dragging,
  handle,
  onOpen,
}: ColumnProps & {
  nodeRef?: (node: HTMLElement | null) => void
  style?: React.CSSProperties
  dragging?: boolean
  handle?: React.ComponentProps<'button'> & { ref?: (node: HTMLElement | null) => void }
  onOpen?: (card?: string) => void
}) {
  const { t, i18n } = useTranslation()
  const live = !!onOpen
  const name = lesson.course.name
  const tone: Tone = lesson.day === today ? 'info' : lesson.day < today ? 'neutral' : 'purple'
  const cards = posts.map((post) =>
    live ? (
      <SortablePost key={cardKey(post)} post={post} onOpen={() => onOpen(cardKey(post))} />
    ) : (
      <PostCard key={cardKey(post)} post={post} />
    )
  )
  return (
    <div
      ref={nodeRef}
      style={style}
      data-slot='kanban-column'
      data-dragging={dragging}
      className={cn('group/kanban-column flex flex-col', dragging && 'z-50 opacity-50')}
    >
      <div className={cn(SURFACE, 'flex w-72 shrink-0 flex-col gap-0 py-2.5 shadow-xs')}>
        <div className='flex items-center justify-between gap-1 px-2.5'>
          <div className='flex min-w-0 flex-1 items-center gap-2'>
            <span className={cn('size-2 shrink-0 rounded-full', DOT[tone])} />
            <span className='truncate text-sm font-medium'>{name}</span>
            <span className={cn(PILL, 'border-border text-foreground')}>{posts.length}</span>
          </div>
          {live && (
            <div className='flex shrink-0 items-center gap-1'>
              <Button
                variant='ghost'
                size='icon'
                data-slot='kanban-column-handle'
                className={cn('size-8 text-muted-foreground', dragging ? 'cursor-grabbing!' : 'cursor-grab!')}
                aria-label={t('board.reorder', { name })}
                {...handle}
              >
                <GripVertical className='size-3.5' />
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant='ghost' size='icon' className='size-8' aria-label={t('board.columnActions', { name })}>
                    <EllipsisVertical className='size-3.5' />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align='end' className='w-44'>
                  <DropdownMenuItem onClick={() => onOpen()}>
                    <PanelRightOpen />
                    {t('board.openClasswork')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>
        <div className='flex items-center justify-between gap-2 px-2.5 pt-1'>
          <div className='flex min-w-0 items-center gap-1.5'>
            {teacher ? (
              <TeacherAvatar person={teacher} className='size-5' />
            ) : (
              <Avatar className='size-5'>
                <AvatarFallback className='text-xs text-muted-foreground'>{initials(name)}</AvatarFallback>
              </Avatar>
            )}
            <span className='truncate text-xs text-muted-foreground'>
              {teacher ? teacher.full_name || teacher.user_id : t('board.noTeacher')}
            </span>
          </div>
          <span className={cn(PILL, BADGE[tone])}>
            {new Date(lesson.day).toLocaleDateString(i18n.language, {
              weekday: 'short',
              month: 'numeric',
              day: 'numeric',
            })}
          </span>
        </div>
        <div className='flex flex-col gap-2.5 px-2.5 pt-2.5'>
          {!posts.length ? (
            <div className='flex flex-col items-center gap-2 rounded-lg border border-dashed px-3 py-8 text-center'>
              <Layers className='size-6 text-muted-foreground' aria-hidden='true' />
              <p className='text-xs text-muted-foreground'>{t('board.noRecords')}</p>
            </div>
          ) : live ? (
            <SortableContext items={posts.map(cardKey)} strategy={verticalListSortingStrategy}>
              <div data-slot='kanban-column-content' className='flex min-h-2 flex-col gap-2.5'>
                {cards}
              </div>
            </SortableContext>
          ) : (
            <div data-slot='kanban-column-content' className='flex min-h-2 flex-col gap-2.5'>
              {cards}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function SortablePost({ post, onOpen }: { post: Post; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: cardKey(post),
    data: { type: 'card' },
    animateLayoutChanges,
  })
  return (
    <div
      ref={setNodeRef}
      data-slot='kanban-item'
      data-dragging={isDragging}
      style={{ transform: CSS.Transform.toString(transform), transition: reduceMotion() ? undefined : transition }}
      className={cn(
        'rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
        isDragging && 'z-50 opacity-50'
      )}
      {...attributes}
      {...listeners}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen()
        else listeners?.onKeyDown?.(e)
      }}
    >
      <div data-slot='kanban-item-handle' className={cn('block', isDragging ? 'cursor-grabbing!' : 'cursor-grab!')}>
        <PostCard post={post} />
      </div>
    </div>
  )
}

/** A classwork or stream post of the lesson. */
function PostCard({ post, overlay }: { post: Post; overlay?: boolean }) {
  const { t, i18n } = useTranslation()
  const Icon = POST_ICON[post.type]
  return (
    <div className={cn(SURFACE, 'flex flex-col gap-0 py-0 shadow-none', overlay && 'rotate-1 shadow-xl')}>
      <div className={cn('flex flex-col gap-2.5 p-3', !overlay && 'cursor-pointer')}>
        <div className='flex items-center justify-between gap-2'>
          <span className={cn(PILL, BADGE[POST_TONE[post.type]])}>
            <Icon className='size-3' aria-hidden='true' />
            {t(`courses.${post.type}`)}
          </span>
          <span className='truncate text-xs text-muted-foreground'>
            {new Date(post.time).toLocaleString(i18n.language, {
              month: 'numeric',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
        </div>
        <span className='line-clamp-2 text-sm font-medium'>{post.title}</span>
      </div>
    </div>
  )
}

/** A lesson opened from its column or one of its cards: its course's Classwork
 * on the topic of the card's classwork, or of the lesson's. */
function LessonSheet({ lesson, post, onClose }: { lesson: Lesson | undefined; post: Post | undefined; onClose: () => void }) {
  const { t, i18n } = useTranslation()
  const items =
    post && post.type !== 'announcement'
      ? [post.id]
      : (lesson?.posts.filter((p) => p.type !== 'announcement').map((p) => p.id) ?? [])
  const link = post?.alternate_link || lesson?.course.alternate_link
  return (
    <Sheet open={!!lesson} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className='w-full gap-0 sm:max-w-3xl'>
        {lesson && (
          <>
            <SheetHeader className='border-b'>
              <SheetTitle className='pe-8 text-xl'>{post?.title ?? lesson.course.name}</SheetTitle>
              <SheetDescription>
                {post && `${lesson.course.name} · `}
                {new Date(lesson.day).toLocaleDateString(i18n.language, { dateStyle: 'full' })}
              </SheetDescription>
            </SheetHeader>
            <div className='min-h-0 flex-1 overflow-y-auto p-3'>
              <CourseClassworkPage key={`${lesson.key}:${post?.id}`} courseId={lesson.course.id} lessonItemIds={items} />
            </div>
            <SheetFooter className='flex-row justify-between border-t'>
              <Button variant='ghost' onClick={onClose}>
                {t('common.close')}
              </Button>
              {link && (
                <Button variant='outline' asChild>
                  <a href={link} target='_blank' rel='noreferrer'>
                    {t('courses.openInClassroom')}
                  </a>
                </Button>
              )}
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
