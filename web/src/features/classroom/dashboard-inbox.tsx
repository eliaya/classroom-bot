import { Fragment, useEffect, useMemo, useRef, useState, type ComponentType } from 'react'
import { Link } from '@tanstack/react-router'
import {
  Archive,
  ArrowUpDown,
  ChevronDown,
  Command as CommandIcon,
  ExternalLink,
  Inbox,
  Mail,
  Paperclip,
  Pencil,
  Search,
  SquarePen,
  Tag as TagIcon,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  api,
  type Attachment,
  type Course,
  type CoursePerson,
  type MailLabel,
  type Post,
  type Tag,
  type TodoItem,
} from '@/lib/api'
import { useIsMobile } from '@/hooks/use-mobile'
import { useCan } from '@/lib/permissions'
import { cn, fullTimestamp } from '@/lib/utils'
import { Alert, AlertDescription } from '@/components/ui/alert'
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
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { DetailHeader, DetailToolbar, IconButton, InboxItem, ListHeader, Pager } from '@/features/mail/inbox-ui'
import { LabelDot } from '@/features/mail/label-dot'
import { MailDisplay } from '@/features/mail/mail-display'
import { MailList } from '@/features/mail/mail-list'
import { GMAIL_COMPOSE_URL, MAILBOX_ICONS, labelName } from '@/features/mail/mail-utils'
import { useMail } from '@/features/mail/use-mail'
import { TagDot } from '@/features/tags/tag-dot'
import { TagEditDialog } from '@/features/tags/tag-edit-dialog'
import {
  TAG_LIMITS,
  TAG_SORTS,
  listTags,
  loadTagPrefs,
  saveTagPrefs,
  type TagListPrefs,
} from '@/features/tags/tag-list'
import { TagColorPicker } from '@/features/tags/tag-color-picker'
import { useTagsStore } from '@/stores/tags-store'
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
const NAV_ROW =
  'flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm outline-none hover:bg-sidebar-accent focus-visible:ring-[3px] focus-visible:ring-ring/50'
const SMALL_BADGE = 'h-5 rounded-4xl px-1.5 text-[10px]'

type BaseQueue = 'all' | Post['type'] | 'archived'
/** inbox7's queues are the post types; its buckets are the user's tags; `mail:<label>` a Gmail mailbox or label. */
type Queue = BaseQueue | `tag:${number}` | `mail:${string}`
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

