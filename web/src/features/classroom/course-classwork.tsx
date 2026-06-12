import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Main } from '@/components/layout/main'
import { api } from '@/lib/api'
import { ClassroomHeader } from './layout-header'

export function CourseClassworkPage({ courseId }: { courseId: string }) {
  const [courseName, setCourseName] = useState(courseId)
  const [data, setData] = useState<{
    coursework: Array<Record<string, unknown>>
    topics: Array<Record<string, unknown>>
    materials: Array<Record<string, unknown>>
  } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([api.getCourse(courseId), api.getClasswork(courseId)])
      .then(([course, classwork]) => {
        setCourseName(course.name)
        setData(classwork)
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Load failed'))
  }, [courseId])

  return (
    <>
      <ClassroomHeader title={`Classwork · ${courseName}`} />
      <Main>
        {error && <p className='mb-4 text-destructive text-sm'>{error}</p>}
        <Tabs defaultValue='coursework'>
          <TabsList>
            <TabsTrigger value='coursework'>Assignments</TabsTrigger>
            <TabsTrigger value='topics'>Topics</TabsTrigger>
            <TabsTrigger value='materials'>Materials</TabsTrigger>
          </TabsList>
          <TabsContent value='coursework'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data?.coursework || []).map((row) => (
                  <TableRow key={String(row.id)}>
                    <TableCell>{String(row.title || '—')}</TableCell>
                    <TableCell>{String(row.work_type || '—')}</TableCell>
                    <TableCell>{String(row.update_time || '—')}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TabsContent>
          <TabsContent value='topics'>
            <div className='flex flex-col gap-2'>
              {(data?.topics || []).map((t) => (
                <Card key={String(t.id)}>
                  <CardHeader>
                    <CardTitle className='text-base'>{String(t.name)}</CardTitle>
                  </CardHeader>
                </Card>
              ))}
            </div>
          </TabsContent>
          <TabsContent value='materials'>
            <div className='flex flex-col gap-2'>
              {(data?.materials || []).map((m) => (
                <Card key={String(m.id)}>
                  <CardHeader>
                    <CardTitle className='text-base'>{String(m.title || 'Material')}</CardTitle>
                  </CardHeader>
                  <CardContent className='text-muted-foreground text-sm'>
                    {String(m.description || '')}
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>
        </Tabs>
      </Main>
    </>
  )
}