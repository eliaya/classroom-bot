import { useEffect, useState } from 'react'
import { getRouteApi } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Main } from '@/components/layout/main'
import { api, type Course } from '@/lib/api'
import { CoursesTable } from './components/courses-table'
import { ClassroomHeader } from './layout-header'

const route = getRouteApi('/_authenticated/courses/')

export function CoursesListPage() {
  const { t } = useTranslation()
  const search = route.useSearch()
  const navigate = route.useNavigate()
  const [courses, setCourses] = useState<Course[]>([])
  const [error, setError] = useState<string | null>(null)
  const [selectedCourse, setSelectedCourse] = useState<Course | null>(null)

  useEffect(() => {
    api
      .listCourses()
      .then((res) => setCourses(res.items))
      .catch((e) => setError(e instanceof Error ? e.message : t('common.loadFailed')))
  }, [])

  return (
    <>
      <ClassroomHeader
        fixed
        title={t('courses.title')}
        description={t('courses.desc')}
      />
      <Main fluid className='flex flex-1 flex-col gap-4 sm:gap-6'>
        {error && (
          <p className='text-destructive text-sm'>{error}</p>
        )}
        <CoursesTable
          data={courses}
          search={search}
          navigate={navigate}
          selectedCourse={selectedCourse}
          onSelectCourse={setSelectedCourse}
        />
      </Main>
    </>
  )
}