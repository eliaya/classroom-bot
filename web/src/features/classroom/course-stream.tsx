import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { api, type StreamItem } from '@/lib/api'

export function CourseStreamPage({ courseId }: { courseId: string }) {
  const { t } = useTranslation()
  const [items, setItems] = useState<StreamItem[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .getStream(courseId, 100)
      .then((stream) => setItems(stream.items))
      .catch((e) => setError(e instanceof Error ? e.message : t('common.loadFailed')))
  }, [courseId])

  if (error) {
    return <p className='text-destructive text-sm'>{error}</p>
  }

  return (
    <div className='flex flex-col gap-4'>
      {items.map((item) => (
        <Card key={`${item.type}-${item.id}`}>
          <CardHeader className='flex flex-row items-center justify-between gap-2'>
            <CardTitle className='text-base'>{item.title || t('courseStream.untitled')}</CardTitle>
            <Badge variant='secondary'>{item.type}</Badge>
          </CardHeader>
          <CardContent className='text-muted-foreground text-sm'>
            <p className='mb-2 whitespace-pre-wrap'>{item.text || '—'}</p>
            <p>{t('courseStream.updated', { time: item.update_time || '—' })}</p>
                      </CardContent>
        </Card>
      ))}
      {!items.length && (
        <p className='text-muted-foreground text-sm'>
          {t('courseStream.noStream')}
        </p>
      )}
    </div>
  )
}