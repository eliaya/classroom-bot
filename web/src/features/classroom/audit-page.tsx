import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { api, type AuditCategory, type AuditLog } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Main } from '@/components/layout/main'
import { ClassroomHeader } from './layout-header'

type CategoryTab = 'all' | AuditCategory

// `label` is an i18n key, translated at render time.
const TABS: { value: CategoryTab; label: string }[] = [
  { value: 'all', label: 'audit.tabAll' },
  { value: 'general', label: 'audit.tabGeneral' },
  { value: 'api', label: 'audit.tabApi' },
  { value: 'discord', label: 'audit.tabDiscord' },
]

const CATEGORY_VARIANT: Record<AuditCategory, 'secondary' | 'default' | 'outline'> = {
  general: 'outline',
  api: 'secondary',
  discord: 'default',
}

const PAGE_SIZE = 50

function formatTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

export function AuditPage() {
  const { t } = useTranslation()
  const [tab, setTab] = useState<CategoryTab>('all')
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [page, setPage] = useState(1)
  const [rows, setRows] = useState<AuditLog[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const h = setTimeout(() => setDebounced(search.trim()), 300)
    return () => clearTimeout(h)
  }, [search])

  // Reset to first page when filters change.
  useEffect(() => {
    setPage(1)
  }, [tab, debounced])

  useEffect(() => {
    setLoading(true)
    let cancelled = false
    api
      .listAudit({
        category: tab === 'all' ? undefined : tab,
        search: debounced || undefined,
        page,
        limit: PAGE_SIZE,
      })
      .then((r) => {
        if (cancelled) return
        setRows(r.rows)
        setTotal(r.total)
        setError(null)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : t('common.loadFailed'))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [tab, debounced, page])

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / PAGE_SIZE)), [total])

  return (
    <>
      <ClassroomHeader
        fixed
        title={t('audit.title')}
        description={t('audit.desc')}
      />
      <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>

        <div className='flex flex-wrap items-center justify-between gap-3'>
          <Tabs value={tab} onValueChange={(v) => setTab(v as CategoryTab)}>
            <TabsList>
              {TABS.map((tab) => (
                <TabsTrigger key={tab.value} value={tab.value}>
                  {t(tab.label)}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <Input
            placeholder={t('audit.filterPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className='h-9 w-full sm:w-72'
          />
        </div>

        {error && <p className='text-destructive text-sm'>{error}</p>}

        <div className='overflow-hidden rounded-md border'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className='w-44'>{t('audit.colTime')}</TableHead>
                <TableHead className='w-24'>{t('audit.colCategory')}</TableHead>
                <TableHead>{t('audit.colAction')}</TableHead>
                <TableHead>{t('audit.colActor')}</TableHead>
                <TableHead>{t('audit.colTarget')}</TableHead>
                <TableHead className='w-20'>{t('audit.colStatus')}</TableHead>
                <TableHead className='w-20 text-right'>{t('audit.colMs')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                [...Array(8)].map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={7}>
                      <Skeleton className='h-5 w-full' />
                    </TableCell>
                  </TableRow>
                ))
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className='h-24 text-center text-muted-foreground'>
                    {t('audit.noEntries')}
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className='text-muted-foreground text-xs whitespace-nowrap'>
                      {formatTime(r.created_at)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={CATEGORY_VARIANT[r.category] ?? 'outline'}>
                        {r.category}
                      </Badge>
                    </TableCell>
                    <TableCell className='font-medium'>{r.action}</TableCell>
                    <TableCell className='text-muted-foreground'>{r.actor || '—'}</TableCell>
                    <TableCell className='max-w-xs truncate text-muted-foreground' title={r.target || ''}>
                      {r.target || '—'}
                    </TableCell>
                    <TableCell>
                      <span
                        className={cn(
                          'text-xs font-medium',
                          r.status === 'error' ? 'text-destructive' : 'text-emerald-600'
                        )}
                      >
                        {r.status}
                      </span>
                    </TableCell>
                    <TableCell className='text-right text-xs tabular-nums text-muted-foreground'>
                      {r.duration_ms ?? '—'}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        <div className='flex items-center justify-between text-sm text-muted-foreground'>
          <span>{t('audit.entries', { count: total })}</span>
          <div className='flex items-center gap-2'>
            <button
              type='button'
              disabled={page <= 1 || loading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className='rounded border px-2 py-1 disabled:opacity-40'
            >
              {t('common.prev')}
            </button>
            <span>
              {page} / {totalPages}
            </span>
            <button
              type='button'
              disabled={page >= totalPages || loading}
              onClick={() => setPage((p) => p + 1)}
              className='rounded border px-2 py-1 disabled:opacity-40'
            >
              {t('common.next')}
            </button>
          </div>
        </div>
      </Main>
    </>
  )
}
