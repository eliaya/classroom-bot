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

const SOURCE_ICON: Record<Attachment['source'], string> = {
  drive: '📁',
  link: '🔗',
  form: '📝',
  youtube: '🎥',
}

export function CourseClassworkPage({ courseId }: { courseId: string }) {
  const [data, setData] = useState<ClassworkResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'classwork' | 'topics'>('classwork')
  // topic filter for the unified classwork view. null = show all
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null)
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
            <span className='rounded bg-muted px-1.5 py-0.5'>{String(item.work_type || '—')}</span>
            <span className='rounded bg-muted px-1.5 py-0.5'>{topicName}</span>
            {item.update_time && <span>{String(item.update_time)}</span>}
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

        {item.alternate_link && (
          <a
            href={String(item.alternate_link)}
            target='_blank'
            rel='noreferrer'
            className='text-muted-foreground inline-block text-xs underline'
          >
            Open in Google Classroom ↗
          </a>
        )}
      </div>
    </div>
  )
}

function AttachmentView({ att }: { att: Attachment }) {
  const icon = SOURCE_ICON[att.source] || '📎'
  const label = att.title || att.source

  // Non-Drive items (link / form / youtube): just an external reference.
  if (att.source !== 'drive') {
    return (
      <div className='rounded border p-2 text-sm'>
        {att.source_url ? (
          <a
            href={att.source_url}
            target='_blank'
            rel='noreferrer'
            className='text-primary underline'
          >
            {icon} {label} ↗
          </a>
        ) : (
          <span>
            {icon} {label}
          </span>
        )}
      </div>
    )
  }

  // Drive file whose content was not cached locally — explain the state.
  if (att.fetch_status !== 'fetched' || !att.download_url) {
    const hint =
      att.fetch_status === 'skipped'
        ? 'Not downloaded (enable the Drive scope: re-run setup_google_auth.py).'
        : att.fetch_status === 'failed'
          ? 'Download failed during the last sync.'
          : 'Not yet downloaded.'
    return (
      <div className='rounded border p-2 text-sm'>
        <div className='font-medium'>
          {icon} {label}
        </div>
        <div className='text-muted-foreground mt-0.5 text-xs'>{hint}</div>
        {att.source_url && (
          <a
            href={att.source_url}
            target='_blank'
            rel='noreferrer'
            className='text-primary text-xs underline'
          >
            Open original ↗
          </a>
        )}
      </div>
    )
  }

  const url = fileUrl(att.download_url)
  const mime = att.content_type || ''
  const isPdf = mime === 'application/pdf'
  const isImage = mime.startsWith('image/')

  return (
    <div className='rounded border p-2'>
      <div className='mb-2 flex items-center justify-between gap-2 text-sm'>
        <span className='min-w-0 truncate font-medium' title={label}>
          {icon} {label}
          {att.exported && (
            <span className='text-muted-foreground ml-1 text-xs'>(exported)</span>
          )}
        </span>
        <a
          href={url}
          download
          className='text-primary shrink-0 text-xs underline'
        >
          Download{att.file_size ? ` (${formatBytes(att.file_size)})` : ''}
        </a>
      </div>

      {isPdf && (
        <iframe src={url} title={label} className='h-[60vh] w-full rounded border' />
      )}
      {isImage && (
        <img src={url} alt={label} className='max-h-[60vh] w-full rounded border object-contain' />
      )}
      {!isPdf && !isImage && (
        <p className='text-muted-foreground text-xs'>
          {mime || 'Binary file'} — preview not available; use Download.
        </p>
      )}
    </div>
  )
}
