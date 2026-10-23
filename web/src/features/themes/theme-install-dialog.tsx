import { useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ApiError, api, type ThemeImport } from '@/lib/api'
import { TWEAKCN_PRESETS, shareLinkId, slugify } from '@/lib/theme-tokens'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ThemeSwatches } from './theme-swatches'

type Props = { open: boolean; onOpenChange: (open: boolean) => void; onInstalled: () => void }

/** Install a theme from tweakcn.com: by preset name or share link, previewed before it is saved. */
export function ThemeInstallDialog({ open, onOpenChange, onInstalled }: Props) {
  const { t } = useTranslation()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>{t('settings.themes.installTitle')}</DialogTitle>
          <DialogDescription>{t('settings.themes.installDesc')}</DialogDescription>
        </DialogHeader>
        {/* Mounted while open: reopening starts a fresh search. */}
        {open && <InstallForm onDone={() => (onOpenChange(false), onInstalled())} />}
      </DialogContent>
    </Dialog>
  )
}

type Found = ThemeImport & { source: string }
type Status = 'idle' | 'loading' | 'found' | 'not-found' | 'error'

function InstallForm({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [found, setFound] = useState<Found | null>(null)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  // Only the latest lookup counts: an older answer arriving late is dropped.
  const request = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(
    () => () => {
      request.current++
      clearTimeout(timer.current)
    },
    []
  )

  const slug = slugify(query)
  const suggestions = TWEAKCN_PRESETS.filter((p) => p.includes(slug))

  const lookup = (source: string) => {
    const id = ++request.current
    setStatus('loading')
    setError(null)
    api
      .importTweakcnTheme(source)
      .then((theme) => {
        if (request.current !== id) return
        setFound({ ...theme, source })
        setName(theme.name)
        setStatus('found')
      })
      .catch((e) => {
        if (request.current !== id) return
        setFound(null)
        setStatus(e instanceof ApiError && e.status === 404 ? 'not-found' : 'error')
        setError(e instanceof Error ? e.message : t('common.loadFailed'))
      })
  }

  const search = (value: string) => {
    setQuery(value)
    clearTimeout(timer.current)
    request.current++
    const link = shareLinkId(value)
    // A share link is unambiguous: fetched at once.
    if (link) return lookup(link)
    const next = slugify(value)
    // Part of a preset's name ("doom" of "doom-64") only suggests; anything else is tried after a pause.
    if (!next || TWEAKCN_PRESETS.some((p) => p !== next && p.startsWith(next))) {
      setStatus('idle')
      return
    }
    setStatus('loading')
    timer.current = setTimeout(() => lookup(next), 600)
  }

  const pick = (preset: string) => {
    setQuery(preset)
    clearTimeout(timer.current)
    lookup(preset)
  }

  const install = async () => {
    if (!found || !name.trim()) return
    setSaving(true)
    setError(null)
    try {
      await api.installTheme({ name: name.trim(), source: found.source, light: found.light, dark: found.dark })
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form
      className='grid gap-4'
      onSubmit={(e) => {
        e.preventDefault()
        void install()
      }}
    >
      <div className='grid gap-2'>
        <Label htmlFor='theme-search'>{t('settings.themes.search')}</Label>
        <Input
          id='theme-search'
          value={query}
          autoComplete='off'
          placeholder='modern-minimal · https://tweakcn.com/themes/…'
          onChange={(e) => search(e.target.value)}
        />
        <div className='flex max-h-28 flex-wrap gap-1.5 overflow-y-auto' aria-label={t('settings.themes.presets')}>
          {suggestions.map((preset) => (
            <Button
              key={preset}
              type='button'
              size='sm'
              variant={preset === found?.source ? 'secondary' : 'outline'}
              className='h-7 rounded-full px-2.5 text-xs'
              onClick={() => pick(preset)}
            >
              {preset}
            </Button>
          ))}
        </div>
        <p role='status' className='flex min-h-5 items-center gap-1.5 text-sm text-muted-foreground'>
          {status === 'loading' && (
            <>
              <Loader2 className='size-3.5 animate-spin' />
              {t('settings.themes.searching')}
            </>
          )}
          {status === 'found' && found && t('settings.themes.found', { name: found.name })}
          {status === 'not-found' && t('settings.themes.notFound', { name: query.trim() })}
        </p>
      </div>

      {found && status === 'found' && (
        <div className='grid gap-3'>
          <ThemeSwatches theme={found} className='gap-4' labelled />
          <div className='grid gap-2'>
            <Label htmlFor='theme-name'>{t('settings.themes.name')}</Label>
            <Input id='theme-name' value={name} maxLength={64} onChange={(e) => setName(e.target.value)} />
          </div>
        </div>
      )}
      {error && status !== 'not-found' && (
        <p role='alert' className='text-sm text-destructive'>
          {error}
        </p>
      )}

      <DialogFooter>
        <Button type='submit' disabled={!found || status !== 'found' || !name.trim() || saving}>
          {t('settings.themes.install')}
        </Button>
      </DialogFooter>
    </form>
  )
}
