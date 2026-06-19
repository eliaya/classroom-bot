import React from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import {
  ArrowRight,
  BookOpen,
  ChevronRight,
  FileText,
  GraduationCap,
  Laptop,
  Megaphone,
  MoreHorizontal,
  Moon,
  Sun,
} from 'lucide-react'
import {
  api,
  type SearchCategory,
  type SearchResult,
  type SearchResultKind,
} from '@/lib/api'
import { useSearch } from '@/context/search-provider'
import { useTheme } from '@/context/theme-provider'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'
import { sidebarData } from './layout/data/sidebar-data'
import { ScrollArea } from './ui/scroll-area'

const KIND_ICON: Record<SearchResultKind, React.ElementType> = {
  course: GraduationCap,
  coursework: BookOpen,
  material: FileText,
  announcement: Megaphone,
}

// Recent search keywords shown as quick chips below the search bar.
const RECENT_KEYWORDS_KEY = 'command-palette:recent-keywords'
const MAX_RECENT_KEYWORDS = 3

function loadRecentKeywords(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(RECENT_KEYWORDS_KEY)
    if (raw) return (JSON.parse(raw) as string[]).slice(0, MAX_RECENT_KEYWORDS)
  } catch { /* ignore */ }
  return []
}

export function CommandMenu() {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const { setTheme } = useTheme()
  const { open, setOpen } = useSearch()
  const [query, setQuery] = React.useState('')
  const [categories, setCategories] = React.useState<SearchCategory[]>([])
  const [searching, setSearching] = React.useState(false)
  const [recentKeywords, setRecentKeywords] = React.useState<string[]>(
    loadRecentKeywords
  )

  const runCommand = React.useCallback(
    (command: () => unknown) => {
      setOpen(false)
      command()
    },
    [setOpen]
  )

  // Remember a keyword the user actually acted on (picked a result / opened the
  // full results page). Most-recent first, de-duplicated, capped at 3.
  const commitKeyword = React.useCallback((raw: string) => {
    const kw = raw.trim()
    if (kw.length < 2) return
    setRecentKeywords((prev) => {
      const next = [
        kw,
        ...prev.filter((k) => k.toLowerCase() !== kw.toLowerCase()),
      ].slice(0, MAX_RECENT_KEYWORDS)
      try {
        window.localStorage.setItem(RECENT_KEYWORDS_KEY, JSON.stringify(next))
      } catch { /* ignore */ }
      return next
    })
  }, [])

  // Navigate to a search result. Classwork items carry the item id/kind so the
  // classwork page can auto-open its split-screen detail panel.
  const goToResult = React.useCallback(
    (result: SearchResult) => {
      if (
        (result.kind === 'coursework' || result.kind === 'material') &&
        result.item_id
      ) {
        navigate({
          to: result.url,
          search: { item: result.item_id, kind: result.kind },
        })
        return
      }
      navigate({ to: result.url })
    },
    [navigate]
  )

  // Reset query state whenever the palette is closed.
  React.useEffect(() => {
    if (!open) {
      setQuery('')
      setCategories([])
    }
  }, [open])

  // Debounced full-text search across the whole app's cached content.
  React.useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setCategories([])
      setSearching(false)
      return
    }
    setSearching(true)
    let cancelled = false
    const handle = setTimeout(() => {
      api
        .search(q, 5)
        .then((r) => {
          if (!cancelled) setCategories(r?.categories ?? [])
        })
        .catch(() => {
          if (!cancelled) setCategories([])
        })
        .finally(() => {
          if (!cancelled) setSearching(false)
        })
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(handle)
    }
  }, [query])

  const hasResults = categories.some((c) => (c.items?.length ?? 0) > 0)

  // cmdk's built-in filter is disabled (shouldFilter={false}) so that
  // server-matched results are never hidden and item `value`s can stay stable
  // (a query-dependent value crashes cmdk on rapid edits). We filter the static
  // quick-action nav items ourselves.
  const navQuery = query.trim().toLowerCase()
  const matchesNav = (title: string) =>
    navQuery.length < 2 || title.toLowerCase().includes(navQuery)

  return (
    <CommandDialog
      modal
      open={open}
      onOpenChange={setOpen}
      shouldFilter={false}
      className='sm:max-w-xl'
    >
      <CommandInput
        placeholder={t('commandMenu.placeholder')}
        value={query}
        onValueChange={setQuery}
      />

      {/* Recent keyword chips — shown only when not actively searching. Click
          jumps straight to that keyword's full results page. */}
      {navQuery.length < 2 && recentKeywords.length > 0 && (
        <div className='flex flex-wrap items-center gap-1.5 border-b px-3 py-2'>
          <span className='text-xs text-muted-foreground'>{t('commandMenu.recent')}</span>
          {recentKeywords.map((kw) => (
            <span
              key={kw}
              role='button'
              tabIndex={0}
              onClick={() =>
                runCommand(() => {
                  commitKeyword(kw)
                  navigate({ to: '/search', search: { q: kw } })
                })
              }
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  runCommand(() => {
                    commitKeyword(kw)
                    navigate({ to: '/search', search: { q: kw } })
                  })
                }
              }}
              className='cursor-pointer rounded-full border bg-muted/50 px-2 py-0.5 text-xs text-foreground transition-colors hover:bg-accent hover:text-accent-foreground'
            >
              {kw}
            </span>
          ))}
        </div>
      )}

      <CommandList>
        <ScrollArea type='hover' className='h-80 pe-1'>
          <CommandEmpty>
            {searching ? t('commandMenu.searching') : t('commandMenu.noResults')}
          </CommandEmpty>

          {hasResults && (
            <>
              {categories
                .filter((category) => (category.items?.length ?? 0) > 0)
                .map((category) => (
                  <CommandGroup
                    key={category.key}
                    heading={`${category.label} (${category.total})`}
                  >
                    {category.items.map((result, i) => {
                      const Icon = KIND_ICON[result.kind]
                      return (
                        <CommandItem
                          key={`${category.key}-${result.course_id}-${i}`}
                          value={`result-${category.key}-${result.course_id}-${i}`}
                          onSelect={() => {
                            runCommand(() => {
                              commitKeyword(query)
                              goToResult(result)
                            })
                          }}
                        >
                          <Icon className='text-muted-foreground' />
                          <div className='flex min-w-0 flex-col'>
                            <span className='truncate'>{result.title}</span>
                            <span className='truncate text-xs text-muted-foreground'>
                              {[result.course_name, result.subtitle || result.snippet]
                                .filter(Boolean)
                                .join(' — ')}
                            </span>
                          </div>
                        </CommandItem>
                      )
                    })}
                    {category.has_more && (
                      <CommandItem
                        value={`more-${category.key}`}
                        onSelect={() => {
                          runCommand(() => {
                            commitKeyword(query)
                            navigate({
                              to: '/search',
                              search: { q: query, category: category.key },
                            })
                          })
                        }}
                      >
                        <MoreHorizontal className='text-muted-foreground' />
                        <span>
                          {t('commandMenu.more', {
                            label: category.label.toLowerCase(),
                          })}
                        </span>
                      </CommandItem>
                    )}
                  </CommandGroup>
                ))}
              <CommandSeparator />
            </>
          )}

          {sidebarData.navGroups.map((group) => {
            const items = group.items.flatMap((navItem, i) => {
              if (navItem.url) {
                if (!matchesNav(t(navItem.title))) return []
                return [
                  <CommandItem
                    key={`${navItem.url}-${i}`}
                    value={`nav-${navItem.url}-${i}`}
                    onSelect={() => {
                      runCommand(() => navigate({ to: navItem.url }))
                    }}
                  >
                    <div className='flex size-4 items-center justify-center'>
                      <ArrowRight className='size-2 text-muted-foreground/80' />
                    </div>
                    {t(navItem.title)}
                  </CommandItem>,
                ]
              }

              return (navItem.items ?? [])
                .filter((subItem) =>
                  matchesNav(`${t(navItem.title)} ${t(subItem.title)}`)
                )
                .map((subItem, j) => (
                  <CommandItem
                    key={`${navItem.title}-${subItem.url}-${j}`}
                    value={`nav-${navItem.title}-${subItem.url}-${j}`}
                    onSelect={() => {
                      runCommand(() => navigate({ to: subItem.url }))
                    }}
                  >
                    <div className='flex size-4 items-center justify-center'>
                      <ArrowRight className='size-2 text-muted-foreground/80' />
                    </div>
                    {t(navItem.title)} <ChevronRight /> {t(subItem.title)}
                  </CommandItem>
                ))
            })

            if (items.length === 0) return null
            return (
              <CommandGroup key={group.title} heading={t(group.title)}>
                {items}
              </CommandGroup>
            )
          })}
          <CommandSeparator />
          <CommandGroup heading={t('commandMenu.theme')}>
            <CommandItem onSelect={() => runCommand(() => setTheme('light'))}>
              <Sun /> <span>{t('commandMenu.light')}</span>
            </CommandItem>
            <CommandItem onSelect={() => runCommand(() => setTheme('dark'))}>
              <Moon className='scale-90' />
              <span>{t('commandMenu.dark')}</span>
            </CommandItem>
            <CommandItem onSelect={() => runCommand(() => setTheme('system'))}>
              <Laptop />
              <span>{t('commandMenu.system')}</span>
            </CommandItem>
          </CommandGroup>
        </ScrollArea>
      </CommandList>
    </CommandDialog>
  )
}
