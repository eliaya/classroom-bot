import { useEffect, useState } from 'react'
import { Link, getRouteApi } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import {
  BookOpen,
  FileText,
  GraduationCap,
  Megaphone,
  Paperclip,
} from 'lucide-react'
import {
  api,
  type SearchCategory,
  type SearchResultKind,
} from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Main } from '@/components/layout/main'
import { ClassroomHeader } from './layout-header'

const route = getRouteApi('/_authenticated/search/')

const KIND_ICON: Record<SearchResultKind, React.ElementType> = {
  course: GraduationCap,
  coursework: BookOpen,
  material: FileText,
  announcement: Megaphone,
}

export function SearchPage() {
  const { t } = useTranslation()
  const { q, category } = route.useSearch()
  const [categories, setCategories] = useState<SearchCategory[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const query = (q ?? '').trim()
    if (query.length < 2) {
      setCategories([])
      setLoading(false)
      return
    }
    setLoading(true)
    let cancelled = false
    api
      .search(query, 50)
      .then((r) => {
        if (!cancelled) setCategories(r?.categories ?? [])
      })
      .catch(() => {
        if (!cancelled) setCategories([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [q])

  const shown = category
    ? categories.filter((c) => c.key === category)
    : categories
  const visible = shown.filter((c) => (c.items?.length ?? 0) > 0)

  return (
    <>
      <ClassroomHeader
        fixed
        title={t('searchPage.title')}
        description={t('searchPage.desc')}
      />
      <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>
        <div className='flex flex-col gap-1'>
          <p className='text-sm text-muted-foreground'>
            {q ? (
              <>
                {t('searchPage.resultsFor')}{' '}
                <span className='text-foreground'>“{q}”</span>
                {category ? t('searchPage.inCategory', { category }) : ''}
              </>
            ) : (
              t('searchPage.prompt')
            )}
          </p>
        </div>

        {loading ? (
          <div className='flex flex-col gap-3'>
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className='h-16 w-full rounded-md' />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <p className='text-sm text-muted-foreground'>
            {q ? t('searchPage.noResultsFor', { q }) : t('searchPage.noResults')}
          </p>
        ) : (
          <div className='flex flex-col gap-6'>
            {visible.map((cat) => (
              <Card key={cat.key}>
                <CardHeader>
                  <CardTitle className='flex items-center gap-2'>
                    {cat.label}
                    <Badge variant='secondary'>{cat.total}</Badge>
                  </CardTitle>
                  <CardDescription>
                    {cat.total > cat.items.length
                      ? t('searchPage.showingOf', { shown: cat.items.length, total: cat.total })
                      : t('searchPage.resultCount', { count: cat.total })}
                  </CardDescription>
                </CardHeader>
                <CardContent className='flex flex-col gap-1'>
                  {cat.items.map((result, i) => {
                    const Icon = KIND_ICON[result.kind]
                    const isClasswork =
                      (result.kind === 'coursework' ||
                        result.kind === 'material') &&
                      !!result.item_id
                    return (
                      <Link
                        key={`${result.course_id}-${i}`}
                        to={result.url}
                        search={
                          isClasswork
                            ? {
                                item: result.item_id ?? undefined,
                                kind: result.kind as 'coursework' | 'material',
                              }
                            : undefined
                        }
                        className='flex items-start gap-3 rounded-md p-2 hover:bg-accent'
                      >
                        <Icon className='mt-0.5 size-4 shrink-0 text-muted-foreground' />
                        <div className='flex min-w-0 flex-col'>
                          <span className='truncate text-sm font-medium'>
                            {result.title}
                          </span>
                          {result.course_name && (
                            <span className='truncate text-xs text-muted-foreground'>
                              {result.course_name}
                            </span>
                          )}
                          {result.snippet && (
                            <span className='line-clamp-2 text-xs text-muted-foreground'>
                              {result.snippet}
                            </span>
                          )}
                          {result.attachment && (
                            <span className='mt-0.5 flex items-center gap-1 text-xs text-muted-foreground'>
                              <Paperclip className='size-3 shrink-0' />
                              {result.attachment}
                            </span>
                          )}
                        </div>
                      </Link>
                    )
                  })}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </Main>
    </>
  )
}
