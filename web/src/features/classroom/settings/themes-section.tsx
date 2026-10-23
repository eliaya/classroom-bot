import { useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { api, type Theme } from '@/lib/api'
import { isAdmin, usePermissions } from '@/lib/permissions'
import { applyTheme } from '@/lib/theme'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { ThemeInstallDialog } from '@/features/themes/theme-install-dialog'
import { ThemeSwatches } from '@/features/themes/theme-swatches'

const NONE = 'none'
const fetchThemes = () => Promise.all([api.listThemes(), api.myTheme()])

/** Settings → Themes: everyone picks their own theme; the admin area also installs
 *  themes from tweakcn.com and picks the user panel's default. */
export function ThemesSection() {
  const { t } = useTranslation()
  const admin = isAdmin(usePermissions())
  const [themes, setThemes] = useState<Theme[] | null>(null)
  const [defaultId, setDefaultId] = useState<number | null>(null)
  const [mine, setMine] = useState<number | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [installing, setInstalling] = useState(false)
  const [deleting, setDeleting] = useState<Theme | null>(null)

  const show = ([list, me]: Awaited<ReturnType<typeof fetchThemes>>) => {
    setThemes(list.items)
    setDefaultId(list.default_id)
    setMine(me.theme_id)
    // A deleted or newly picked theme shows at once.
    applyTheme(me.theme)
  }
  const load = () => fetchThemes().then(show)

  useEffect(() => {
    fetchThemes()
      .then(show)
      .catch((e) => setMsg(e instanceof Error ? e.message : t('common.loadFailed')))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Every change is saved at once; a failure reloads what the server holds.
  const run = async (action: () => Promise<unknown>, ok: string) => {
    setMsg(null)
    try {
      await action()
      setMsg(ok)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : t('common.saveFailed'))
    }
    await load().catch(() => {})
  }

  const fallback = themes?.find((theme) => theme.id === defaultId)
  const choice = mine === null ? NONE : String(mine)
  const toId = (value: string) => (value === NONE ? null : Number(value))

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{t('settings.themes.yours')}</CardTitle>
          <CardDescription>{t(admin ? 'settings.themes.yoursAdmin' : 'settings.themes.yoursUser')}</CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          {themes && (
            <RadioGroup
              value={choice}
              onValueChange={(value) => void run(() => api.setMyTheme(toId(value)), t('settings.themes.picked'))}
              aria-label={t('settings.themes.yours')}
              className='gap-2'
            >
              <ThemeOption value={NONE}>
                {/* The user panel's default reaches users only, never the admin area. */}
                {!admin && fallback
                  ? t('settings.themes.useDefault', { name: fallback.name })
                  : t('settings.themes.builtIn')}
              </ThemeOption>
              {themes.map((theme) => (
                <ThemeOption key={theme.id} value={String(theme.id)} theme={theme}>
                  {theme.name}
                </ThemeOption>
              ))}
            </RadioGroup>
          )}
          {themes && !themes.length && (
            <p className='text-sm text-muted-foreground'>
              {t(admin ? 'settings.themes.noneAdmin' : 'settings.themes.noneUser')}
            </p>
          )}
          {msg && <p className='text-xs text-muted-foreground'>{msg}</p>}
        </CardContent>
      </Card>

      {admin && themes && (
        <Card>
          <CardHeader className='flex flex-row items-start justify-between gap-4 space-y-0'>
            <div className='space-y-1.5'>
              <CardTitle>{t('settings.themes.manage')}</CardTitle>
              <CardDescription>{t('settings.themes.manageDesc')}</CardDescription>
            </div>
            <Button onClick={() => setInstalling(true)}>
              <Plus />
              {t('settings.themes.install')}
            </Button>
          </CardHeader>
          <CardContent className='space-y-4'>
            <div className='space-y-1.5'>
              <Label htmlFor='theme-default'>{t('settings.themes.userDefault')}</Label>
              <Select
                value={defaultId === null ? NONE : String(defaultId)}
                onValueChange={(value) => void run(() => api.setDefaultTheme(toId(value)), t('common.saved'))}
              >
                <SelectTrigger id='theme-default' className='w-64'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t('settings.themes.builtIn')}</SelectItem>
                  {themes.map((theme) => (
                    <SelectItem key={theme.id} value={String(theme.id)}>
                      {theme.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className='text-xs text-muted-foreground'>{t('settings.themes.userDefaultHint')}</p>
            </div>
            {!!themes.length && (
              <ul className='divide-y rounded-md border'>
                {themes.map((theme) => (
                  <li key={theme.id} className='flex items-center gap-3 p-3'>
                    <ThemeSwatches theme={theme} />
                    <span className='min-w-0 flex-1 truncate text-sm font-medium'>{theme.name}</span>
                    {theme.source && (
                      <span className='hidden truncate text-xs text-muted-foreground sm:inline'>{theme.source}</span>
                    )}
                    <Button
                      size='icon'
                      variant='ghost'
                      className='size-8 text-destructive'
                      onClick={() => setDeleting(theme)}
                      aria-label={t('settings.themes.deleteNamed', { name: theme.name })}
                    >
                      <Trash2 className='size-4' />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      <ThemeInstallDialog
        open={installing}
        onOpenChange={setInstalling}
        onInstalled={() => {
          setMsg(t('settings.themes.installed'))
          void load().catch(() => {})
        }}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        destructive
        title={t('settings.themes.deleteTitle', { name: deleting?.name ?? '' })}
        desc={t('settings.themes.deleteDesc')}
        confirmText={t('settings.themes.delete')}
        handleConfirm={() => {
          const theme = deleting
          setDeleting(null)
          if (theme) void run(() => api.deleteTheme(theme.id), t('common.deleted'))
        }}
      />
    </>
  )
}

function ThemeOption({ value, theme, children }: { value: string; theme?: Theme; children: React.ReactNode }) {
  const id = `theme-${value}`
  return (
    <Label
      htmlFor={id}
      className='flex cursor-pointer items-center gap-3 rounded-md border p-3 font-normal has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-accent/50'
    >
      <RadioGroupItem id={id} value={value} />
      <span className='min-w-0 flex-1 truncate text-sm font-medium'>{children}</span>
      {theme && <ThemeSwatches theme={theme} />}
    </Label>
  )
}
