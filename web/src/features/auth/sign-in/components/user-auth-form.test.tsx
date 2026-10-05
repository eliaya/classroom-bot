import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { hardNavigate } from '@/lib/navigate'
import { UserAuthForm } from './user-auth-form'

const GOOGLE_URL = 'https://accounts.google.com/o/oauth2/auth?x=1'
const loginStart = vi.fn()

vi.mock('@/lib/api', () => ({
  api: { loginStart: (...args: unknown[]) => loginStart(...args) },
}))
vi.mock('@/lib/navigate', () => ({ hardNavigate: vi.fn() }))

describe('UserAuthForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    loginStart.mockResolvedValue({ authorization_url: GOOGLE_URL })
  })

  it('starts Google sign-in and sends the browser to Google', async () => {
    const { getByRole } = await render(<UserAuthForm />)

    await userEvent.click(getByRole('button', { name: /continue with google/i }))

    await vi.waitFor(() => expect(hardNavigate).toHaveBeenCalledWith(GOOGLE_URL))
    // Our own origin (for Google's redirect back), and the dashboard afterwards.
    expect(loginStart).toHaveBeenCalledWith(window.location.origin, '/')
  })

  it('returns to the page the user was on', async () => {
    const { getByRole } = await render(<UserAuthForm redirectTo='/courses/1/stream' />)

    await userEvent.click(getByRole('button', { name: /continue with google/i }))

    await vi.waitFor(() =>
      expect(loginStart).toHaveBeenCalledWith(window.location.origin, '/courses/1/stream')
    )
  })

  it('stays on the page and re-enables the button when the start call fails', async () => {
    loginStart.mockRejectedValue(new Error('client_secret.json not found'))
    const { getByRole } = await render(<UserAuthForm />)
    const button = getByRole('button', { name: /continue with google/i })

    await userEvent.click(button)

    await expect.element(button).toBeEnabled()
    expect(hardNavigate).not.toHaveBeenCalled()
  })
})
