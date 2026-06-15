import { useEffect, useMemo, useState } from 'react'
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
import { Button } from '@/components/ui/button'
import { api, type ClassworkItem, type ClassworkResponse } from '@/lib/api'

const UNCATEGORIZED = '__uncat__'

// A unified classwork row: coursework keeps its real work_type (ASSIGNMENT,
// SHORT_ANSWER_QUESTION, ...); materials are folded in with work_type 'MATERIAL'
// so a single list shows every sub-item under a topic.
type UnifiedItem = ClassworkItem & { kind: 'coursework' | 'material' }

export function CourseClassworkPage({ courseId }: { courseId: string }) {
  const [data, setData] = useState<ClassworkResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'classwork' | 'topics'>('classwork')
  // topic filter for the unified classwork view. null = show all
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null)

  const load = (topicId?: string | null) => {
    api
      .getClasswork(courseId, topicId ?? undefined)
      .then((d) => {
        setData(d)
        setError(null)
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Load failed'))
  }

  useEffect(() => {
    load()
  }, [courseId])

  // Build lookup + filter options + counts + the unified item list.
  const { topicMap, filterOptions, filteredItems, topicCounts } = useMemo(() => {
    const tMap: Record<string, string> = {}
    const counts: Record<string, number> = { [UNCATEGORIZED]: 0 }

    ;(data?.topics || []).forEach((t) => {
      if (t.id) {
        tMap[String(t.id)] = String(t.name || t.id)
        counts[String(t.id)] = 0
      }
    })

    // Merge coursework + materials into one list. A topic's sub-items include
    // BOTH assignments/questions AND materials (the "資料公開 / View material"
    // entries), so they are counted and listed together.
    const cwItems: UnifiedItem[] = (data?.coursework || []).map((c) => ({
      ...c,
      kind: 'coursework',
      work_type: c.work_type || 'COURSEWORK',
    }))
    const matItems: UnifiedItem[] = (data?.materials || []).map((m) => ({
      ...m,
      kind: 'material',
      work_type: 'MATERIAL',
    }))
    const allItems = [...cwItems, ...matItems].sort((a, b) =>
      String(b.update_time || '').localeCompare(String(a.update_time || ''))
    )

    const bump = (tid: string) => {
      counts[tid] = (counts[tid] || 0) + 1
    }
    allItems.forEach((it) => bump(it.topic_id ? String(it.topic_id) : UNCATEGORIZED))

    const options: Array<{ value: string | null; label: string; count?: number }> = [
      { value: null, label: 'All topics', count: allItems.length },
    ]
    ;(data?.topics || []).forEach((t) => {
      const id = String(t.id || '')
      options.push({
        value: id,
        label: String(t.name || id),
        count: counts[id] || 0,
      })
    })
    options.push({
      value: UNCATEGORIZED,
      label: 'No topic',
      count: counts[UNCATEGORIZED] || 0,
    })

    // Apply client-side topic filter (works even when server returned full set)
    let fItems = allItems
    if (selectedTopicId !== null) {
      if (selectedTopicId === UNCATEGORIZED) {
        fItems = allItems.filter((c) => !c.topic_id)
      } else {
        fItems = allItems.filter((c) => String(c.topic_id || '') === selectedTopicId)
      }
    }

    return {
      topicMap: tMap,
      filterOptions: options,
      filteredItems: fItems,
      topicCounts: counts,
    }
  }, [data, selectedTopicId])

  const resolveTopicName = (tid?: string | null) => {
    if (!tid) return '—'
    return topicMap[String(tid)] || String(tid)
  }

  const selectTopicAndSwitch = (tid: string | null) => {
    setSelectedTopicId(tid)
    setTab('classwork')
  }

  const resetFilter = () => setSelectedTopicId(null)

  if (error) {
    return <p className='text-destructive text-sm'>{error}</p>
  }

  const hasTopics = (data?.topics || []).length > 0

  return (
    <Tabs
      value={tab}
      onValueChange={(v) => {
        if (v === 'classwork' || v === 'topics') {
          setTab(v)
        }
      }}
    >
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <TabsList>
          <TabsTrigger value='classwork'>Classwork</TabsTrigger>
          <TabsTrigger value='topics'>Topics</TabsTrigger>
        </TabsList>

        {/* Quick filter status */}
        {tab === 'classwork' && selectedTopicId !== null && (
          <div className='flex items-center gap-2 text-sm'>
            <span className='text-muted-foreground'>Filtered by:</span>
            <span className='rounded bg-muted px-2 py-0.5 font-medium'>
              {selectedTopicId === UNCATEGORIZED ? 'No topic' : resolveTopicName(selectedTopicId)}
            </span>
            <Button variant='ghost' size='sm' onClick={resetFilter}>
              Clear filter
            </Button>
          </div>
        )}
      </div>

      <TabsContent value='classwork' className='mt-4 space-y-3'>
        {/* Topic Filter control (the main feature requested) */}
        <div className='flex flex-wrap items-center gap-2'>
          <span className='text-muted-foreground mr-1 text-sm font-medium'>Topic filter:</span>
          {filterOptions.map((opt) => {
            const isActive =
              (opt.value === null && selectedTopicId === null) ||
              (opt.value === selectedTopicId)
            return (
              <Button
                key={String(opt.value)}
                variant={isActive ? 'default' : 'outline'}
                size='sm'
                onClick={() => setSelectedTopicId(opt.value)}
                className='h-8'
              >
                {opt.label}
                {typeof opt.count === 'number' && (
                  <span className='ml-1.5 rounded bg-background/60 px-1 text-[10px] tabular-nums'>
                    {opt.count}
                  </span>
                )}
              </Button>
            )
          })}
          {selectedTopicId !== null && (
            <Button variant='ghost' size='sm' onClick={resetFilter} className='h-8'>
              Show all
            </Button>
          )}
        </div>

        <div className='overflow-hidden rounded-md border'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Topic</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead className='w-12' />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredItems.map((row) => (
                <TableRow key={`${row.kind}-${String(row.id)}`}>
                  <TableCell className='font-medium'>{String(row.title || '—')}</TableCell>
                  <TableCell>
                    <span
                      className={
                        'inline-flex items-center rounded px-2 py-0.5 text-xs ' +
                        (row.kind === 'material'
                          ? 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300'
                          : 'bg-muted')
                      }
                    >
                      {String(row.work_type || '—')}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className='inline-flex items-center rounded bg-muted px-2 py-0.5 text-xs'>
                      {resolveTopicName(row.topic_id)}
                    </span>
                  </TableCell>
                  <TableCell className='text-muted-foreground text-sm'>
                    {String(row.update_time || '—')}
                  </TableCell>
                  <TableCell>
                    {row.alternate_link && (
                      <a
                        href={String(row.alternate_link)}
                        target='_blank'
                        rel='noreferrer'
                        className='text-primary text-xs underline'
                      >
                        open
                      </a>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {filteredItems.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className='text-muted-foreground'>
                    {hasTopics
                      ? 'No classwork matches this topic filter. (All data is cached locally.)'
                      : 'No classwork in cache. Run a course sync.'}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        <p className='text-muted-foreground text-xs'>
          All topics and their classwork items (assignments, questions, and materials) are fetched into the local cache during sync. Items are grouped by each item's own topic; materials are tagged as <span className='font-medium'>MATERIAL</span>.
        </p>
      </TabsContent>

      <TabsContent value='topics' className='mt-4'>
        <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-3'>
          {(data?.topics || []).map((t) => {
            const tid = String(t.id || '')
            const count = topicCounts[tid] || 0
            return (
              <Card
                key={tid}
                className='cursor-pointer transition hover:border-primary/60'
                onClick={() => selectTopicAndSwitch(tid)}
              >
                <CardHeader className='pb-2'>
                  <CardTitle className='text-base'>{String(t.name || tid)}</CardTitle>
                </CardHeader>
                <CardContent className='text-muted-foreground -mt-1 text-sm'>
                  {count} item{count === 1 ? '' : 's'} in cache (coursework + materials)
                  <div className='mt-2'>
                    <Button variant='outline' size='sm' onClick={(e) => { e.stopPropagation(); selectTopicAndSwitch(tid) }}>
                      Filter classwork by this topic
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )
          })}
          {!data?.topics?.length && (
            <p className='text-muted-foreground text-sm'>No topics in cache. Sync the course to pull all topics + content under each topic.</p>
          )}
        </div>
        <div className='mt-3'>
          <Button
            variant='outline'
            size='sm'
            onClick={() => selectTopicAndSwitch(UNCATEGORIZED)}
          >
            Show uncategorized / no-topic items
          </Button>
        </div>
      </TabsContent>
    </Tabs>
  )
}
