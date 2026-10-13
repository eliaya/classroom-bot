import { Link } from '@tanstack/react-router'
import { CircleAlert, Star } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { type Course, type Post } from '@/lib/api'
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
  recent: Post[]
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
}

/** Wide side sheet with one course's details. Read-only: courses come from Google Classroom. */
export function CourseSheet({ row, periodLabel, relative, onClose }: CourseSheetProps) {
  const { t, i18n } = useTranslation()
  return (
    <Sheet open={row !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className='w-full gap-0 sm:max-w-xl'>
        {row && (
          <>
            <SheetHeader className='border-b'>
              <SheetTitle className='pe-8 text-xl'>{row.course.name}</SheetTitle>
              <SheetDescription>{row.course.section || t('common.dash')}</SheetDescription>
            </SheetHeader>
            <div className='flex flex-1 flex-col gap-3 overflow-y-auto bg-muted/40 p-3'>
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
                  <Field label={t('courses.updates')}>{row.updates}</Field>
                  <Field label={t('courses.announcements')}>{row.announcements}</Field>
                  <Field label={t('courses.coursework')}>{row.coursework}</Field>
                  <Field label={t('courses.materials')}>{row.materials}</Field>
                </dl>
              </Section>
              <Section title={t('courses.recent')} description={t('courses.recentDesc')}>
                {row.recent.length ? (
                  <ul className='flex flex-col divide-y'>
                    {row.recent.map((post) => (
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
            </div>
            <SheetFooter className='flex-row justify-between border-t'>
              <Button variant='ghost' onClick={onClose}>
                {t('common.close')}
              </Button>
              <Button asChild>
                <Link to='/courses/$courseId' params={{ courseId: row.course.id }}>
                  {t('courses.openCourse')}
                </Link>
              </Button>
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
