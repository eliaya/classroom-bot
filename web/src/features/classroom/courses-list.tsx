import { useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Main } from '@/components/layout/main'
import { api, type Course } from '@/lib/api'
import { ClassroomHeader } from './layout-header'

export function CoursesListPage() {
  const [courses, setCourses] = useState<Course[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .listCourses()
      .then((res) => setCourses(res.items))
      .catch((e) => setError(e instanceof Error ? e.message : 'Load failed'))
  }, [])

  return (
    <>
      <ClassroomHeader title='Courses' />
      <Main>
        <Card>
          <CardHeader>
            <CardTitle>Google Classroom courses</CardTitle>
            <CardDescription>Data from local SQL cache</CardDescription>
          </CardHeader>
          <CardContent>
            {error && <p className='mb-4 text-destructive text-sm'>{error}</p>}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Section</TableHead>
                  <TableHead>ID</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {courses.map((course) => (
                  <TableRow key={course.id}>
                    <TableCell className='font-medium'>{course.name}</TableCell>
                    <TableCell>{course.section || '—'}</TableCell>
                    <TableCell className='font-mono text-xs'>{course.id}</TableCell>
                    <TableCell className='flex flex-wrap gap-2'>
                      <Button size='sm' variant='outline' asChild>
                        <Link to='/courses/$courseId/stream' params={{ courseId: course.id }}>
                          Stream
                        </Link>
                      </Button>
                      <Button size='sm' variant='outline' asChild>
                        <Link to='/courses/$courseId/classwork' params={{ courseId: course.id }}>
                          Classwork
                        </Link>
                      </Button>
                      <Button size='sm' variant='outline' asChild>
                        <Link to='/courses/$courseId/people' params={{ courseId: course.id }}>
                          People
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </Main>
    </>
  )
}