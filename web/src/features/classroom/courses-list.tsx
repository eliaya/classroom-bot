import { useEffect, useState } from 'react'
import { getRouteApi } from '@tanstack/react-router'
import { Main } from '@/components/layout/main'
import { api, type Course } from '@/lib/api'
import { CoursesTable } from './components/courses-table'
import { ClassroomHeader } from './layout-header'

const route = getRouteApi('/_authenticated/courses/')

export function CoursesListPage() {
  const search = route.useSearch()
  const navigate = route.useNavigate()
  const [courses, setCourses] = useState<Course[]>([])
  const [error, setError] = useState<string | null>(null)
  const [selectedCourse, setSelectedCourse] = useState<Course | null>(null)

  useEffect(() => {
    api
      .listCourses()
      .then((res) => setCourses(res.items))
      .catch((e) => setError(e instanceof Error ? e.message : 'Load failed'))
  }, [])

  return (
    <>
      <ClassroomHeader fixed />
      <Main fluid className='flex flex-1 flex-col gap-4 sm:gap-6'>
        <div>
          <h2 className='text-2xl font-bold tracking-tight'>Courses</h2>
          <p className='text-muted-foreground'>
            Google Classroom courses from local SQL cache
          </p>
        </div>
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