import { useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Archive, ArchiveRestore, CircleAlert, Star } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { api, type Course, type Post } from '@/lib/api'
import { cn, weekdayLabel } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { CourseClassworkPage } from '../course-classwork'
import { CoursePeoplePage } from '../course-people'
import { CourseStreamPage } from '../course-stream'

/** `today`: held on today's weekday. `active`: updated in the period. `quiet`: neither. */
export type CourseStatus = 'today' | 'active' | 'quiet'

/** A course with its activity in the selected period. */
export type CourseRow = {
  course: Course
  updates: number
  announcements: number
  coursework: number
  materials: number
  /** Time of the latest update (ms), or null when there is none. */
  last: number | null
  status: CourseStatus
  /** The period's posts are still loading: the counts are not known yet. */
  pending: boolean
}

const STATUS_STYLES: Record<CourseStatus, string> = {
  today: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  active: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  quiet: 'bg-rose-500/10 text-rose-700 dark:text-rose-400',
}

export function StatusBadge({ status }: { status: CourseStatus }) {
  const { t } = useTranslation()
  return (
    <span
      className={cn(
        'inline-flex h-5 w-fit items-center gap-1 rounded-full px-2 text-xs whitespace-nowrap',
        STATUS_STYLES[status]
      )}
    >
      {status === 'today' && <Star className='size-3' aria-hidden='true' />}
      {status === 'quiet' && <CircleAlert className='size-3' aria-hidden='true' />}
      {t(`courses.statusName.${status}`)}
    </span>
  )
}

function Section({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <section className='rounded-lg border bg-background p-4'>
      <h3 className='text-sm font-medium'>{title}</h3>
      <p className='mt-1 text-xs text-muted-foreground'>{description}</p>
      <div className='mt-4'>{children}</div>
    </section>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className='min-w-0'>
      <dt className='text-xs text-muted-foreground'>{label}</dt>
      <dd className='mt-1 truncate text-sm font-medium'>{children}</dd>
    </div>
  )
}

type CourseSheetProps = {
  row: CourseRow | null
  /** Name of the period the counts cover, e.g. "Last 90 days". */
  periodLabel: string
  relative: (time: string) => string
  onClose: () => void
  /** Archive (true) or restore (false) the course: hidden from the dashboard and calendar. */
  onArchive: (archived: boolean) => void
}

const TABS = ['general', 'classwork', 'stream', 'people'] as const

/** Wide side sheet with one course's details, classwork, stream and people.
 * Read-only but for archiving, which changes this app only: courses come from Google Classroom. */
