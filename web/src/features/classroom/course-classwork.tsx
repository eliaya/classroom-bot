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
import { api } from '@/lib/api'

export function CourseClassworkPage({ courseId }: { courseId: string }) {
  const [data, setData] = useState<{
    coursework: Array<Record<string, unknown>>
    topics: Array<Record<string, unknown>>
    materials: Array<Record<string, unknown>>
  } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .getClasswork(courseId)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'Load failed'))
  }, [courseId])

  if (error) {
    return <p className='text-destructive text-sm'>{error}</p>
  }

  return (
    <Tabs defaultValue='coursework'>
      <TabsList>
        <TabsTrigger value='coursework'>Assignments</TabsTrigger>
        <TabsTrigger value='topics'>Topics</TabsTrigger>
        <TabsTrigger value='materials'>Materials</TabsTrigger>
      </TabsList>
      <TabsContent value='coursework' className='mt-4'>
        <div className='overflow-hidden rounded-md border'>
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
              {!data?.coursework?.length && (
                <TableRow>
                  <TableCell colSpan={3} className='text-muted-foreground'>
                    No assignments in cache.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </TabsContent>
      <TabsContent value='topics' className='mt-4'>
        <div className='grid gap-3 sm:grid-cols-2'>
          {(data?.topics || []).map((t) => (
            <Card key={String(t.id)}>
              <CardHeader>
                <CardTitle className='text-base'>{String(t.name)}</CardTitle>
              </CardHeader>
            </Card>
          ))}
          {!data?.topics?.length && (
            <p className='text-muted-foreground text-sm'>No topics in cache.</p>
          )}
        </div>
      </TabsContent>
      <TabsContent value='materials' className='mt-4'>
        <div className='grid gap-3 sm:grid-cols-2'>
          {(data?.materials || []).map((m) => (
            <Card key={String(m.id)}>
              <CardHeader>
                <CardTitle className='text-base'>
                  {String(m.title || 'Material')}
                </CardTitle>
              </CardHeader>
              <CardContent className='text-muted-foreground text-sm'>
                {String(m.description || '')}
              </CardContent>
            </Card>
          ))}
          {!data?.materials?.length && (
            <p className='text-muted-foreground text-sm'>
              No materials in cache.
            </p>
          )}
        </div>
      </TabsContent>
    </Tabs>
  )
}