/** Dashboard: the shadcnblocks inbox7 layout over the courses' posts and the
 * user's Gmail — queues, mailboxes and tags, the list, and the chosen post or conversation. */
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
  const [pageIndex, setPageIndex] = useState(0)
  const [palette, setPalette] = useState(false)
  const [postDrawer, setPostDrawer] = useState(false)
  // As in the main sidebar: no Mail for a role the API would answer 403.
  const canMail = useCan('mail:view')
  const mailbox = queue.startsWith('mail:') ? queue.slice(5) : null
  const mail = useMail(canMail, mailbox, limit)
  const mailLabels = mail.labels?.granted ? [...mail.labels.mailboxes, ...mail.labels.labels] : []
  const tags = useTagsStore((s) => s.tags)
  const ensureTags = useTagsStore((s) => s.ensure)
  const [tagPrefs, setTagPrefs] = useState(loadTagPrefs)
  const [editing, setEditing] = useState<Tag | null>(null)
  // What the chosen tag is on (its target keys), loaded when it is chosen.
  const [tagged, setTagged] = useState<{ queue: Queue; targets: Set<string> } | null>(null)

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
    void ensureTags()
  }, [ensureTags])

  useEffect(() => {
    if (!queue.startsWith('tag:')) return
    let live = true
    api
      .listTagTargets(Number(queue.slice(4)))
      .then((res) => live && setTagged({ queue, targets: new Set(res.targets) }))
      .catch(() => live && setTagged({ queue, targets: new Set() }))
    return () => {
      live = false
    }
  }, [queue])

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
  const tagOf = useMemo(() => new Map(tags.map((tag) => [`tag:${tag.id}`, tag])), [tags])
  const inQueue = (q: Queue, post: Post) => {
    // A tag holds what was tagged, archived course or not.
    if (q.startsWith('tag:')) return tagged?.queue === q && tagged.targets.has(`post:${cardKey(post)}`)
    const archived = !!courseOf.get(post.course_id)?.archived
    if (q === 'archived') return archived
    if (archived) return false
    return q === 'all' || q === post.type
  }
  const inList = sorted.filter((post) => inQueue(queue, post))
  // The saved count is the page size.
  const pages = Math.max(1, Math.ceil(inList.length / limit))
  const pageAt = Math.min(pageIndex, pages - 1)
  const items = inList.slice(pageAt * limit, (pageAt + 1) * limit)
  const unreadIn = (q: Queue) => sorted.filter((post) => inQueue(q, post) && isUnread(seen, post)).length
  const buckets = listTags(tags, tagPrefs)
  const mailLabel = (id: string) => {
    const label = mailLabels.find((l) => l.id === id)
    return id === 'INBOX' || !label ? t('nav.mail') : labelName(t, label)
  }
  const queueLabel = (q: Queue) =>
    q.startsWith('tag:')
      ? (tagOf.get(q)?.name ?? '')
      : q.startsWith('mail:')
        ? mailLabel(q.slice(5))
        : t(`dashboard.queues.${q as BaseQueue}`)
  const QueueIcon = QUEUES.find((q) => q.key === queue)?.icon ?? (mailbox ? Mail : TagIcon)
  const changePrefs = (next: Partial<TagListPrefs>) => {
    const prefs = { ...tagPrefs, ...next }
    setTagPrefs(prefs)
    saveTagPrefs(prefs)
  }

  // A wide screen always shows one; a phone opens one in a drawer.
  const current = sorted.find((post) => cardKey(post) === selected) ?? (mobile ? undefined : items[0])
  const detail = usePostDetail(current)

  const pickQueue = (q: Queue) => {
    setQueue(q)
    setPageIndex(0)
    // As in inbox7, a queue opens on its newest post.
    setSelected(null)
    mail.reset()
  }
  const open = (post: Post) => {
    setSelected(cardKey(post))
    setSeen((s) => markSeen(s, cardKey(post)))
    if (mobile) setPostDrawer(true)
  }
  const pick = (post: Post) => {
    const q = courseOf.get(post.course_id)?.archived ? 'archived' : 'all'
    setPalette(false)
    setQueue(q)
    // The page the post is on.
    setPageIndex(Math.floor(sorted.filter((p) => inQueue(q, p)).indexOf(post) / limit))
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
    // The sidebar keeps inbox7's tokens; the list and post panels are the Mail UI's, on the app's tokens.
    <div className='flex min-h-0 flex-1 overflow-hidden border-t bg-background text-foreground'>
      <aside className='inbox7 hidden w-56 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground md:flex'>
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
              <Fragment key={q.key}>
                {/* Mail is its own page: linked between Materials and Archived. */}
                {q.key === 'archived' && canMail && (
                  <>
                    <NavButton
                      icon={Mail}
                      label={t('nav.mail')}
                      count={mailLabels.find((l) => l.id === 'INBOX')?.count ?? undefined}
                      active={queue === 'mail:INBOX'}
                      onClick={() => pickQueue('mail:INBOX')}
                    />
                    {/* The other mailboxes and the labels, while Mail is open. */}
                    {mailbox && (
                      <div className='flex flex-col gap-1 ps-4'>
                        <a href={GMAIL_COMPOSE_URL} target='_blank' rel='noreferrer' className={NAV_ROW}>
                          <SquarePen className='size-4 shrink-0' />
                          <span className='min-w-0 flex-1 truncate'>{t('mail.compose')}</span>
                        </a>
                        {mailLabels
                          .filter((l) => l.id !== 'INBOX')
                          .map((l) => (
                            <MailNavRow
                              key={l.id}
                              label={l}
                              index={mail.labels!.labels.indexOf(l)}
                              name={labelName(t, l)}
                              active={mailbox === l.id}
                              onClick={() => pickQueue(`mail:${l.id}`)}
                            />
                          ))}
                      </div>
                    )}
                  </>
                )}
                <NavButton
                  icon={q.icon}
                  label={queueLabel(q.key)}
                  count={unreadIn(q.key)}
                  active={queue === q.key}
                  onClick={() => pickQueue(q.key)}
                />
              </Fragment>
            ))}
          </div>
          <div className='mt-4 mb-1 flex items-center justify-between gap-2 ps-2'>
            <p className='text-xs font-medium text-muted-foreground'>{t('dashboard.tags')}</p>
            <TagSortMenu prefs={tagPrefs} onChange={changePrefs} />
          </div>
          <div className='flex flex-col gap-1 pb-2'>
            {buckets.map((tag) => (
              <TagNavRow
                key={tag.id}
                tag={tag}
                active={queue === `tag:${tag.id}`}
                onClick={() => pickQueue(`tag:${tag.id}`)}
                onEdit={() => setEditing(tag)}
              />
            ))}
            {!tags.length && <p className='px-2 py-1 text-xs text-muted-foreground'>{t('dashboard.noTags')}</p>}
          </div>
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
                <Fragment key={q.key}>
                  {q.key === 'archived' && canMail && (
                    <DropdownMenuItem onSelect={() => pickQueue('mail:INBOX')}>
                      <Mail className='size-4' />
                      {t('nav.mail')}
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onSelect={() => pickQueue(q.key)}>
                    <q.icon className='size-4' />
                    {queueLabel(q.key)}
                  </DropdownMenuItem>
                </Fragment>
              ))}
              {mailLabels.length > 1 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className='text-xs font-medium text-muted-foreground'>{t('nav.mail')}</DropdownMenuLabel>
                  {mailLabels
                    .filter((l) => l.id !== 'INBOX')
                    .map((l) => {
                      const Icon = MAILBOX_ICONS[l.id]
                      return (
                        <DropdownMenuItem key={l.id} onSelect={() => pickQueue(`mail:${l.id}`)}>
                          {Icon ? (
                            <Icon className='size-4' />
                          ) : (
                            <LabelDot label={l} index={mail.labels!.labels.indexOf(l)} className='mx-1 size-2' />
                          )}
                          <span className='truncate'>{labelName(t, l)}</span>
                        </DropdownMenuItem>
                      )
                    })}
                </>
              )}
              {!!buckets.length && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className='text-xs font-medium text-muted-foreground'>
                    {t('dashboard.tags')}
                  </DropdownMenuLabel>
                  {buckets.map((tag) => (
                    <DropdownMenuItem key={tag.id} onSelect={() => pickQueue(`tag:${tag.id}`)}>
                      <TagDot color={tag.color} />
                      <span className='truncate'>{tag.name}</span>
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
            {mailbox ? (
              mail.labels?.granted ? (
                <MailList
                  {...mail.list}
                  title={queueLabel(queue)}
                  onSelect={(item) => {
                    mail.list.onSelect(item)
                    if (mobile) setPostDrawer(true)
                  }}
                />
              ) : mail.labels ? (
                <Alert className='m-4 w-auto'>
                  <AlertDescription className='flex flex-col items-start gap-3'>
                    {t('mail.notGranted')}
                    <Button asChild size='sm' variant='outline'>
                      <Link to='/settings'>{t('mail.goToSettings')}</Link>
                    </Button>
                  </AlertDescription>
                </Alert>
              ) : mail.labelsError ? (
                <p role='alert' className='p-4 text-sm text-destructive'>
                  {mail.labelsError}
                </p>
              ) : (
                <div className='flex flex-col gap-2 p-4'>
                  <Skeleton className='h-4 w-3/4' />
                  <Skeleton className='h-3 w-full' />
                </div>
              )
            ) : (
            <>
            <ListHeader title={queueLabel(queue)}>
              {!!inList.length && (
                <Pager
                  range={t('dashboard.range', {
                    from: pageAt * limit + 1,
                    to: pageAt * limit + items.length,
                    total: inList.length,
                  })}
                  onPrev={pageAt > 0 ? () => (setPageIndex(pageAt - 1), setSelected(null)) : undefined}
                  onNext={pageAt < pages - 1 ? () => (setPageIndex(pageAt + 1), setSelected(null)) : undefined}
                />
              )}
            </ListHeader>
            <ScrollArea className='relative min-h-0 flex-1'>
              <div className='flex flex-col p-3'>
              {!posts ? (
                [...Array(6)].map((_, i) => (
                  <div key={i} className='flex gap-3 p-3'>
                    <Skeleton className='size-10 rounded-full' />
                    <div className='flex flex-1 flex-col gap-2'>
                      <Skeleton className='h-4 w-1/2' />
                      <Skeleton className='h-3 w-3/4' />
                      <Skeleton className='h-3 w-full' />
                    </div>
                  </div>
                ))
              ) : !items.length ? (
                <p className='p-6 text-center text-sm text-muted-foreground'>{t('dashboard.empty')}</p>
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
              </div>
            </ScrollArea>
            </>
            )}
          </div>

          {mailbox && !mobile && mail.labels?.granted ? (
            <div className='hidden min-h-0 min-w-0 flex-1 flex-col md:flex'>
              <MailDisplay {...mail.display} />
            </div>
          ) : (
            !mailbox &&
            shown &&
            !mobile && (
              <div className='hidden min-h-0 min-w-0 flex-1 md:flex'>
                <Conversation {...shown} />
              </div>
            )
          )}
        </div>
      </div>

      <TagEditDialog tag={editing} onClose={() => setEditing(null)} />

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

      <Drawer open={mobile && postDrawer && (mailbox ? !!mail.selectedId : !!shown)} onOpenChange={setPostDrawer}>
        <DrawerContent className='h-[90vh] bg-background text-sm text-foreground'>
          <DrawerHeader className='sr-only'>
            <DrawerTitle>{t('dashboard.post')}</DrawerTitle>
            <DrawerDescription>{current?.title}</DrawerDescription>
          </DrawerHeader>
          {mailbox ? (
            <div className='flex h-full min-h-0 flex-col'>
              <MailDisplay {...mail.display} />
            </div>
          ) : (
            shown && (
              <div className='flex h-full min-h-0 flex-col'>
                <Conversation {...shown} />
              </div>
            )
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
      className={cn(NAV_ROW, active && 'bg-sidebar-accent font-medium')}
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

/** A Gmail mailbox (its icon) or label (its dot) under Mail in the sidebar. */
function MailNavRow({
  label,
  index,
  name,
  active,
  onClick,
}: {
  label: MailLabel
  index: number
  name: string
  active: boolean
  onClick: () => void
}) {
  const Icon = MAILBOX_ICONS[label.id]
  return (
    <button
      type='button'
      aria-current={active || undefined}
      onClick={onClick}
      className={cn(NAV_ROW, active && 'bg-sidebar-accent font-medium')}
    >
      <span className='flex size-4 shrink-0 items-center justify-center'>
        {Icon ? <Icon className='size-4' /> : <LabelDot label={label} index={index} className='size-2' />}
      </span>
      <span className='min-w-0 flex-1 truncate'>{name}</span>
      {!!label.count && (
        <Badge variant='secondary' className={SMALL_BADGE}>
          {label.count}
        </Badge>
      )}
    </button>
  )
}

/** A tag in the sidebar: its dot and name choose it, the pencil edits it. */
function TagNavRow({ tag, active, onClick, onEdit }: { tag: Tag; active: boolean; onClick: () => void; onEdit: () => void }) {
  const { t } = useTranslation()
  return (
    <div className={cn('flex h-8 items-center rounded-md hover:bg-sidebar-accent', active && 'bg-sidebar-accent')}>
      <button
        type='button'
        aria-current={active || undefined}
        onClick={onClick}
        className={cn(
          'flex h-full min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
          active && 'font-medium'
        )}
      >
        <span className='flex size-4 shrink-0 items-center justify-center'>
          <TagDot color={tag.color} />
        </span>
        <span className='min-w-0 flex-1 truncate'>{tag.name}</span>
      </button>
      <Button
        variant='ghost'
        size='icon'
        className='me-1 size-6 shrink-0 text-muted-foreground hover:text-foreground'
        aria-label={t('tags.editNamed', { name: tag.name })}
        onClick={onEdit}
      >
        <Pencil className='size-3.5' />
      </Button>
    </div>
  )
}

/** Sort, order and how many tags the sidebar lists; kept per device. */
function TagSortMenu({ prefs, onChange }: { prefs: TagListPrefs; onChange: (next: Partial<TagListPrefs>) => void }) {
  const { t } = useTranslation()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant='ghost' size='icon' className='size-6 text-muted-foreground' aria-label={t('dashboard.tagSort.label')}>
          <ArrowUpDown className='size-3.5' />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end' className='inbox7 w-48'>
        <DropdownMenuLabel className='text-xs font-medium text-muted-foreground'>{t('dashboard.tagSort.sortBy')}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={prefs.sort} onValueChange={(sort) => onChange({ sort: sort as TagListPrefs['sort'] })}>
          {TAG_SORTS.map((sort) => (
            <DropdownMenuRadioItem key={sort} value={sort}>
              {t(`dashboard.tagSort.${sort}`)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className='text-xs font-medium text-muted-foreground'>{t('dashboard.tagSort.order')}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={prefs.order} onValueChange={(order) => onChange({ order: order as TagListPrefs['order'] })}>
          <DropdownMenuRadioItem value='asc'>{t('dashboard.tagSort.asc')}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value='desc'>{t('dashboard.tagSort.desc')}</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className='text-xs font-medium text-muted-foreground'>{t('dashboard.tagSort.show')}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={String(prefs.limit)} onValueChange={(limit) => onChange({ limit: Number(limit) })}>
          {TAG_LIMITS.map((limit) => (
            <DropdownMenuRadioItem key={limit} value={String(limit)}>
              {limit ? t('dashboard.tagSort.latest', { count: limit }) : t('common.all')}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to='/settings/tags'>{t('dashboard.tagSort.manage')}</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** A post in the list, drawn as a mail conversation is: who, when, its title and course. */
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
  const Icon = POST_ICON[post.type]
  const courseName = course?.name ?? post.course_id
  return (
    <InboxItem
      avatar={<PersonAvatar author={author} courseName={courseName} className='size-10 shrink-0' />}
      name={author ? author.full_name || author.user_id : courseName}
      badges={<Icon className='size-3.5 shrink-0 text-muted-foreground' aria-label={t(`courses.${post.type}`)} />}
      time={timeAgo(post.time, i18n.language)}
      timeTitle={fullTimestamp(post.time)}
      subject={post.title}
      snippet={`${courseName} · ${t(`courses.${post.type}`)}`}
      unread={unread}
      selected={selected}
      onSelect={onSelect}
    />
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

/** The post panel, in the Mail UI's layout: a toolbar with the tag button (and the
 *  attachments icon when it has some), who posted it, and its text and attachments. */
function Conversation({ post, course, author, status, detail }: Shown) {
  const { t, i18n } = useTranslation()
  const attachmentsRef = useRef<HTMLDivElement>(null)
  const courseName = course?.name ?? post.course_id
  const name = author ? author.full_name || author.user_id : courseName
  const role = author?.role === 'teacher' || author?.role === 'student' ? author.role : undefined
  // An announcement's title is its first line: not shown twice.
  const lines = (detail?.text ?? '').trim().split('\n')
  const body = (post.type === 'announcement' && lines[0] === post.title ? lines.slice(1) : lines).join('\n').trim()
  const attachments = detail?.attachments ?? []
  const type = t(`courses.${post.type}`)

  return (
    <div className='flex h-full min-h-0 min-w-0 flex-1 flex-col bg-background'>
      <DetailToolbar>
        <TagColorPicker target={`post:${cardKey(post)}`} />
        {!!attachments.length && (
          <IconButton
            className='ms-auto'
            label={t('classwork.attachments', { count: attachments.length })}
            onClick={() => attachmentsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          >
            <Paperclip />
          </IconButton>
        )}
      </DetailToolbar>
      <DetailHeader
        avatar={<PersonAvatar author={author} courseName={courseName} className='size-8' />}
        title={post.title}
        aside={
          <span title={fullTimestamp(post.time)}>
            {new Intl.DateTimeFormat(i18n.language, {
              month: 'short',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
            }).format(new Date(post.time))}
          </span>
        }
      >
        <div className='mt-1 flex items-center gap-2'>
          <span className='text-sm font-medium text-foreground'>{name}</span>
          {role && (
            <Badge variant='secondary' className={SMALL_BADGE}>
              {t(`dashboard.roles.${role}`)}
            </Badge>
          )}
        </div>
        <p className='mt-0.5 text-xs text-muted-foreground'>{author ? `${courseName} · ${type}` : type}</p>
        {(detail?.due || status) && (
          <div className='mt-2 flex flex-wrap items-center gap-2'>
            {detail?.due && (
              <Badge
                variant='outline'
                className='h-5 rounded-4xl border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300'
              >
                {t('dashboard.due', { date: detail.due })}
              </Badge>
            )}
            {status && (
              <Badge variant='outline' className='h-5 gap-1.5 rounded-4xl'>
                <span className={cn('size-2 rounded-full', DOT[status])} />
                {t(`dashboard.submission.${status}`)}
              </Badge>
            )}
          </div>
        )}
      </DetailHeader>
      {!detail ? (
        <div className='flex flex-col gap-3 p-6'>
          <Skeleton className='h-4 w-full' />
          <Skeleton className='h-4 w-5/6' />
          <Skeleton className='h-4 w-2/3' />
        </div>
      ) : (
        <div className='min-h-0 flex-1 overflow-auto p-3'>
          <div className='flex flex-col gap-5 px-3 pt-2'>
            {body ? (
              // Classroom text keeps its line breaks and long links.
              <p className='text-sm leading-relaxed wrap-anywhere whitespace-pre-wrap text-foreground/80'>{body}</p>
            ) : (
              <p className='text-sm text-muted-foreground'>{t('classwork.noDescription')}</p>
            )}
            {(!!attachments.length || post.alternate_link) && (
              <div
                ref={attachmentsRef}
                className='flex scroll-mt-3 flex-col gap-3 border-t pt-5'
                aria-label={attachments.length ? t('classwork.attachments', { count: attachments.length }) : undefined}
              >
                {attachments.map((att) => (
                  <AttachmentView key={att.id} att={att} />
                ))}
                {post.alternate_link && (
                  <Button variant='outline' className='h-9 w-fit gap-2 px-2.5' asChild>
                    <a href={post.alternate_link} target='_blank' rel='noreferrer'>
                      <ExternalLink className='size-4' />
                      {t('courses.openInClassroom')}
                    </a>
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
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
