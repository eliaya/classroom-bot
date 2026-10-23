import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useNavigate, useParams } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import {
  ChevronFirst,
  ChevronLast,
  ChevronLeft,
  ChevronRight,
  Ellipsis,
  FileText,
  Folder,
} from 'lucide-react'
import { api, fileUrl, type MaterialItem, type MaterialList } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Main } from '@/components/layout/main'
import { ClassroomHeader } from '@/features/classroom/layout-header'
import { formatBytes } from '@/features/classroom/components/attachment-view'
import { PdfPreview, usesBrowserViewer } from '@/features/classroom/components/pdf-preview'
import { renderPdfThumbnail } from './pdf-thumbnail'
import { ViewToggle, type MaterialsOrder, type MaterialsView } from './view-toggle'

const PAGE_SIZES = [10, 25, 50]

// Per-device choices, like the PDF viewer's.
const VIEW_KEY = 'materials-view'
const ORDER_KEY = 'materials-order'
const saved = (key: string): string | null => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
const save = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value)
  } catch {
    // private mode: not kept
  }
}

/** Folders first, then by creation date (the modified date when the storage
 *  reports none); undated items last either way. */
function byCreated(items: MaterialItem[], order: MaterialsOrder): MaterialItem[] {
  const time = (i: MaterialItem) => Date.parse(i.created ?? i.modified ?? '')
  return [...items].sort((a, b) => {
    if (a.is_folder !== b.is_folder) return a.is_folder ? -1 : 1
    const ta = time(a)
    const tb = time(b)
    if (isNaN(ta) || isNaN(tb)) return isNaN(ta) ? (isNaN(tb) ? 0 : 1) : -1
    return order === 'desc' ? tb - ta : ta - tb
  })
}

const isPdf = (item: MaterialItem) =>
  item.content_type === 'application/pdf' || item.name.toLowerCase().endsWith('.pdf')
const isImage = (item: MaterialItem) => !!item.content_type?.startsWith('image/')
const downloadUrl = (item: MaterialItem) =>
  fileUrl(`/materials/download?path=${encodeURIComponent(item.path)}`)

/** The badge of a file, as in the reference file manager: a colored square
 *  with the type's letter (PDF gets the document glyph). */
function fileBadge(item: MaterialItem): { color: string; label: string | null } {
  const type = item.content_type ?? ''
  const ext = item.name.split('.').pop()?.toLowerCase() ?? ''
  if (isPdf(item)) return { color: 'bg-red-600', label: null }
  if (/word|document/.test(type) || ['doc', 'docx'].includes(ext))
    return { color: 'bg-blue-600', label: 'W' }
  if (/sheet|excel/.test(type) || ['xls', 'xlsx', 'csv'].includes(ext))
    return { color: 'bg-green-600', label: 'X' }
  if (/presentation|powerpoint/.test(type) || ['ppt', 'pptx'].includes(ext))
    return { color: 'bg-orange-600', label: 'P' }
  if (isImage(item)) return { color: 'bg-purple-500', label: 'I' }
  return { color: 'bg-muted-foreground', label: ext.charAt(0).toUpperCase() || '?' }
}

function formatDate(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString(undefined, { year: '2-digit', month: '2-digit', day: '2-digit' })
}

function ItemIcon({ item, large }: { item: MaterialItem; large?: boolean }) {
  if (item.is_folder) {
    return (
      <Folder
        className={cn('text-yellow-600', large ? 'size-12' : 'h-5 w-5')}
        aria-hidden='true'
      />
    )
  }
  const badge = fileBadge(item)
  return (
    <div
      className={cn(
        'flex items-center justify-center rounded font-bold text-white',
        large ? 'size-12 text-lg' : 'h-5 w-5 text-xs',
        badge.color
      )}
    >
      {badge.label ?? (
        <FileText className={large ? 'size-6' : 'size-3'} aria-hidden='true' />
      )}
    </div>
  )
}

/** The grid tile's picture: the image itself, the PDF's first page (drawn when
 *  the tile scrolls into view), else the type icon. */
function Thumbnail({ item }: { item: MaterialItem }) {
  const ref = useRef<HTMLDivElement>(null)
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const pdf = !item.is_folder && isPdf(item)

  useEffect(() => {
    const el = ref.current
    if (!pdf || !el) return
    let gone = false
    let made: string | null = null
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return
        io.disconnect()
        renderPdfThumbnail(downloadUrl(item))
          .then((url) => {
            made = url
            if (gone) URL.revokeObjectURL(url)
            else setSrc(url)
          })
          .catch(() => !gone && setFailed(true))
      },
      { rootMargin: '200px' }
    )
    io.observe(el)
    return () => {
      gone = true
      io.disconnect()
      if (made) URL.revokeObjectURL(made)
    }
  }, [pdf, item])

  const picture = isImage(item) ? downloadUrl(item) : src
  return (
    <div ref={ref} className='bg-muted flex aspect-[4/3] items-center justify-center overflow-hidden'>
      {picture && !failed ? (
        <img
          src={picture}
          alt=''
          loading='lazy'
          onError={() => setFailed(true)}
          className={cn('size-full', pdf ? 'bg-white object-contain' : 'object-cover')}
        />
      ) : (
        <ItemIcon item={item} large />
      )}
    </div>
  )
}