export function CourseSheet({ row, periodLabel, relative, onClose, onArchive }: CourseSheetProps) {
  const { t, i18n } = useTranslation()
  // Loaded when the sheet opens, for this course only.
  const courseId = row?.course.id
  const [recent, setRecent] = useState<{ courseId: string; items: Post[] } | null>(null)
  useEffect(() => {
    if (!courseId) return
    // ponytail: every post of the course, newest 8 kept; add a limit to the API
    // if a course ever has thousands.
    api
      .listPosts(new Date(0).toISOString(), new Date(Date.now() + 86_400_000).toISOString(), courseId)
      .then((res) => setRecent({ courseId, items: res.items.slice(-8).reverse() }))
      .catch(() => setRecent({ courseId, items: [] }))
  }, [courseId])
  const recentItems = recent && recent.courseId === courseId ? recent.items : null
  const count = (n: number) => (row?.pending ? t('common.dash') : n)
  return (
    <Sheet open={row !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className='w-full gap-0 sm:max-w-3xl'>
        {row && (
          <>
            <SheetHeader className='border-b'>
              <SheetTitle className='pe-8 text-xl'>{row.course.name}</SheetTitle>
              <SheetDescription>{row.course.section || t('common.dash')}</SheetDescription>
            </SheetHeader>
            {/* key: every course opens on General. Inactive tabs are unmounted, so
                each one loads its data only when it is chosen. */}
            <Tabs key={row.course.id} defaultValue='general' className='min-h-0 flex-1 gap-0'>
              <div className='border-b px-4 py-2'>
                <TabsList className='w-full sm:w-fit'>
                  {TABS.map((tab) => (
                    <TabsTrigger key={tab} value={tab}>
                      {t(`courses.${tab}`)}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </div>
              <TabsContent value='general' className='flex flex-col gap-3 overflow-y-auto bg-muted/40 p-3'>
                <Section title={t('courses.basics')} description={t('courses.basicsDesc')}>
                  <dl className='grid grid-cols-2 gap-4'>
                    <Field label={t('courses.courseId')}>{row.course.id}</Field>
                    <Field label={t('courses.week')}>
                      {weekdayLabel(row.course.week, i18n.language) ?? t('common.dash')}
                    </Field>
                    <Field label={t('courses.state')}>{row.course.state || t('common.dash')}</Field>
                    <Field label={t('courses.status')}>
                      <StatusBadge status={row.status} />
                    </Field>
                  </dl>
                </Section>
                <Section
                  title={t('courses.activity')}
                  description={t('courses.activityDesc', { period: periodLabel })}
                >
                  <dl className='grid grid-cols-2 gap-4 sm:grid-cols-4'>
                    <Field label={t('courses.updates')}>{count(row.updates)}</Field>
                    <Field label={t('courses.announcements')}>{count(row.announcements)}</Field>
                    <Field label={t('courses.coursework')}>{count(row.coursework)}</Field>
                    <Field label={t('courses.materials')}>{count(row.materials)}</Field>
                  </dl>
                </Section>
                <Section title={t('courses.recent')} description={t('courses.recentDesc')}>
                  {recentItems === null ? (
                    <div className='flex flex-col gap-2'>
                      <Skeleton className='h-4 w-3/4' />
                      <Skeleton className='h-4 w-1/2' />
                    </div>
                  ) : recentItems.length ? (
                    <ul className='flex flex-col divide-y'>
                      {recentItems.map((post) => (
                        <li key={`${post.type}:${post.id}`} className='py-2 first:pt-0 last:pb-0'>
                          <a
                            href={post.alternate_link ?? undefined}
                            target='_blank'
                            rel='noreferrer'
                            className='block rounded-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring'
                          >
                            <span className='block truncate text-sm font-medium'>{post.title}</span>
                            <span className='block text-xs text-muted-foreground'>
                              {t(`courses.${post.type}`)} · {relative(post.time)}
                            </span>
                          </a>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className='text-sm text-muted-foreground'>{t('courses.noRecent')}</p>
                  )}
                </Section>
              </TabsContent>
              <TabsContent value='classwork' className='overflow-y-auto p-3'>
                <CourseClassworkPage courseId={row.course.id} />
              </TabsContent>
              <TabsContent value='stream' className='overflow-y-auto p-3'>
                <CourseStreamPage courseId={row.course.id} />
              </TabsContent>
              <TabsContent value='people' className='overflow-y-auto p-3'>
                <CoursePeoplePage courseId={row.course.id} />
              </TabsContent>
            </Tabs>
            <SheetFooter className='flex-row justify-between border-t'>
              <Button variant='ghost' onClick={onClose}>
                {t('common.close')}
              </Button>
              <div className='flex gap-2'>
                <Button variant='outline' onClick={() => onArchive(!row.course.archived)}>
                  {row.course.archived ? <ArchiveRestore aria-hidden='true' /> : <Archive aria-hidden='true' />}
                  {t(row.course.archived ? 'courses.unarchive' : 'courses.archive')}
                </Button>
                {row.course.alternate_link && (
                  <Button variant='outline' asChild>
                    <a href={row.course.alternate_link} target='_blank' rel='noreferrer'>
                      {t('courses.openInClassroom')}
                    </a>
                  </Button>
                )}
                <Button asChild>
                  <Link to='/courses/$courseId' params={{ courseId: row.course.id }}>
                    {t('courses.openCourse')}
                  </Link>
                </Button>
              </div>
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
