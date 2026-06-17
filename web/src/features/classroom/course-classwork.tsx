import { useEffect, useMemo, useRef, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
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
import {
  api,
  fileUrl,
  type Attachment,
  type ClassworkItem,
  type ClassworkResponse,
} from '@/lib/api'

const UNCATEGORIZED = '__uncat__'

// A unified classwork row: coursework keeps its real work_type (ASSIGNMENT,
// SHORT_ANSWER_QUESTION, ...); materials are folded in with work_type 'MATERIAL'
// so a single list shows every sub-item under a topic.
type UnifiedItem = ClassworkItem & { kind: 'coursework' | 'material' }

function formatBytes(n?: number | null): string {
  if (!n || n <= 0) return ''
  const units = ['B', 'KB', 'MB', 'GB']
  let v = n
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`
}

// SVG icons for each attachment source type
function IconDrive({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox='0 0 24 24' fill='none' aria-hidden='true'>
      <path d='M7.71 3 2 13l4.29 7h11.42L22 13 16.29 3H7.71Z' fill='#4285F4' />
      <path d='m2 13 4.29 7H22L16.29 13H2Z' fill='#34A853' opacity='.9' />
      <path d='M7.71 3 2 13h6.25L16.29 3H7.71Z' fill='#FBBC05' opacity='.9' />
    </svg>
  )
}

function IconYouTube({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox='0 0 24 24' aria-hidden='true'>
      <path
        d='M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2C0 8.1 0 12 0 12s0 3.9.5 5.8a3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1C24 15.9 24 12 24 12s0-3.9-.5-5.8Z'
        fill='#FF0000'
      />
      <path d='M9.6 15.6V8.4L15.8 12 9.6 15.6Z' fill='#fff' />
    </svg>
  )
}

function IconForm({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox='0 0 24 24' fill='none' aria-hidden='true'>
      <rect width='24' height='24' rx='3' fill='#673AB7' />
      <path d='M7 8h10M7 12h10M7 16h6' stroke='#fff' strokeWidth='1.8' strokeLinecap='round' />
    </svg>
  )
}

function IconLink({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'>
      <path d='M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71' />
      <path d='M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71' />
    </svg>
  )
}

function IconPdf({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox='0 0 24 24' fill='none' aria-hidden='true'>
      <rect width='24' height='24' rx='3' fill='#E53E3E' />
      <text x='3' y='17' fontSize='10' fontWeight='bold' fill='#fff' fontFamily='sans-serif'>PDF</text>
    </svg>
  )
}

function IconImage({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'>
      <rect x='3' y='3' width='18' height='18' rx='2' />
      <circle cx='9' cy='9' r='2' />
      <path d='m21 15-5-5L5 21' />
    </svg>
  )
}

function IconGoogleClassroom({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg className={className} viewBox='0 0 192 192' fill='none' aria-hidden='true'>
      <rect width='192' height='192' rx='24' fill='#1EA362' />
      <rect x='24' y='32' width='144' height='96' rx='8' fill='white' />
      <circle cx='96' cy='80' r='24' fill='#1EA362' />
      <path d='M56 152h80' stroke='white' strokeWidth='12' strokeLinecap='round' />
    </svg>
  )
}

function AttachmentIcon({ att }: { att: Attachment }) {
  if (att.source === 'youtube') return <IconYouTube />
  if (att.source === 'form') return <IconForm />
  if (att.source === 'link') return <IconLink />
  // Drive — pick icon by MIME type
  const mime = att.content_type || ''
  if (mime === 'application/pdf') return <IconPdf />
  if (mime.startsWith('image/')) return <IconImage />
  return <IconDrive />
}

export function CourseClassworkPage({
  courseId,
  initialItemId,
  initialKind,
}: {
  courseId: string
  initialItemId?: string
  initialKind?: 'coursework' | 'material'
}) {
  const [data, setData] = useState<ClassworkResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'classwork' | 'topics'>('classwork')
  // topic filter for the unified classwork view. null = show all
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null)
  const [showAllTopics, setShowAllTopics] = useState(false)
  // the classwork item shown in the split-screen content panel. null = closed
  const [selectedItem, setSelectedItem] = useState<UnifiedItem | null>(null)

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

  // When arriving from a search result (e.g. classwork category), auto-open the
  // split-screen detail panel for the targeted item once data has loaded.
  const autoOpenedRef = useRef(false)
  useEffect(() => {
    if (!initialItemId || autoOpenedRef.current || !data) return
    const pools: UnifiedItem[] = [
      ...(data.coursework || []).map((c) => ({
        ...c,
        kind: 'coursework' as const,
        work_type: c.work_type || 'COURSEWORK',
      })),
      ...(data.materials || []).map((m) => ({
        ...m,
        kind: 'material' as const,
        work_type: 'MATERIAL',
      })),
    ]
    const match = pools.find(
      (it) =>
        String(it.id) === String(initialItemId) &&
        (!initialKind || it.kind === initialKind)
    )
    if (match) {
      setSelectedItem(match)
      setTab('classwork')
      autoOpenedRef.current = true
    }
  }, [data, initialItemId, initialKind])

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
        <div className='flex items-center gap-2'>
          <span className='text-muted-foreground text-sm'>Viewing by:</span>
          <TabsList>
            <TabsTrigger value='classwork'>Classwork</TabsTrigger>
            <TabsTrigger value='topics'>Topics</TabsTrigger>
          </TabsList>
        </div>

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
        {/* Topic Filter control */}
        {(() => {
          // filterOptions: [All topics, ...topics, No topic]
          const allTopicsOpt = filterOptions[0]
          const noTopicOpt = filterOptions[filterOptions.length - 1]
          const topicOpts = filterOptions.slice(1, filterOptions.length - 1)
          const VISIBLE_COUNT = 3
          const visibleTopics = showAllTopics ? topicOpts : topicOpts.slice(0, VISIBLE_COUNT)
          const hiddenCount = topicOpts.length - VISIBLE_COUNT

          const renderBtn = (opt: typeof filterOptions[0]) => {
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
          }

          return (
            <div className='flex flex-wrap items-center gap-2'>
              <span className='text-muted-foreground mr-1 text-sm font-medium'>Latest topics:</span>
              {renderBtn(allTopicsOpt)}
              {visibleTopics.map(renderBtn)}
              {(showAllTopics || hiddenCount <= 0) && renderBtn(noTopicOpt)}
              {topicOpts.length > VISIBLE_COUNT && (
                <button
                  type='button'
                  onClick={() => setShowAllTopics((v) => !v)}
                  className='text-muted-foreground hover:text-foreground flex h-8 items-center gap-1 rounded border px-2 text-xs transition-colors'
                  title={showAllTopics ? 'Show fewer topics' : `Show ${hiddenCount} more topic${hiddenCount === 1 ? '' : 's'}`}
                >
                  {showAllTopics ? (
                    <svg xmlns='http://www.w3.org/2000/svg' className='h-3.5 w-3.5' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'>
                      <path d='m18 15-6-6-6 6' />
                    </svg>
                  ) : (
                    <svg xmlns='http://www.w3.org/2000/svg' className='h-3.5 w-3.5' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'>
                      <path d='m6 9 6 6 6-6' />
                    </svg>
                  )}
                  {showAllTopics ? 'Less' : `+${hiddenCount} more`}
                </button>
              )}
              {selectedTopicId !== null && (
                <Button variant='ghost' size='sm' onClick={resetFilter} className='h-8'>
                  Reset
                </Button>
              )}
            </div>
          )
        })()}

        <div className='flex flex-col gap-3 lg:flex-row lg:items-start'>
          <div
            className={
              'overflow-hidden rounded-md border ' +
              (selectedItem ? 'lg:w-1/2' : 'w-full')
            }
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Type</TableHead>
                  {!selectedItem && <TableHead>Topic</TableHead>}
                  {!selectedItem && <TableHead>Updated</TableHead>}
                  <TableHead className='w-16' />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredItems.map((row) => {
                  const isSelected =
                    selectedItem?.kind === row.kind && selectedItem?.id === row.id
                  return (
                    <TableRow
                      key={`${row.kind}-${String(row.id)}`}
                      onClick={() => setSelectedItem(row)}
                      data-state={isSelected ? 'selected' : undefined}
                      className='cursor-pointer'
                    >
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
                      {!selectedItem && (
                        <TableCell>
                          <span className='inline-flex items-center rounded bg-muted px-2 py-0.5 text-xs'>
                            {resolveTopicName(row.topic_id)}
                          </span>
                        </TableCell>
                      )}
                      {!selectedItem && (
                        <TableCell className='text-muted-foreground text-sm'>
                          {String(row.update_time || '—')}
                        </TableCell>
                      )}
                      <TableCell>
                        <Button
                          variant='ghost'
                          size='sm'
                          className='h-7 px-2 text-xs'
                          onClick={(e) => {
                            e.stopPropagation()
                            setSelectedItem(row)
                          }}
                        >
                          View
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
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

          {selectedItem && (
            <ClassworkDetail
              item={selectedItem}
              topicName={resolveTopicName(selectedItem.topic_id)}
              onClose={() => setSelectedItem(null)}
            />
          )}
        </div>

      </TabsContent>

      <TabsContent value='topics' className='mt-4'>
        <div className='gap-3 [column-fill:_balance] columns-1 sm:columns-2 lg:columns-3'>
          {(data?.topics || []).map((t) => {
            const tid = String(t.id || '')
            const count = topicCounts[tid] || 0
            return (
              <Card
                key={tid}
                className='mb-3 break-inside-avoid cursor-pointer transition hover:border-primary/60'
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

function ClassworkDetail({
  item,
  topicName,
  onClose,
}: {
  item: UnifiedItem
  topicName: string
  onClose: () => void
}) {
  const attachments = item.attachments || []
  const description = String(item.description || '').trim()

  return (
    <div className='flex max-h-[80vh] flex-col overflow-hidden rounded-md border lg:w-1/2'>
      <div className='flex items-start justify-between gap-2 border-b p-3'>
        <div className='min-w-0'>
          <h3 className='truncate font-medium' title={String(item.title || '')}>
            {String(item.title || 'Untitled')}
          </h3>
          <div className='text-muted-foreground mt-0.5 flex flex-wrap items-center gap-2 text-xs'>
            <span className='rounded bg-muted px-1.5 py-0.5'>{topicName}</span>
          </div>
        </div>
        <Button variant='ghost' size='sm' className='h-7 px-2' onClick={onClose}>
          ✕
        </Button>
      </div>

      <div className='flex-1 space-y-4 overflow-auto p-3'>
        {description ? (
          <div className='text-sm whitespace-pre-wrap'>{description}</div>
        ) : (
          <p className='text-muted-foreground text-sm italic'>No description.</p>
        )}

        <div className='space-y-3'>
          <p className='text-muted-foreground text-xs font-medium uppercase'>
            Attachments ({attachments.length})
          </p>
          {attachments.length === 0 && (
            <p className='text-muted-foreground text-sm'>No attachments.</p>
          )}
          {attachments.map((att) => (
            <AttachmentView key={att.id} att={att} />
          ))}
        </div>

      </div>
    </div>
  )
}

function AttachmentView({ att }: { att: Attachment }) {
  const label = att.title || att.source

  // Non-Drive items: external link only.
  if (att.source !== 'drive') {
    return (
      <div className='flex items-center gap-2 rounded border p-2 text-sm'>
        <AttachmentIcon att={att} />
        <div className='min-w-0 flex-1'>
          {att.source_url ? (
            <a href={att.source_url} target='_blank' rel='noreferrer' className='text-primary truncate underline'>
              {label} ↗
            </a>
          ) : (
            <span className='truncate'>{label}</span>
          )}
          <div className='mt-0.5 flex items-center gap-2'>
            <a href={att.source_url || undefined} target='_blank' rel='noreferrer' className='text-muted-foreground transition-opacity hover:opacity-80'>
              <IconGoogleClassroom className='size-4' />
            </a>
            <Badge variant='outline' className='text-[10px]'>
              {att.source}
            </Badge>
          </div>
        </div>
      </div>
    )
  }

  // Drive file not cached locally.
  if (att.fetch_status !== 'fetched' || !att.download_url) {
    const hint =
      att.fetch_status === 'skipped'
        ? 'Not downloaded (enable the Drive scope: re-run setup_google_auth.py).'
        : att.fetch_status === 'failed'
          ? 'Download failed during the last sync.'
          : 'Not yet downloaded.'
    return (
      <div className='rounded border p-2 text-sm'>
        <div className='flex items-center gap-2 font-medium'>
          <AttachmentIcon att={att} />
          <span className='truncate'>{label}</span>
        </div>
        <div className='text-muted-foreground mt-0.5 text-xs'>{hint}</div>
        {att.source_url && (
          <a href={att.source_url} target='_blank' rel='noreferrer' className='text-primary text-xs underline'>
            Open in Drive ↗
          </a>
        )}
      </div>
    )
  }

  const url = fileUrl(att.download_url)

  return (
    <div className='flex items-center justify-between gap-2 rounded border p-2 text-sm'>
      <div className='flex min-w-0 items-center gap-2'>
        <AttachmentIcon att={att} />
        <div className='min-w-0 flex-1'>
          <span className='truncate font-medium' title={label}>
            {label}
            {att.exported && <span className='text-muted-foreground ml-1 text-xs'>(exported)</span>}
          </span>
          <div className='mt-0.5 flex items-center gap-2'>
            <Badge variant='outline' className='text-[10px]'>
              {att.source}
            </Badge>
            {att.source_url && (
              <a href={att.source_url} target='_blank' rel='noreferrer' className='text-primary text-xs underline'>
                Open ↗
              </a>
            )}
            <a href={url} download className='text-primary text-xs underline'>
              Download{att.file_size ? ` (${formatBytes(att.file_size)})` : ''}
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
