import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import { api, type Me } from '@/lib/api'
import { Route } from '@/routes/_authenticated/route'

const user = (permissions: string[]): Me => ({
  id: 1, email: 'user@example.com', name: null, picture_url: null, role: 'user', permissions,
})
const guard = (pathname: string) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (Route.options.beforeLoad as any)({ location: { pathname, href: pathname } })

describe('the route guard', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('lets in a page granted since the page loaded', async () => {
    useAuthStore.getState().auth.setUser(user(['courses:view']))
    const me = vi.spyOn(api, 'me').mockResolvedValue(user(['courses:view', 'audit:view']))
    await expect(guard('/audit')).resolves.toBeUndefined()
    expect(me).toHaveBeenCalledOnce()
    expect(useAuthStore.getState().auth.user?.permissions).toContain('audit:view')
  })

  it('still sends to 403 when the role does not hold it', async () => {
    useAuthStore.getState().auth.setUser(user(['courses:view']))
    vi.spyOn(api, 'me').mockResolvedValue(user(['courses:view']))
    await expect(guard('/audit')).rejects.toMatchObject({ options: { to: '/403' } })
  })

  it('asks the API nothing for a page the cached role opens', async () => {
    useAuthStore.getState().auth.setUser(user(['courses:view']))
    const me = vi.spyOn(api, 'me')
    await expect(guard('/courses')).resolves.toBeUndefined()
    expect(me).not.toHaveBeenCalled()
  })
})
