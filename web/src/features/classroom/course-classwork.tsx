import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
  type ClassworkItem,
  type ClassworkResponse,
} from '@/lib/api'
import { AttachmentView } from './components/attachment-view'

const UNCATEGORIZED = '__uncat__'

// A unified classwork row: coursework keeps its real work_type (ASSIGNMENT,
// SHORT_ANSWER_QUESTION, ...); materials are folded in with work_type 'MATERIAL'
// so a single list shows every sub-item under a topic.
type UnifiedItem = ClassworkItem & { kind: 'coursework' | 'material' }


export function CourseClassworkPage({
  courseId,
  initialItemId,
  initialKind,
}: {
  courseId: string
  initialItemId?: string
  initialKind?: 'coursework' | 'material'
}) {
  const { t, i18n } = useTranslation()
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
      .catch((e) => setError(e instanceof Error ? e.message : t('common.loadFailed')))
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
      { value: null, label: t('classwork.allTopics'), count: allItems.length },
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
      label: t('classwork.noTopic'),
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, selectedTopicId, i18n.language])

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
          <span className='text-muted-foreground text-sm'>{t('classwork.viewingBy')}</span>
          <TabsList>
            <TabsTrigger value='classwork'>{t('classwork.classwork')}</TabsTrigger>
            <TabsTrigger value='topics'>{t('classwork.topics')}</TabsTrigger>
          </TabsList>
        </div>

        {/* Quick filter status */}
        {tab === 'classwork' && selectedTopicId !== null && (
          <div className='flex items-center gap-2 text-sm'>
            <span className='text-muted-foreground'>{t('classwork.filteredBy')}</span>
            <span className='rounded bg-muted px-2 py-0.5 font-medium'>
              {selectedTopicId === UNCATEGORIZED ? t('classwork.noTopic') : resolveTopicName(selectedTopicId)}
            </span>
            <Button variant='ghost' size='sm' onClick={resetFilter}>
              {t('classwork.clearFilter')}
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
              <span className='text-muted-foreground mr-1 text-sm font-medium'>{t('classwork.latestTopics')}</span>
              {renderBtn(allTopicsOpt)}
              {visibleTopics.map(renderBtn)}
              {(showAllTopics || hiddenCount <= 0) && renderBtn(noTopicOpt)}
              {topicOpts.length > VISIBLE_COUNT && (
                <button
                  type='button'
                  onClick={() => setShowAllTopics((v) => !v)}
                  className='text-muted-foreground hover:text-foreground flex h-8 items-center gap-1 rounded border px-2 text-xs transition-colors'
                  title={showAllTopics ? t('classwork.showFewer') : t('classwork.showMore', { count: hiddenCount })}
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
                  {showAllTopics ? t('classwork.less') : t('classwork.more', { count: hiddenCount })}
                </button>
              )}
              {selectedTopicId !== null && (
                <Button variant='ghost' size='sm' onClick={resetFilter} className='h-8'>
                  {t('classwork.reset')}
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
                  <TableHead>{t('classwork.title')}</TableHead>
                  <TableHead>{t('classwork.type')}</TableHead>
                  {!selectedItem && <TableHead>{t('classwork.topic')}</TableHead>}
                  {!selectedItem && <TableHead>{t('classwork.updated')}</TableHead>}
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
                          {t('classwork.view')}
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
                {filteredItems.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className='text-muted-foreground'>
                      {hasTopics
                        ? t('classwork.noMatch')
                        : t('classwork.noClasswork')}
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
          {(data?.topics || []).map((topic) => {
            const tid = String(topic.id || '')
            const count = topicCounts[tid] || 0
            return (
              <Card
                key={tid}
                className='mb-3 break-inside-avoid cursor-pointer transition hover:border-primary/60'
                onClick={() => selectTopicAndSwitch(tid)}
              >
                <CardHeader className='pb-2'>
                  <CardTitle className='text-base'>{String(topic.name || tid)}</CardTitle>
                </CardHeader>
                <CardContent className='text-muted-foreground -mt-1 text-sm'>
                  {t('classwork.itemsInCache', { count })}
                  <div className='mt-2'>
                    <Button variant='outline' size='sm' onClick={(e) => { e.stopPropagation(); selectTopicAndSwitch(tid) }}>
                      {t('classwork.filterByTopic')}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )
          })}
          {!data?.topics?.length && (
            <p className='text-muted-foreground text-sm'>{t('classwork.noTopics')}</p>
          )}
        </div>
        <div className='mt-3'>
          <Button
            variant='outline'
            size='sm'
            onClick={() => selectTopicAndSwitch(UNCATEGORIZED)}
          >
            {t('classwork.showUncategorized')}
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
  const { t } = useTranslation()
  const attachments = item.attachments || []
  const description = String(item.description || '').trim()

  return (
    <div className='flex max-h-[80vh] flex-col overflow-hidden rounded-md border lg:w-1/2'>
      <div className='flex items-start justify-between gap-2 border-b p-3'>
        <div className='min-w-0'>
          <h3 className='truncate font-medium' title={String(item.title || '')}>
            {String(item.title || t('classwork.untitled'))}
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
          <p className='text-muted-foreground text-sm italic'>{t('classwork.noDescription')}</p>
        )}

        <div className='space-y-3'>
          <p className='text-muted-foreground text-xs font-medium uppercase'>
            {t('classwork.attachments', { count: attachments.length })}
          </p>
          {attachments.length === 0 && (
            <p className='text-muted-foreground text-sm'>{t('classwork.noAttachments')}</p>
          )}
          {attachments.map((att) => (
            <AttachmentView key={att.id} att={att} />
          ))}
        </div>

      </div>
    </div>
  )
}

