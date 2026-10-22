import { useEffect, useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { ExternalLink, Layers, SlidersHorizontal } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { api, type Attachment, type Course, type CoursePerson, type Post } from '@/lib/api'
import { useIsMobile } from '@/hooks/use-mobile'
import { cn, fullTimestamp } from '@/lib/utils'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { AttachmentView } from './components/attachment-view'
import { POST_ICON, cardKey, dashboardLimit, initials, shortAge } from './board-model'
import { TeacherAvatar } from './dashboard-board'

const DAY = 86_400_000
// inbox3's avatar: a hairline ring drawn over the photo.
const AVATAR =
  'size-8 after:absolute after:inset-0 after:rounded-full after:border after:border-border after:mix-blend-darken dark:after:mix-blend-lighten'

type Detail = { key: string; text?: string; due?: string; attachments?: Attachment[] }

/** Dashboard: the latest posts of every course in a list, the chosen one's
 * details beside it (the shadcnblocks inbox3 layout). */
export function DashboardInbox() {
  const { t } = useTranslation()
  const mobile = useIsMobile()
  const [posts, setPosts] = useState<Post[] | null>(null)
  const [courses, setCourses] = useState<Course[]>([])
  const [people, setPeople] = useState<CoursePerson[]>([])
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [limit] = useState(dashboardLimit)

  useEffect(() => {
    // shortcut: loads every post and slices here; add a server-side limit if it gets slow.
    Promise.all([api.listCourses(), api.listPosts(new Date(0).toISOString(), new Date(Date.now() + DAY).toISOString())])
      .then(([coursesRes, postsRes]) => {
        setCourses(coursesRes.items)
        setPosts(postsRes.items)
      })
      .catch((e) => setError(e instanceof Error ? e.message : t('common.loadFailed')))
    // An extra: without it the rows show no author.
    api
      .listPeople()
      .then((res) => setPeople(res.items))
      .catch(() => undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const courseOf = useMemo(() => new Map(courses.map((c) => [c.id, c])), [courses])
  const personOf = useMemo(() => new Map(people.map((p) => [`${p.course_id}:${p.user_id}`, p])), [people])
  const authorOf = (post: Post) => personOf.get(`${post.course_id}:${post.creator_user_id}`)

  // Newest first; archived courses stay out, as on the board.
  const items = useMemo(
    () =>
      (posts ?? [])
        .filter((p) => !courseOf.get(p.course_id)?.archived)
        .sort((a, b) => b.time.localeCompare(a.time))
        .slice(0, limit),
    [posts, courseOf, limit]
  )

  // A wide screen always shows one; a phone opens one in a sheet.
  const current = items.find((p) => cardKey(p) === selected) ?? (mobile ? undefined : items[0])

  if (error) {
    return (
      <p role='alert' className='p-4 text-sm text-destructive'>
        {error}
      </p>
    )
  }

  const detail = current && (
    <PostDetail post={current} course={courseOf.get(current.course_id)} author={authorOf(current)} />
  )

  return (
    <div className='inbox3 flex min-h-0 flex-1 overflow-hidden border-t bg-background text-foreground'>
      <section className='flex min-h-0 w-full min-w-0 flex-col border-r md:w-[42.857%] md:max-w-[42.857%]'>
        <header className='flex h-10 shrink-0 items-center justify-between border-b px-4'>
          <div className='flex items-center gap-2'>
            <h2 className='text-lg font-semibold'>{t('dashboard.latest')}</h2>
          </div>
          <div className='flex items-center gap-2'>
            <Button variant='ghost' size='sm' className='size-7 gap-1 rounded-[min(var(--radius-md),10px)] p-0 has-[>svg]:p-0' asChild>
              <Link to='/settings/language'>
                <SlidersHorizontal />
                <span className='sr-only'>{t('dashboard.display')}</span>
              </Link>
            </Button>
          </div>
        </header>
        <ScrollArea className='relative min-h-0 flex-1'>
          {!posts ? (
            <div className='flex flex-col gap-1 p-1'>
              {[...Array(6)].map((_, i) => (
                <Skeleton key={i} className='h-14 rounded-lg' />
              ))}
            </div>
          ) : !items.length ? (
            <div className='flex flex-col items-center gap-2 px-3 py-12 text-center'>
              <Layers className='size-6 text-muted-foreground' aria-hidden='true' />
              <p className='text-sm font-medium'>{t('dashboard.empty')}</p>
            </div>
          ) : (
            <div className='flex flex-col pb-1'>
              {items.map((post) => (
                <PostRow
                  key={cardKey(post)}
                  post={post}
                  course={courseOf.get(post.course_id)}
                  author={authorOf(post)}
                  selected={post === current}
                  onSelect={() => setSelected(cardKey(post))}
                />
              ))}
            </div>
          )}
        </ScrollArea>
      </section>

      {mobile ? (
        <Sheet open={!!current} onOpenChange={(open) => !open && setSelected(null)}>
          <SheetContent className='inbox3 w-full gap-0 p-0 text-foreground'>
            <SheetTitle className='sr-only'>{current?.title}</SheetTitle>
            <SheetDescription className='sr-only'>{courseOf.get(current?.course_id ?? '')?.name}</SheetDescription>
            {detail}
          </SheetContent>
        </Sheet>
      ) : (
        <section className='hidden min-h-0 min-w-0 flex-1 md:block'>{detail}</section>
      )}
    </div>
  )
}

function PostRow({
  post,
  course,
  author,
  selected,
  onSelect,
}: {
  post: Post
  course?: Course
  author?: CoursePerson
  selected: boolean
  onSelect: () => void
}) {
  const { t, i18n } = useTranslation()
  const Icon = POST_ICON[post.type]
  const courseName = course?.name ?? post.course_id
  return (
    <button
      type='button'
      aria-current={selected || undefined}
      onClick={onSelect}
      className='w-full rounded-lg px-1 py-0.5 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50'
    >
      <div
        className={cn(
          'flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-sidebar/80',
          selected && 'bg-accent/80'
        )}
      >
        <div className='shrink-0'>
          {author ? (
            <TeacherAvatar person={author} className={AVATAR} />
          ) : (
            <Avatar className={AVATAR}>
              <AvatarFallback className='text-xs text-muted-foreground'>{initials(courseName)}</AvatarFallback>
            </Avatar>
          )}
        </div>
        <div className='min-w-0 flex-1'>
          <div className='flex items-center gap-1.5'>
            <span className='max-w-[40%] shrink-0 truncate text-sm font-medium text-muted-foreground'>{courseName}</span>
            <h4 className='min-w-0 flex-1 truncate text-sm font-medium text-foreground'>{post.title}</h4>
            <div className='shrink-0'>
              <Icon
                className={cn('size-3.5', selected ? 'text-primary/80' : 'text-primary')}
                aria-label={t(`courses.${post.type}`)}
              />
            </div>
          </div>
          <div className='flex items-center justify-between gap-1.5'>
            <p className='min-w-0 truncate text-sm text-muted-foreground'>
              {author?.full_name || t(`courses.${post.type}`)}
            </p>
            <span className='shrink-0 text-xs text-muted-foreground' title={fullTimestamp(post.time)}>
              {shortAge(post.time, i18n.language)}
            </span>
          </div>
        </div>
      </div>
    </button>
  )
}

/** The post's text, due date and attachments, fetched with its course's stream or classwork. */
function PostDetail({ post, course, author }: { post: Post; course?: Course; author?: CoursePerson }) {
  const { t, i18n } = useTranslation()
  const key = cardKey(post)
  const [detail, setDetail] = useState<Detail | null>(null)

  useEffect(() => {
    let live = true
    const load =
      post.type === 'announcement'
        ? api
            .getStream(post.course_id, 1000)
            .then((res) => ({ key, text: res.items.find((i) => i.type === 'announcement' && i.id === post.id)?.text }))
        : api.getClasswork(post.course_id).then((res) => {
            const item = [...res.coursework, ...res.materials].find((i) => i.id === post.id)
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
  }, [key, post.type, post.id, post.course_id, i18n.language])

  const Icon = POST_ICON[post.type]
  const courseName = course?.name ?? post.course_id
  const loading = detail?.key !== key
  // An announcement's title is its first line: not shown twice.
  const lines = (detail?.text ?? '').trim().split('\n')
  const body = (post.type === 'announcement' && lines[0] === post.title ? lines.slice(1) : lines).join('\n').trim()
  const attachments = detail?.attachments

  return (
    <div className='flex h-full min-w-0 flex-col'>
      {/* pe-12 keeps clear of the sheet's close button on a phone. */}
      <header className='flex h-10 shrink-0 items-center justify-between border-b px-4 pe-12 md:pe-4'>
        <div className='flex min-w-0 items-center gap-3'>
          <span className='truncate text-sm font-medium'>{courseName}</span>
        </div>
        {post.alternate_link && (
          <Button variant='outline' size='sm' className='h-7 gap-1 rounded-[min(var(--radius-md),10px)] px-2.5' asChild>
            <a href={post.alternate_link} target='_blank' rel='noreferrer'>
              <ExternalLink />
              {t('courses.openInClassroom')}
            </a>
          </Button>
        )}
      </header>
      <ScrollArea className='min-h-0 flex-1'>
        <div className='mx-auto flex w-full max-w-[760px] flex-col gap-5 px-8 pt-12 pb-10'>
          <div className='flex flex-wrap items-center gap-2 text-xs text-muted-foreground'>
            <span className='font-medium text-foreground'>{courseName}</span>
            <span className='text-muted-foreground/60'>·</span>
            <span className='inline-flex items-center gap-1.5'>
              <Icon className='size-3.5 text-primary/80' aria-hidden='true' />
              {t(`courses.${post.type}`)}
            </span>
            <span className='text-muted-foreground/60'>·</span>
            <span title={fullTimestamp(post.time)}>
              {author ? `${author.full_name || author.user_id} · ` : ''}
              {shortAge(post.time, i18n.language)}
            </span>
          </div>
          <div className='flex flex-col gap-2.5'>
            <h3 className='text-[1.5rem] leading-tight font-semibold wrap-anywhere text-foreground md:text-[1.625rem]'>
              {post.title}
            </h3>
            {detail?.due && (
              <p className='text-sm leading-6 text-muted-foreground'>{t('dashboard.due', { date: detail.due })}</p>
            )}
          </div>
          {loading ? (
            <div className='flex max-w-[68ch] flex-col gap-2'>
              <Skeleton className='h-4 w-full' />
              <Skeleton className='h-4 w-5/6' />
              <Skeleton className='h-4 w-2/3' />
            </div>
          ) : (
            <>
              <div className='max-w-[68ch]'>
                {body ? (
                  // Classroom text keeps its line breaks and long links.
                  <p className='text-sm leading-6 wrap-anywhere whitespace-pre-wrap text-foreground'>{body}</p>
                ) : (
                  post.type !== 'announcement' && (
                    <p className='text-sm leading-6 text-muted-foreground italic'>{t('classwork.noDescription')}</p>
                  )
                )}
              </div>
              {!!attachments?.length && (
                <div className='flex max-w-[72ch] flex-col gap-6'>
                  <section className='flex flex-col gap-3'>
                    <h4 className='text-base font-semibold text-foreground'>
                      {t('classwork.attachments', { count: attachments.length })}
                    </h4>
                    {attachments.map((att) => (
                      <AttachmentView key={att.id} att={att} />
                    ))}
                  </section>
                </div>
              )}
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
