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
import { api } from '@/lib/api'

export function CoursePeoplePage({ courseId }: { courseId: string }) {
  const [people, setPeople] = useState<
    Array<{ user_id: string; role: string; full_name?: string; email?: string }>
  >([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .getPeople(courseId)
      .then((res) => setPeople(res.items))
      .catch((e) => setError(e instanceof Error ? e.message : 'Load failed'))
  }, [courseId])

  if (error) {
    return <p className='text-destructive text-sm'>{error}</p>
  }

  return (
    <div className='overflow-hidden rounded-md border'>
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
                <Badge variant='outline' className='capitalize'>
                  {p.role}
                </Badge>
              </TableCell>
            </TableRow>
          ))}
          {!people.length && (
            <TableRow>
              <TableCell colSpan={3} className='text-muted-foreground'>
                No people in cache.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}