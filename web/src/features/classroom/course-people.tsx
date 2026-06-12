import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Main } from '@/components/layout/main'
import { api } from '@/lib/api'
import { ClassroomHeader } from './layout-header'

export function CoursePeoplePage({ courseId }: { courseId: string }) {
  const [courseName, setCourseName] = useState(courseId)
  const [people, setPeople] = useState<
    Array<{ user_id: string; role: string; full_name?: string; email?: string }>
  >([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([api.getCourse(courseId), api.getPeople(courseId)])
      .then(([course, res]) => {
        setCourseName(course.name)
        setPeople(res.items)
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Load failed'))
  }, [courseId])

  return (
    <>
      <ClassroomHeader title={`People · ${courseName}`} />
      <Main>
        <Card>
          <CardHeader>
            <CardTitle>Teachers & students</CardTitle>
          </CardHeader>
          <CardContent>
            {error && <p className='mb-4 text-destructive text-sm'>{error}</p>}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {people.map((p) => (
                  <TableRow key={`${p.role}-${p.user_id}`}>
                    <TableCell>{p.full_name || p.user_id}</TableCell>
                    <TableCell>{p.email || '—'}</TableCell>
                    <TableCell>
                      <Badge variant='outline'>{p.role}</Badge>
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