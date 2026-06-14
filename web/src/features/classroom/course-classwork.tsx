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
import { api, type ClassworkResponse } from '@/lib/api'

const UNCATEGORIZED = '__uncat__'

export function CourseClassworkPage({ courseId }: { courseId: string }) {
  const [data, setData] = useState<ClassworkResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'coursework' | 'topics' | 'materials'>('coursework')
  // topic filter for the Assignments (coursework) view. null = show all
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

  // Build lookup + filter options + counts (all data is already local after one fetch)
  const { topicMap, filterOptions, filteredCoursework, filteredMaterials, topicCounts } = useMemo(() => {
    const tMap: Record<string, string> = {}
    const counts: Record<string, number> = { [UNCATEGORIZED]: 0 }

    ;(data?.topics || []).forEach((t) => {
      if (t.id) {
        tMap[String(t.id)] = String(t.name || t.id)
        counts[String(t.id)] = 0
      }
    })

    // count coursework per topic (from the full local set when no server filter active)
    const cwSource = data?.coursework || []
    cwSource.forEach((cw) => {
      const tid = cw.topic_id ? String(cw.topic_id) : UNCATEGORIZED
      if (counts[tid] !== undefined) counts[tid] = (counts[tid] || 0) + 1
      else counts[tid] = 1
    })

    // also count materials into same buckets (for completeness)
    ;(data?.materials || []).forEach((m) => {
      const tid = m.topic_id ? String(m.topic_id) : UNCATEGORIZED
      // we only surface counts for coursework primarily, but still track
      if (!counts[tid]) counts[tid] = 0
    })

    const options: Array<{ value: string | null; label: string; count?: number }> = [
      { value: null, label: 'All topics', count: cwSource.length },
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
    let fCw = cwSource
    if (selectedTopicId !== null) {
      if (selectedTopicId === UNCATEGORIZED) {
        fCw = cwSource.filter((c) => !c.topic_id)
      } else {
        fCw = cwSource.filter((c) => String(c.topic_id || '') === selectedTopicId)
      }
    }

    // materials filtered similarly (for the Materials tab when using same selection)
    let fMat = data?.materials || []
    if (selectedTopicId !== null) {
      if (selectedTopicId === UNCATEGORIZED) {
        fMat = fMat.filter((m) => !m.topic_id)
      } else {
        fMat = fMat.filter((m) => String(m.topic_id || '') === selectedTopicId)
      }
    }

    return {
      topicMap: tMap,
      filterOptions: options,
      filteredCoursework: fCw,
      filteredMaterials: fMat,
      topicCounts: counts,
    }
  }, [data, selectedTopicId])

  const resolveTopicName = (tid?: string | null) => {
    if (!tid) return '—'
    return topicMap[String(tid)] || String(tid)
  }

  const handleTopicFilterChange = (val: string | null) => {
    setSelectedTopicId(val)
    // If user wants server-side filtering for the chosen topic (except the synthetic "no topic"), we can reload.
    // For "All" and "No topic" we keep client-side on the full local data.
    if (val && val !== UNCATEGORIZED) {
      // optional: reload with server filter for this topic (keeps payload smaller)
      // load(val)
      // For simplicity and "全部抓取到localhost" we keep the full local set and just filter here.
    }
  }

  const selectTopicAndSwitch = (tid: string | null) => {
    setSelectedTopicId(tid)
    setTab('coursework')
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
        if (v === 'coursework' || v === 'topics' || v === 'materials') {
          setTab(v)
        }
      }}
    >
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <TabsList>
          <TabsTrigger value='coursework'>Assignments</TabsTrigger>
          <TabsTrigger value='topics'>Topics</TabsTrigger>
          <TabsTrigger value='materials'>Materials</TabsTrigger>
        </TabsList>

        {/* Quick filter status */}
        {tab === 'coursework' && selectedTopicId !== null && (
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

      <TabsContent value='coursework' className='mt-4 space-y-3'>
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
                onClick={() => handleTopicFilterChange(opt.value)}
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
              {(filteredCoursework || []).map((row) => (
                <TableRow key={String(row.id)}>
                  <TableCell className='font-medium'>{String(row.title || '—')}</TableCell>
                  <TableCell>{String(row.work_type || '—')}</TableCell>
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
              {filteredCoursework.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className='text-muted-foreground'>
                    {hasTopics
                      ? 'No assignments match this topic filter. (All data is cached locally.)'
                      : 'No assignments in cache. Run a course sync.'}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        <p className='text-muted-foreground text-xs'>
          All topics and their classwork items are fetched into the local cache during sync (including per-topic content via Google Classroom topic filter).
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
                  {count} assignment{count === 1 ? '' : 's'} in cache
                  <div className='mt-2'>
                    <Button variant='outline' size='sm' onClick={(e) => { e.stopPropagation(); selectTopicAndSwitch(tid) }}>
                      Filter assignments by this topic
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

      <TabsContent value='materials' className='mt-4 space-y-3'>
        {/* Reuse the same topic filter selection for materials */}
        <div className='flex flex-wrap items-center gap-2 text-sm'>
          <span className='text-muted-foreground'>Topic filter (applies to this view too):</span>
          <Button variant={selectedTopicId === null ? 'default' : 'outline'} size='sm' onClick={() => setSelectedTopicId(null)}>
            All
          </Button>
          {(data?.topics || []).map((t) => {
            const tid = String(t.id || '')
            const active = selectedTopicId === tid
            return (
              <Button key={tid} variant={active ? 'default' : 'outline'} size='sm' onClick={() => setSelectedTopicId(tid)}>
                {String(t.name || tid)}
              </Button>
            )
          })}
          <Button
            variant={selectedTopicId === UNCATEGORIZED ? 'default' : 'outline'}
            size='sm'
            onClick={() => setSelectedTopicId(UNCATEGORIZED)}
          >
            No topic
          </Button>
        </div>

        <div className='grid gap-3 sm:grid-cols-2'>
          {(filteredMaterials || []).map((m) => (
            <Card key={String(m.id)}>
              <CardHeader>
                <CardTitle className='text-base'>
                  {String(m.title || 'Material')}
                  {m.topic_id && (
                    <span className='ml-2 align-middle text-xs text-muted-foreground'>
                      ({resolveTopicName(m.topic_id)})
                    </span>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className='text-muted-foreground text-sm'>
                {String(m.description || '')}
                {m.alternate_link && (
                  <div className='mt-2'>
                    <a href={String(m.alternate_link)} target='_blank' rel='noreferrer' className='text-primary text-xs underline'>
                      open in Classroom
                    </a>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
          {filteredMaterials.length === 0 && (
            <p className='text-muted-foreground text-sm'>No materials match the current topic filter (or none cached yet).</p>
          )}
        </div>
      </TabsContent>
    </Tabs>
  )
}