import { useEffect, useMemo, useState, type ComponentType } from 'react'
import { Link } from '@tanstack/react-router'
import {
  Archive,
  ChevronDown,
  Command as CommandIcon,
  ExternalLink,
  GraduationCap,
  Inbox,
  Info,
  PanelRight,
  Plus,
  Reply,
  Search,
  Send,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { api, type Attachment, type Course, type CoursePerson, type Post, type TodoItem } from '@/lib/api'
import { useIsMobile } from '@/hooks/use-mobile'
import { cn, fullTimestamp } from '@/lib/utils'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { TagPicker } from '@/features/tags/tag-picker'
import { AttachmentView } from './components/attachment-view'
import {
  POST_ICON,
  cardKey,
  dashboardLimit,
  initials,
  isUnread,
  loadSeen,
  markSeen,
  submission,
  timeAgo,
  type Submission,
} from './board-model'
import { TeacherAvatar } from './dashboard-board'

const DAY = 86_400_000
// inbox7's avatar: a hairline ring drawn over the photo.
const RING =
  'after:absolute after:inset-0 after:rounded-full after:border after:border-border after:mix-blend-darken dark:after:mix-blend-lighten'
const NOTE = 'border-l-2 border-primary/20 pl-3 text-sm leading-6 text-muted-foreground'
const SMALL_BADGE = 'h-5 rounded-4xl px-1.5 text-[10px]'

type BaseQueue = 'all' | Post['type'] | 'archived'
/** inbox7's queues are the post types; its buckets are the courses. */
type Queue = BaseQueue | `course:${string}`
const QUEUES: { key: BaseQueue; icon: ComponentType<{ className?: string }> }[] = [
  { key: 'all', icon: Inbox },
  { key: 'announcement', icon: POST_ICON.announcement },
  { key: 'coursework', icon: POST_ICON.coursework },
  { key: 'material', icon: POST_ICON.material },
  { key: 'archived', icon: Archive },
]
const DOT: Record<Submission, string> = {
  turned_in: 'bg-emerald-500',
  assigned: 'bg-amber-500',
  missing: 'bg-destructive',
}

type Detail = { key: string; text?: string; due?: string; attachments?: Attachment[] }

/** Dashboard: the shadcnblocks inbox7 layout over the courses' posts — queues and
 * courses, the list, the chosen post, and its details. */
export function DashboardInbox() {
  const { t } = useTranslation()
  const mobile = useIsMobile()
  const [posts, setPosts] = useState<Post[] | null>(null)
  const [courses, setCourses] = useState<Course[]>([])
  const [people, setPeople] = useState<CoursePerson[]>([])
  const [todos, setTodos] = useState<TodoItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [queue, setQueue] = useState<Queue>('all')
  const [selected, setSelected] = useState<string | null>(null)
  const [seen, setSeen] = useState(() => loadSeen())
  const [limit] = useState(dashboardLimit)
  const [palette, setPalette] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(true)
  const [postDrawer, setPostDrawer] = useState(false)
  const [detailsDrawer, setDetailsDrawer] = useState(false)

  useEffect(() => {
    // shortcut: loads every post and slices here; add a server-side limit if it gets slow.
    Promise.all([api.listCourses(), api.listPosts(new Date(0).toISOString(), new Date(Date.now() + DAY).toISOString())])
      .then(([coursesRes, postsRes]) => {
        setCourses(coursesRes.items)
        setPosts(postsRes.items)
      })
      .catch((e) => setError(e instanceof Error ? e.message : t('common.loadFailed')))
    // Extras: without them the rows show no author and coursework no submission.
    api
      .listPeople()
      .then((res) => setPeople(res.items))
      .catch(() => undefined)
    api
      .listTodos()
      .then((res) => setTodos(res.items))
      .catch(() => undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    // Here ⌘K searches the inbox, as in inbox7, ahead of the app-wide search.
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        e.stopPropagation()
        setPalette((open) => !open)
      }
    }
    window.addEventListener('keydown', down, true)
    return () => window.removeEventListener('keydown', down, true)
  }, [])

  const courseOf = useMemo(() => new Map(courses.map((c) => [c.id, c])), [courses])
  const personOf = useMemo(() => new Map(people.map((p) => [`${p.course_id}:${p.user_id}`, p])), [people])
  const todoOf = useMemo(() => new Map(todos.map((todo) => [`${todo.course_id}:${todo.item_id}`, todo])), [todos])
  const authorOf = (post: Post) => personOf.get(`${post.course_id}:${post.creator_user_id}`)
  const submissionOf = (post: Post) => {
    const todo = post.type === 'coursework' ? todoOf.get(`${post.course_id}:${post.id}`) : undefined
    return todo && submission(todo)
  }

  const sorted = useMemo(() => [...(posts ?? [])].sort((a, b) => b.time.localeCompare(a.time)), [posts])
  const inQueue = (q: Queue, post: Post) => {
    const archived = !!courseOf.get(post.course_id)?.archived
    if (q === 'archived') return archived
    if (archived) return false
    if (q.startsWith('course:')) return q === `course:${post.course_id}`
    return q === 'all' || q === post.type
  }
  const items = sorted.filter((post) => inQueue(queue, post)).slice(0, limit)
  const unreadIn = (q: Queue) => sorted.filter((post) => inQueue(q, post) && isUnread(seen, post)).length
  const buckets = courses.filter((c) => !c.archived)
  const queueLabel = (q: Queue) =>
    q.startsWith('course:') ? (courseOf.get(q.slice(7))?.name ?? '') : t(`dashboard.queues.${q as BaseQueue}`)
  const QueueIcon = QUEUES.find((q) => q.key === queue)?.icon ?? GraduationCap

  // A wide screen always shows one; a phone opens one in a drawer.
  const current = sorted.find((post) => cardKey(post) === selected) ?? (mobile ? undefined : items[0])
  const detail = usePostDetail(current)

  const pickQueue = (q: Queue) => {
    setQueue(q)
    // As in inbox7, a queue opens on its newest post.
    setSelected(null)
  }
  const open = (post: Post) => {
    setSelected(cardKey(post))
    setSeen((s) => markSeen(s, cardKey(post)))
    if (mobile) setPostDrawer(true)
  }
  const pick = (post: Post) => {
    setPalette(false)
    setQueue(courseOf.get(post.course_id)?.archived ? 'archived' : 'all')
    open(post)
  }

  if (error) {
    return (
      <p role='alert' className='p-4 text-sm text-destructive'>
        {error}
      </p>
    )
  }

  const shown = current && {
    post: current,
    course: courseOf.get(current.course_id),
    author: authorOf(current),
    status: submissionOf(current),
    detail,
  }

  return (
    <div className='inbox7 flex min-h-0 flex-1 overflow-hidden border-t bg-background text-foreground'>
      <aside className='hidden w-56 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground md:flex'>
        <div className='flex h-14 items-center px-3'>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant='ghost' className='h-auto w-full justify-start gap-2 px-2 py-px has-[>svg]:px-2'>
                <span className='truncate font-semibold'>{t('dashboard.workspace')}</span>
                <ChevronDown className='size-3 text-muted-foreground' />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='start' className='inbox7 w-56'>
              <DropdownMenuLabel className='text-xs font-medium text-muted-foreground'>
                {t('dashboard.workspace')}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem asChild>
                  <Link to='/settings/language'>{t('dashboard.settings')}</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to='/sync'>{t('dashboard.sync')}</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <a href='https://classroom.google.com' target='_blank' rel='noreferrer'>
                    {t('dashboard.openClassroom')}
                  </a>
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className='px-2 pb-2'>
          <Button
            variant='ghost'
            className='h-9 w-full justify-start gap-2 px-2 has-[>svg]:px-2'
            onClick={() => setPalette(true)}
          >
            <Search className='size-4' />
            {t('dashboard.search')}
            <kbd className='ml-auto inline-flex items-center gap-0.5 font-mono text-xs text-muted-foreground'>
              <CommandIcon className='size-3' />K
            </kbd>
          </Button>
        </div>
        <ScrollArea className='relative min-h-0 flex-1 px-2'>
          <div className='flex flex-col gap-1'>
            {QUEUES.map((q) => (
              <NavButton
                key={q.key}
                icon={q.icon}
                label={queueLabel(q.key)}
                count={unreadIn(q.key)}
                active={queue === q.key}
                onClick={() => pickQueue(q.key)}
              />
            ))}
          </div>
          {!!buckets.length && (
            <>
              <p className='mt-4 mb-1 px-2 text-xs font-medium text-muted-foreground'>{t('dashboard.courses')}</p>
              <div className='flex flex-col gap-1 pb-2'>
                {buckets.map((c) => (
                  <NavButton
                    key={c.id}
                    icon={GraduationCap}
                    label={c.name}
                    active={queue === `course:${c.id}`}
                    onClick={() => pickQueue(`course:${c.id}`)}
                  />
                ))}
              </div>
            </>
          )}
        </ScrollArea>
      </aside>

      <div className='flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden'>
        <header className='flex h-14 shrink-0 items-center justify-between gap-3 border-b px-4 md:hidden'>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant='ghost' size='sm' className='h-8 min-w-0 gap-1.5 rounded-[min(var(--radius-md),10px)] px-2.5'>
                <QueueIcon className='size-4' />
                <span className='truncate'>{queueLabel(queue)}</span>
                <ChevronDown className='size-3' />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='start' className='inbox7 w-56'>
              {QUEUES.map((q) => (
                <DropdownMenuItem key={q.key} onSelect={() => pickQueue(q.key)}>
                  <q.icon className='size-4' />
                  {queueLabel(q.key)}
                </DropdownMenuItem>
              ))}
              {!!buckets.length && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className='text-xs font-medium text-muted-foreground'>
                    {t('dashboard.courses')}
                  </DropdownMenuLabel>
                  {buckets.map((c) => (
                    <DropdownMenuItem key={c.id} onSelect={() => pickQueue(`course:${c.id}`)}>
                      <GraduationCap className='size-4' />
                      <span className='truncate'>{c.name}</span>
                    </DropdownMenuItem>
                  ))}
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant='ghost'
            size='icon'
            className='size-8'
            aria-label={t('dashboard.search')}
            onClick={() => setPalette(true)}
          >
            <Search className='size-4' />
          </Button>
        </header>

        <div className='flex min-h-0 flex-1 overflow-hidden'>
          <div className='flex h-full w-full shrink-0 flex-col overflow-hidden border-r bg-background md:w-72'>
            <div className='flex h-14 shrink-0 items-center border-b px-4'>
              <h2 className='truncate text-base font-medium'>{queueLabel(queue)}</h2>
            </div>
            <ScrollArea className='relative min-h-0 flex-1'>
              {!posts ? (
                [...Array(6)].map((_, i) => (
                  <div key={i} className='border-b p-4'>
                    <Skeleton className='h-4 w-3/4' />
                    <Skeleton className='mt-2 h-3 w-full' />
                  </div>
                ))
              ) : !items.length ? (
                <p className='p-4 text-sm text-muted-foreground'>{t('dashboard.empty')}</p>
              ) : (
                items.map((post) => (
                  <PostRow
                    key={cardKey(post)}
                    post={post}
                    course={courseOf.get(post.course_id)}
                    author={authorOf(post)}
                    unread={isUnread(seen, post)}
                    selected={post === current}
                    onSelect={() => open(post)}
                  />
                ))
              )}
            </ScrollArea>
          </div>

          {shown && !mobile && (
            <div className='hidden min-h-0 min-w-0 flex-1 md:flex'>
              <Conversation
                {...shown}
                detailsOpen={detailsOpen}
                onToggleDetails={() => setDetailsOpen((o) => !o)}
              />
              {detailsOpen && (
                <div className='hidden lg:flex'>
                  <aside className='flex h-full w-80 shrink-0 flex-col overflow-hidden border-l bg-background'>
                    <div className='flex h-14 shrink-0 items-center gap-2 border-b px-4'>
                      <Info className='size-4' />
                      <span className='font-semibold'>{t('dashboard.details')}</span>
                    </div>
                    <ScrollArea className='relative min-h-0 flex-1'>
                      <Details {...shown} />
                    </ScrollArea>
                  </aside>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <CommandDialog
        open={palette}
        onOpenChange={setPalette}
        title={t('dashboard.search')}
        description={t('dashboard.searchPosts')}
        className='inbox7'
      >
        <CommandInput placeholder={t('dashboard.searchPosts')} />
        <CommandList>
          <CommandEmpty>{t('dashboard.noResults')}</CommandEmpty>
          {(['announcement', 'coursework', 'material'] as const).map((type) => {
            const Icon = POST_ICON[type]
            return (
              <CommandGroup key={type} heading={t(`dashboard.queues.${type}`)}>
                {sorted
                  .filter((post) => post.type === type)
                  .map((post) => {
                    const courseName = courseOf.get(post.course_id)?.name ?? post.course_id
                    return (
                      <CommandItem
                        key={cardKey(post)}
                        value={`${post.title} ${courseName} ${cardKey(post)}`}
                        onSelect={() => pick(post)}
                      >
                        <Icon />
                        <span className='truncate'>{post.title}</span>
                        <span className='ml-auto shrink-0 text-xs text-muted-foreground'>{courseName}</span>
                      </CommandItem>
                    )
                  })}
              </CommandGroup>
            )
          })}
        </CommandList>
      </CommandDialog>

      <Drawer open={mobile && postDrawer && !!shown} onOpenChange={setPostDrawer}>
        <DrawerContent className='inbox7 h-[90vh] bg-popover text-sm text-popover-foreground'>
          <DrawerHeader className='sr-only'>
            <DrawerTitle>{t('dashboard.post')}</DrawerTitle>
            <DrawerDescription>{current?.title}</DrawerDescription>
          </DrawerHeader>
          {shown && (
            <div className='flex h-full min-h-0 flex-col'>
              <div className='flex justify-end px-4 pt-2'>
                <Button variant='ghost' size='sm' onClick={() => setDetailsDrawer(true)}>
                  <Info className='size-4' />
                  {t('dashboard.details')}
                </Button>
              </div>
              <Conversation {...shown} />
            </div>
          )}
        </DrawerContent>
      </Drawer>
      <Drawer open={mobile && detailsDrawer && !!shown} onOpenChange={setDetailsDrawer}>
        <DrawerContent className='inbox7 h-[85vh] bg-popover text-sm text-popover-foreground'>
          <DrawerHeader className='flex-row items-center gap-2 px-4 text-left'>
            <Info className='size-4' />
            <DrawerTitle className='text-base'>{t('dashboard.details')}</DrawerTitle>
            <DrawerDescription className='sr-only'>{current?.title}</DrawerDescription>
          </DrawerHeader>
          {shown && (
            <ScrollArea className='min-h-0 flex-1'>
              <Details {...shown} />
            </ScrollArea>
          )}
        </DrawerContent>
      </Drawer>
    </div>
  )
}

function NavButton({
  icon: Icon,
  label,
  count,
  active,
  onClick,
}: {
  icon: ComponentType<{ className?: string }>
  label: string
  count?: number
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type='button'
      aria-current={active || undefined}
      onClick={onClick}
      className={cn(
        'flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm outline-none hover:bg-sidebar-accent focus-visible:ring-[3px] focus-visible:ring-ring/50',
        active && 'bg-sidebar-accent font-medium'
      )}
    >
      <Icon className='size-4 shrink-0' />
      <span className='min-w-0 flex-1 truncate'>{label}</span>
      {!!count && (
        <Badge variant='secondary' className={SMALL_BADGE}>
          {count}
        </Badge>
      )}
    </button>
  )
}

function PostRow({
  post,
  course,
  author,
  unread,
  selected,
  onSelect,
}: {
  post: Post
  course?: Course
  author?: CoursePerson
  unread: boolean
  selected: boolean
  onSelect: () => void
}) {
  const { t, i18n } = useTranslation()
  return (
    <button
      type='button'
      aria-current={selected || undefined}
      onClick={onSelect}
      className={cn(
        'w-full border-b p-4 text-left text-sm outline-none last:border-b-0 hover:bg-muted/50 focus-visible:bg-muted/50',
        selected && 'bg-muted'
      )}
    >
      <div className='flex items-center justify-between gap-2'>
        <span className={cn('truncate', unread && 'font-semibold')}>{post.title}</span>
        <span className='shrink-0 text-xs text-muted-foreground' title={fullTimestamp(post.time)}>
          {timeAgo(post.time, i18n.language)}
        </span>
      </div>
      <p className='mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground'>
        {course?.name ?? post.course_id} · {t(`courses.${post.type}`)}
      </p>
      {author && (
        <div className='mt-2 flex items-center gap-1.5 text-xs text-muted-foreground'>
          <TeacherAvatar person={author} className={cn('size-4', RING)} />
          <span>{author.full_name || author.user_id}</span>
        </div>
      )}
    </button>
  )
}

type Shown = {
  post: Post
  course?: Course
  author?: CoursePerson
  status?: Submission
  detail: Detail | null
}

/** The poster, or the course when the poster is not known. */
function PersonAvatar({ author, courseName, className }: { author?: CoursePerson; courseName: string; className: string }) {
  if (author) return <TeacherAvatar person={author} className={cn(className, RING)} />
  return (
    <Avatar className={cn(className, RING)}>
      <AvatarFallback className='text-xs text-muted-foreground'>{initials(courseName)}</AvatarFallback>
    </Avatar>
  )
}

/** inbox7's conversation: the post as its one message, under a reply box Classroom cannot take. */
function Conversation({
  post,
  course,
  author,
  status,
  detail,
  detailsOpen,
  onToggleDetails,
}: Shown & { detailsOpen?: boolean; onToggleDetails?: () => void }) {
  const { t, i18n } = useTranslation()
  const Icon = POST_ICON[post.type]
  const courseName = course?.name ?? post.course_id
  const name = author ? author.full_name || author.user_id : courseName
  const role = author?.role === 'teacher' || author?.role === 'student' ? author.role : undefined
  // An announcement's title is its first line: not shown twice.
  const lines = (detail?.text ?? '').trim().split('\n')
  const body = (post.type === 'announcement' && lines[0] === post.title ? lines.slice(1) : lines).join('\n').trim()

  return (
    <div className='flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden'>
      <header className='flex h-14 shrink-0 items-center justify-between gap-3 border-b px-4'>
        <div className='flex min-w-0 items-center gap-3'>
          <Icon className='size-5 shrink-0' />
          <h2 className='truncate text-sm font-medium'>{post.title}</h2>
        </div>
        <div className='flex items-center gap-2'>
          {status && (
            <span className='inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[min(var(--radius-md),10px)] border bg-background px-2.5 text-sm font-medium whitespace-nowrap shadow-xs dark:border-input dark:bg-input/30'>
              <span className={cn('size-2 rounded-full', DOT[status])} />
              {t(`dashboard.submission.${status}`)}
            </span>
          )}
          {onToggleDetails && (
            <Button
              variant='ghost'
              size='icon'
              className='hidden size-8 lg:inline-flex'
              aria-label={t('dashboard.toggleDetails')}
              aria-pressed={detailsOpen}
              onClick={onToggleDetails}
            >
              <PanelRight className={cn('size-4', detailsOpen && 'text-primary')} />
            </Button>
          )}
        </div>
      </header>
      <ScrollArea className='relative min-h-0 flex-1 overflow-hidden'>
        <div className='mx-auto flex max-w-3xl flex-col gap-8 px-4 py-6 lg:px-8'>
          <div className='flex flex-col gap-3'>
            <div className='flex items-start gap-3'>
              <PersonAvatar author={author} courseName={courseName} className='mt-0.5 size-10 shrink-0' />
              <div className='min-w-0'>
                <div className='flex items-center gap-2'>
                  <span className='font-medium'>{name}</span>
                  {role && (
                    <Badge variant='secondary' className={SMALL_BADGE}>
                      {t(`dashboard.roles.${role}`)}
                    </Badge>
                  )}
                </div>
                <p className='text-sm text-muted-foreground'>{author ? courseName : t(`courses.${post.type}`)}</p>
                <p className='text-xs text-muted-foreground' title={fullTimestamp(post.time)}>
                  {new Intl.DateTimeFormat(i18n.language, {
                    month: 'short',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                  }).format(new Date(post.time))}
                </p>
              </div>
            </div>
            {!detail ? (
              <div className='flex flex-col gap-2'>
                <Skeleton className='h-4 w-full' />
                <Skeleton className='h-4 w-5/6' />
                <Skeleton className='h-4 w-2/3' />
              </div>
            ) : body ? (
              // Classroom text keeps its line breaks and long links.
              <p className='text-sm leading-relaxed wrap-anywhere whitespace-pre-wrap'>{body}</p>
            ) : (
              <p className='text-sm text-muted-foreground'>{t('classwork.noDescription')}</p>
            )}
          </div>
        </div>
      </ScrollArea>
      <div className='shrink-0 border-t px-4 py-4 lg:px-8'>
        <div className='rounded-lg border bg-muted/30'>
          <div className='flex items-center gap-2 border-b px-3 py-2'>
            <Reply className='size-4 shrink-0 text-muted-foreground' />
            <span className='truncate text-sm text-muted-foreground'>{name}</span>
          </div>
          {/* Classroom's API takes no replies: the box keeps inbox7's layout, disabled. */}
          <Textarea
            disabled
            aria-label={t('dashboard.reply')}
            placeholder={t('dashboard.reply')}
            className='min-h-20 resize-none border-0 bg-transparent px-2.5'
          />
          <div className='flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2'>
            <Button variant='ghost' size='icon' className='size-8' disabled aria-label={t('dashboard.attach')}>
              <Plus className='size-4' />
            </Button>
            <div className='flex items-center gap-2'>
              <span className='hidden text-xs text-muted-foreground sm:inline'>{t('dashboard.replyUnsupported')}</span>
              <Button size='sm' className='h-8 gap-1.5 rounded-[min(var(--radius-md),10px)] px-2.5' disabled>
                <Send className='size-3.5' />
                {t('dashboard.send')}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/** inbox7's agent panel: who posted it, when, its due date and attachments. */
function Details({ post, course, author, status, detail }: Shown) {
  const { t } = useTranslation()
  const courseName = course?.name ?? post.course_id
  const attachments = detail?.attachments ?? []
  return (
    <div className='flex flex-col gap-6 p-4'>
      <div>
        <div className='flex items-start gap-3'>
          <PersonAvatar author={author} courseName={courseName} className='size-10 shrink-0' />
          <div className='min-w-0'>
            <p className='font-medium'>{author ? author.full_name || author.user_id : courseName}</p>
            <p className='text-sm text-muted-foreground'>{author ? courseName : t(`courses.${post.type}`)}</p>
          </div>
        </div>
        {detail?.due && (
          <Badge
            variant='outline'
            className='mt-3 h-5 rounded-4xl border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300'
          >
            {t('dashboard.due', { date: detail.due })}
          </Badge>
        )}
      </div>
      <div className='flex flex-col gap-3'>
        <p className={NOTE}>
          {t(`courses.${post.type}`)} · {t('dashboard.posted', { date: fullTimestamp(post.time) })}
        </p>
        {status && <p className={NOTE}>{t(`dashboard.submission.${status}`)}</p>}
      </div>
      <div className='flex flex-col gap-3'>
        <p className='text-xs font-medium tracking-wide text-muted-foreground uppercase'>{t('tags.label')}</p>
        <TagPicker target={`post:${cardKey(post)}`} />
      </div>
      <div className='flex flex-col gap-3'>
        {!!attachments.length && (
          <>
            <p className='text-xs font-medium tracking-wide text-muted-foreground uppercase'>
              {t('classwork.attachments', { count: attachments.length })}
            </p>
            {attachments.map((att) => (
              <AttachmentView key={att.id} att={att} />
            ))}
          </>
        )}
        {post.alternate_link && (
          <Button variant='outline' className='h-9 w-full gap-2 px-2.5' asChild>
            <a href={post.alternate_link} target='_blank' rel='noreferrer'>
              <ExternalLink className='size-4' />
              {t('courses.openInClassroom')}
            </a>
          </Button>
        )}
      </div>
    </div>
  )
}

/** The post's text, due date and attachments, fetched with its course's stream or
 * classwork; null while they load. */
function usePostDetail(post?: Post): Detail | null {
  const { i18n } = useTranslation()
  const [detail, setDetail] = useState<Detail | null>(null)
  const key = post && cardKey(post)
  const type = post?.type
  const id = post?.id
  const courseId = post?.course_id

  useEffect(() => {
    if (!key || !type || !id || !courseId) return
    let live = true
    const load =
      type === 'announcement'
        ? api
            .getStream(courseId, 1000)
            .then((res) => ({ key, text: res.items.find((i) => i.type === 'announcement' && i.id === id)?.text }))
        : api.getClasswork(courseId).then((res) => {
            const item = [...res.coursework, ...res.materials].find((i) => i.id === id)
            const due = item?.due_date as { year: number; month: number; day: number } | null | undefined
            return {
              key,
              text: item?.description,
              due: due
                ? new Date(due.year, due.month - 1, due.day).toLocaleDateString(i18n.language, { dateStyle: 'medium' })
                : undefined,
              attachments: item?.attachments ?? [],
            }
          })
    load.then((d) => live && setDetail(d)).catch(() => live && setDetail({ key }))
    return () => {
      live = false
    }
  }, [key, type, id, courseId, i18n.language])

  return detail?.key === key ? detail : null
}
