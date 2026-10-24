import '@/styles/index.css'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { api } from '@/lib/api'
import '@/lib/i18n'
import { useBrandingStore } from '@/stores/branding-store'
import { BrandingSection } from './branding-section'

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      uploadSiteImage: vi.fn(async () => ({ logo: null, favicon: '/site/favicon?v=2' })),
      deleteSiteImage: vi.fn(async () => ({ logo: null, favicon: '/site/favicon?v=2' })),
    },
  }
})

const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='), (c) =>
  c.charCodeAt(0)
)

describe('BrandingSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useBrandingStore.setState({ logo: '/site/logo?v=1', favicon: null })
  })

  it('previews a picked favicon and a removed logo, then saves both', async () => {
    const screen = await render(<BrandingSection />)
    const save = screen.getByRole('button', { name: 'Save' })
    await expect.element(save).toBeDisabled()
    // The logo in use shows in the field and in the sidebar and sign-in previews.
    await expect.element(screen.getByText('In use')).toBeInTheDocument()
    expect(screen.container.querySelectorAll('img[src="/api/site/logo?v=1"]')).toHaveLength(3)

    const favicon = new File([PNG], 'icon.png', { type: 'image/png' })
    const inputs = screen.container.querySelectorAll<HTMLInputElement>('input[type="file"]')
    await userEvent.upload(inputs[1], favicon)
    await expect.element(screen.getByText('icon.png')).toBeInTheDocument()
    // The browser-tab preview switches to the picked file before anything is saved.
    await expect.poll(() => screen.container.querySelectorAll('img[src^="blob:"]').length).toBeGreaterThanOrEqual(2)

    await userEvent.click(screen.getByRole('button', { name: 'Go back to the built-in image' }))
    expect(document.body.textContent).not.toContain('In use')
    expect(screen.container.querySelectorAll('img[src="/api/site/logo?v=1"]')).toHaveLength(0)

    await userEvent.click(save)
    await expect.element(screen.getByText('Saved')).toBeInTheDocument()
    expect(api.uploadSiteImage).toHaveBeenCalledWith('favicon', favicon)
    expect(api.deleteSiteImage).toHaveBeenCalledWith('logo')
    expect(useBrandingStore.getState()).toEqual({ logo: null, favicon: '/site/favicon?v=2' })
  })

  it('says why a file is turned away', async () => {
    const screen = await render(<BrandingSection />)
    const inputs = screen.container.querySelectorAll<HTMLInputElement>('input[type="file"]')
    await userEvent.upload(inputs[0], new File([new Uint8Array(1024 * 1024 + 1)], 'huge.png', { type: 'image/png' }))
    await expect.element(screen.getByText('huge.png is too large.')).toBeInTheDocument()
    expect(api.uploadSiteImage).not.toHaveBeenCalled()
  })
})