export function MaterialsPage() {
  // `/materials/<folder>/<sub>`: each folder has its own URL, so Back goes up.
  const { _splat } = useParams({ strict: false })
  const path = _splat ?? ''
  const [view, setView] = useState<MaterialsView>(() =>
    saved(VIEW_KEY) === 'grid' ? 'grid' : 'list'
  )
  const [order, setOrder] = useState<MaterialsOrder>(() =>
    saved(ORDER_KEY) === 'asc' ? 'asc' : 'desc'
  )
  const [pageSize, setPageSize] = useState(25)
  return (
    <>
      {/* The page's own heading follows the reference design; none in the bar. */}
      <ClassroomHeader fixed tagTarget={null} />
      <Main className='flex flex-1 flex-col'>
        <FolderView
          key={path}
          path={path}
          view={view}
          onView={(v) => {
            setView(v)
            save(VIEW_KEY, v)
          }}
          order={order}
          onOrder={(o) => {
            setOrder(o)
            save(ORDER_KEY, o)
          }}
          pageSize={pageSize}
          onPageSize={setPageSize}
        />
      </Main>
    </>
  )
}

function FolderView({
  path,
  view,
  onView,
  order,
  onOrder,
  pageSize,
  onPageSize,
}: {
  path: string
  view: MaterialsView
  onView: (view: MaterialsView) => void
  order: MaterialsOrder
  onOrder: (order: MaterialsOrder) => void
  pageSize: number
  onPageSize: (size: number) => void
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [data, setData] = useState<MaterialList | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const [previewing, setPreviewing] = useState<MaterialItem | null>(null)

  useEffect(() => {
    let live = true
    api
      .listMaterials(path)
      .then((d) => live && setData(d))
      .catch((e) => live && setError(e instanceof Error ? e.message : t('common.loadFailed')))
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path])

  const items = byCreated(data?.items ?? [], order)
  const pages = Math.max(1, Math.ceil(items.length / pageSize))
  const shown = items.slice(page * pageSize, (page + 1) * pageSize)
  const crumbs = path ? path.split('/') : []
  const go = (to: string) =>
    to
      ? navigate({ to: '/materials/$', params: { _splat: to } })
      : navigate({ to: '/materials' })
  const open = (item: MaterialItem) => {
    if (item.is_folder) void go(item.path)
    else if (isPdf(item) && !usesBrowserViewer()) setPreviewing(item)
    else window.open(downloadUrl(item), '_blank', 'noopener')
  }

  const menu = (item: MaterialItem) => (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          variant='ghost'
          size='icon-sm'
          aria-label={t('materials.actions')}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <Ellipsis className='size-4' />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end' onClick={(e) => e.stopPropagation()}>
        <DropdownMenuItem onClick={() => open(item)}>{t('materials.open')}</DropdownMenuItem>
        {!item.is_folder && (
          <DropdownMenuItem asChild>
            <a href={downloadUrl(item)} download={item.name}>
              {t('materials.download')}
            </a>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
  // Shared by list rows and grid tiles: the whole item opens it.
  const opener = (item: MaterialItem) => ({
    role: 'button' as const,
    tabIndex: 0,
    onClick: () => open(item),
    onKeyDown: (e: KeyboardEvent) => e.key === 'Enter' && open(item),
  })

  return (
    <div className='min-w-0 flex-1 space-y-4'>
      <div className='flex items-center justify-between gap-3'>
        <div className='flex min-w-0 items-center gap-2'>
          <h1 className='shrink-0 text-xl font-bold tracking-tight sm:text-2xl'>
            {t('materials.title')}
          </h1>
          {data && data.storage !== 'local' && (
            <nav className='text-muted-foreground flex min-w-0 items-center gap-1 text-sm'>
              {[t(`materials.storage.${data.storage}`), ...crumbs].map((name, i) => (
                <span key={i} className='flex min-w-0 items-center gap-1'>
                  <span>/</span>
                  <button
                    type='button'
                    className='hover:text-foreground truncate'
                    onClick={() => void go(crumbs.slice(0, i).join('/'))}
                  >
                    {name}
                  </button>
                </span>
              ))}
            </nav>
          )}
        </div>
        <ViewToggle
          value={view}
          onChange={onView}
          order={order}
          onOrder={(o) => {
            onOrder(o)
            setPage(0)
          }}
        />
      </div>

      {error && <p className='text-destructive text-sm'>{error}</p>}
      {data?.storage === 'local' && (
        <Alert>
          <AlertDescription>{t('materials.localNotice')}</AlertDescription>
        </Alert>
      )}
      {data && data.storage !== 'local' && items.length === 0 && (
        <p className='text-muted-foreground border-y p-2 text-sm lg:p-4'>{t('materials.empty')}</p>
      )}

      {view === 'list' ? (
        <div className={cn(items.length > 0 || !data ? 'border-t' : undefined)}>
          {!data &&
            !error &&
            Array.from({ length: 5 }, (_, i) => (
              <div key={i} className='border-b p-2 lg:p-4'>
                <Skeleton className='h-5 w-1/3' />
              </div>
            ))}
          {shown.map((item) => (
            <div
              key={item.path}
              {...opener(item)}
              className='hover:bg-muted/60 flex cursor-pointer items-center justify-between border-b p-2 transition-colors lg:p-4'
            >
              <div className='flex min-w-0 items-center space-x-3'>
                <div className='shrink-0'>
                  <ItemIcon item={item} />
                </div>
                <span className='min-w-0 truncate text-sm'>{item.name}</span>
              </div>
              <div className='text-muted-foreground flex shrink-0 items-center space-x-3 text-sm'>
                <span className='hidden w-16 text-right lg:inline'>{formatDate(item.modified)}</span>
                <span className='hidden w-16 text-right lg:inline'>
                  {item.is_folder ? '' : formatBytes(item.size)}
                </span>
                {menu(item)}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className='grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5'>
          {!data &&
            !error &&
            Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className='aspect-[4/3] rounded-lg' />
            ))}
          {shown.map((item) => (
            <div
              key={item.path}
              {...opener(item)}
              className='hover:bg-muted/60 bg-card cursor-pointer overflow-hidden rounded-lg border transition-colors'
            >
              <Thumbnail item={item} />
              <div className='flex items-center justify-between gap-2 border-t p-2'>
                <div className='min-w-0'>
                  <p className='truncate text-sm'>{item.name}</p>
                  <p className='text-muted-foreground truncate text-xs'>
                    {[formatDate(item.modified), item.is_folder ? '' : formatBytes(item.size)]
                      .filter(Boolean)
                      .join(' · ') || ' '}
                  </p>
                </div>
                {menu(item)}
              </div>
            </div>
          ))}
        </div>
      )}

      {items.length > 0 && (
        <div className='mt-4'>
          <div className='flex items-center justify-between gap-4 lg:gap-8'>
            <div className='flex items-center gap-3'>
              <Label htmlFor='materials-page-size' className='max-sm:sr-only'>
                {t('materials.rowsPerPage')}
              </Label>
              <Select
                value={String(pageSize)}
                onValueChange={(v) => {
                  onPageSize(Number(v))
                  setPage(0)
                }}
              >
                <SelectTrigger id='materials-page-size' className='w-fit whitespace-nowrap'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAGE_SIZES.map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className='text-muted-foreground flex grow justify-end text-sm whitespace-nowrap'>
              <p className='text-muted-foreground text-sm whitespace-nowrap' aria-live='polite'>
                <span className='text-foreground'>
                  {page * pageSize + 1}-{Math.min((page + 1) * pageSize, items.length)}
                </span>{' '}
                {t('materials.of')} <span className='text-foreground'>{items.length}</span>
              </p>
            </div>
            <div className='flex items-center gap-1'>
              {(
                [
                  ['firstPage', ChevronFirst, 0, page === 0],
                  ['previousPage', ChevronLeft, page - 1, page === 0],
                  ['nextPage', ChevronRight, page + 1, page >= pages - 1],
                  ['lastPage', ChevronLast, pages - 1, page >= pages - 1],
                ] as const
              ).map(([key, Icon, to, disabled]) => (
                <Button
                  key={key}
                  variant='ghost'
                  size='icon-sm'
                  aria-label={t(`materials.${key}`)}
                  disabled={disabled}
                  onClick={() => setPage(to)}
                >
                  <Icon />
                </Button>
              ))}
            </div>
          </div>
        </div>
      )}

      {previewing && (
        <PdfPreview
          url={downloadUrl(previewing)}
          title={previewing.name}
          open
          onOpenChange={(o) => !o && setPreviewing(null)}
        />
      )}
    </div>
  )
}
