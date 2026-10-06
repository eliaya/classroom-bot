import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { toast } from 'sonner'
import { ApiError } from '@/lib/api'
import { hardNavigate } from '@/lib/navigate'
import { AdminAuthForm } from './admin-auth-form'

const loginPassword = vi.fn()

vi.mock('@/lib/api', async (original) => ({
  ...(await original<typeof import('@/lib/api')>()),
  api: { loginPassword: (...args: unknown[]) => loginPassword(...args) },
}))
vi.mock('@/lib/navigate', () => ({ hardNavigate: vi.fn() }))
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

describe('AdminAuthForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('signs an administrator in with email and password', async () => {
    loginPassword.mockResolvedValue({ next: '/settings/users' })
    const { getByRole, getByLabelText } = await render(
      <AdminAuthForm redirectTo='/settings/users' />
    )

    await userEvent.fill(getByLabelText('Email'), 'boss@example.com')
    await userEvent.fill(getByLabelText('Password'), 'correct horse battery')
    await userEvent.click(getByRole('button', { name: /sign in/i }))

    // Goes where the API says, not straight to the (untrusted) redirect param.
    await vi.waitFor(() => expect(hardNavigate).toHaveBeenCalledWith('/settings/users'))
    expect(loginPassword).toHaveBeenCalledWith(
      'boss@example.com', 'correct horse battery', '/settings/users'
    )
  })

  it('stays on the page when the password is wrong', async () => {
    loginPassword.mockRejectedValue(new ApiError(401, '{"detail":"Invalid email or password"}'))
    const { getByRole, getByLabelText } = await render(<AdminAuthForm />)

    await userEvent.fill(getByLabelText('Email'), 'boss@example.com')
    await userEvent.fill(getByLabelText('Password'), 'nope')
    const submit = getByRole('button', { name: /sign in/i })
    await userEvent.click(submit)

    await expect.element(submit).toBeEnabled()
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringMatching(/email or password is incorrect/i)
    )
    expect(hardNavigate).not.toHaveBeenCalled()
  })
})
