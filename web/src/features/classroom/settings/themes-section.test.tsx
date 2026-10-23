import '@/styles/index.css'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { api, type Theme, type ThemeImport } from '@/lib/api'
import '@/lib/i18n'
import { applyTheme } from '@/lib/theme'
import { useAuthStore } from '@/stores/auth-store'
import { ThemesSection } from './themes-section'

const CAFFEINE: Theme = { id: 1, name: 'Caffeine', source: 'caffeine', light: { primary: 'rgb(1, 2, 3)' }, dark: {} }
const OCEAN: Theme = { id: 2, name: 'Ocean', source: null, light: { primary: 'rgb(0, 0, 200)' }, dark: {} }
const DOOM: ThemeImport = { name: 'Doom 64', light: { primary: 'rgb(9, 9, 9)' }, dark: {} }

let mine: number | null = null

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      listThemes: vi.fn(async () => ({ items: [CAFFEINE, OCEAN], default_id: 2 })),
      myTheme: vi.fn(async () => {
        const own = [CAFFEINE, OCEAN].find((theme) => theme.id === mine) ?? null
        const admin = useAuthStore.getState().auth.user?.permissions.includes('*')
        return { theme_id: mine, theme: own ?? (admin ? null : OCEAN) }
      }),
      setMyTheme: vi.fn(async (id: number | null) => ((mine = id), { theme_id: id })),
      setDefaultTheme: vi.fn(async (id: number | null) => ({ default_id: id })),
      deleteTheme: vi.fn(async (id: number) => ({ id, deleted: true })),
      importTweakcnTheme: vi.fn(async () => DOOM),
      installTheme: vi.fn(async () => ({ ...DOOM, id: 3, source: 'doom-64' })),
    },
  }
})

const signIn = (permissions: string[]) =>
  useAuthStore.getState().auth.setUser({
    id: 1, email: 'user@example.com', name: null, picture_url: null, role: 'user', permissions,
  })
const primary = () => getComputedStyle(document.documentElement).getPropertyValue('--primary').trim()

describe('ThemesSection', () => {
  beforeEach(() => {
    mine = null
    vi.clearAllMocks()
  })
  afterEach(() => applyTheme(null))

  it('lets a user pick a theme, with the admin default first, and nothing to install', async () => {
    signIn(['courses:view'])
    const screen = await render(<ThemesSection />)
    // No pick of their own: the user-panel default shows.
    await expect.element(screen.getByRole('radio', { name: 'Default (Ocean)' })).toBeChecked()
    await expect.poll(primary).toBe('rgb(0, 0, 200)')
    expect(document.body.textContent).not.toContain('Install theme')
    expect(document.body.textContent).not.toContain('User panel default')

    await userEvent.click(screen.getByRole('radio', { name: 'Caffeine' }))
    expect(api.setMyTheme).toHaveBeenCalledWith(1)
    await expect.element(screen.getByRole('radio', { name: 'Caffeine' })).toBeChecked()
    await expect.poll(primary).toBe('rgb(1, 2, 3)')
  })

  it('gives the admin built-in colours by default, the user-panel default and delete', async () => {
    signIn(['*'])
    const screen = await render(<ThemesSection />)
    await expect.element(screen.getByRole('radio', { name: 'Built-in colours' })).toBeChecked()
    await expect.element(screen.getByRole('combobox', { name: 'User panel default' })).toHaveTextContent('Ocean')

    await userEvent.click(screen.getByRole('combobox', { name: 'User panel default' }))
    await userEvent.click(screen.getByRole('option', { name: 'Caffeine' }))
    expect(api.setDefaultTheme).toHaveBeenCalledWith(1)

    await userEvent.click(screen.getByRole('button', { name: 'Delete theme Ocean' }))
    await userEvent.click(screen.getByRole('button', { name: 'Delete', exact: true }))
    expect(api.deleteTheme).toHaveBeenCalledWith(2)
  })

  it('installs from tweakcn: a preset after a pause, a share link at once, the latest answer only', async () => {
    signIn(['*'])
    const screen = await render(<ThemesSection />)
    await userEvent.click(screen.getByRole('button', { name: 'Install theme' }))
    const dialog = screen.getByRole('dialog')
    const search = dialog.getByLabelText('Preset or share link')

    // Part of a preset's name only narrows the suggestions.
    await userEvent.type(search, 'doom')
    await expect.element(dialog.getByRole('button', { name: 'doom-64' })).toBeVisible()
    await new Promise((r) => setTimeout(r, 700))
    expect(api.importTweakcnTheme).not.toHaveBeenCalled()

    // The whole name is looked up after the pause.
    await userEvent.type(search, '-64')
    await expect.element(dialog.getByText('Loaded “Doom 64”.')).toBeVisible()
    expect(api.importTweakcnTheme).toHaveBeenCalledExactlyOnceWith('doom-64')
    await expect.element(dialog.getByLabelText('Name')).toHaveValue('Doom 64')

    // A slow answer to an older lookup does not replace the share link's.
    let late!: (theme: ThemeImport) => void
    vi.mocked(api.importTweakcnTheme)
      .mockImplementationOnce(() => new Promise((resolve) => (late = resolve)))
      .mockResolvedValueOnce({ name: 'Light Green', light: { primary: 'rgb(0, 200, 0)' }, dark: {} })
    await userEvent.click(dialog.getByRole('button', { name: 'doom-64' }))
    await userEvent.fill(search, 'https://tweakcn.com/themes/cmlhfpjhw000004l4f4ax3m7z')
    expect(api.importTweakcnTheme).toHaveBeenLastCalledWith('cmlhfpjhw000004l4f4ax3m7z')
    await expect.element(dialog.getByLabelText('Name')).toHaveValue('Light Green')
    late(DOOM)
    await new Promise((r) => setTimeout(r, 50))
    await expect.element(dialog.getByLabelText('Name')).toHaveValue('Light Green')

    await userEvent.click(dialog.getByRole('button', { name: 'Install theme' }))
    expect(api.installTheme).toHaveBeenCalledWith({
      name: 'Light Green',
      source: 'cmlhfpjhw000004l4f4ax3m7z',
      light: { primary: 'rgb(0, 200, 0)' },
      dark: {},
    })
    await expect.element(screen.getByText('Theme installed.')).toBeVisible()
  })
})
