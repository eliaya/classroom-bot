import { useEffect, useState } from 'react'
import { Link, Outlet, useRouterState } from '@tanstack/react-router'
import { ExternalLink } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Main } from '@/components/layout/main'
import { api } from '@/lib/api'
import { ClassroomHeader } from './layout-header'

type CourseLayoutProps = {
  courseId: string
}

export function CourseLayout({ courseId }: CourseLayoutProps) {
  const { t } = useTranslation()
  const [courseName, setCourseName] = useState(courseId)
  const [alternateLink, setAlternateLink] = useState<string | null>(null)
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  useEffect(() => {
    api
      .getCourse(courseId)
      .then((course) => {
        setCourseName(course.name)
        setAlternateLink(course.alternate_link ?? null)
      })
      .catch(() => {
        setCourseName(courseId)
      })
  }, [courseId])

  const isStream = pathname.endsWith('/stream')
  const isClasswork = pathname.endsWith('/classwork')
  const isPeople = pathname.endsWith('/people')

  const topNav = [
    {
      title: t('courses.stream'),
      href: `/courses/${courseId}/stream`,
      isActive: isStream,
    },
    {
      title: t('courses.classwork'),
      href: `/courses/${courseId}/classwork`,
      isActive: isClasswork,
    },
    {
      title: t('courses.people'),
      href: `/courses/${courseId}/people`,
      isActive: isPeople,
    },
  ]

  return (
    <>
      <ClassroomHeader topNav={topNav} fixed />
      <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>
        <div className='flex flex-wrap items-start justify-between gap-2'>
          <div>
            <p className='text-muted-foreground text-sm'>
              <Link to='/courses' className='hover:underline'>
                {t('courses.title')}
              </Link>
              {' / '}
              <span className='text-foreground'>{courseName}</span>
            </p>
            <h2 className='text-2xl font-bold tracking-tight'>{courseName}</h2>
          </div>
          {alternateLink && (
            <Button variant='outline' size='sm' asChild>
              <a href={alternateLink} target='_blank' rel='noreferrer'>
                <ExternalLink className='me-2 h-4 w-4' />
                {t('courses.openInClassroom')}
              </a>
            </Button>
          )}
        </div>
        <Outlet />
      </Main>
    </>
  )
}