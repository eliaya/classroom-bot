import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { api, type StreamItem } from '@/lib/api'

export function CourseStreamPage({ courseId }: { courseId: string }) {
  const [items, setItems] = useState<StreamItem[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .getStream(courseId, 100)
      .then((stream) => setItems(stream.items))
      .catch((e) => setError(e instanceof Error ? e.message : 'Load failed'))
  }, [courseId])

  if (error) {
    return <p className='text-destructive text-sm'>{error}</p>
  }

  return (
    <div className='flex flex-col gap-4'>
      {items.map((item) => (
        <Card key={`${item.type}-${item.id}`}>
          <CardHeader className='flex flex-row items-center justify-between gap-2'>
            <CardTitle className='text-base'>{item.title || 'Untitled'}</CardTitle>
            <Badge variant='secondary'>{item.type}</Badge>
          </CardHeader>
          <CardContent className='text-muted-foreground text-sm'>
            <p className='mb-2 whitespace-pre-wrap'>{item.text || '—'}</p>
            <p>Updated: {item.update_time || '—'}</p>
            {item.alternate_link && (
              <a
                className='text-primary underline'
                href={item.alternate_link}
                target='_blank'
                rel='noreferrer'
              >
                Open in Classroom
              </a>
            )}
          </CardContent>
        </Card>
      ))}
      {!items.length && (
        <p className='text-muted-foreground text-sm'>
          No stream items in cache. Run sync to fetch announcements and coursework.
        </p>
      )}
    </div>
  )
}