import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import { hardNavigate } from '@/lib/navigate'
import { ApiError, type Me, api } from './api'

vi.mock('@/lib/navigate', () => ({ hardNavigate: vi.fn() }))

const me: Me = {
  id: 1,
  email: 'user@example.com',
  name: null,
  picture_url: null,
  role: 'user',
  permissions: ['courses:view'],
}

function stubFetch(status: number, body: unknown) {
  const fetchMock = vi.fn(
    async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify(body), { status })
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('api requests', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
    useAuthStore.getState().auth.reset()
  })

  it('sends no Authorization header: auth is the session cookie', async () => {
    const fetchMock = stubFetch(200, { items: [], total: 0 })

    await api.listCourses()

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/courses')
    expect(init?.headers).not.toHaveProperty('Authorization')
  })

  it('on 401 forgets the user and returns to sign-in', async () => {
    useAuthStore.getState().auth.setUser(me)
    stubFetch(401, { detail: 'Sign in required' })

    const error = await api.listCourses().catch((e) => e)

    expect(error).toBeInstanceOf(ApiError)
    expect(error.status).toBe(401)
    expect(useAuthStore.getState().auth.user).toBeNull()
    expect(hardNavigate).toHaveBeenCalledWith(
      expect.stringMatching(/^\/login\?redirect=/)
    )
  })

  it('leaves 403 to the caller: the user is signed in, just not allowed', async () => {
    useAuthStore.getState().auth.setUser(me)
    stubFetch(403, { detail: 'Missing permission: sync:use' })

    await expect(api.triggerSync()).rejects.toMatchObject({ status: 403 })
    expect(useAuthStore.getState().auth.user).toEqual(me)
    expect(hardNavigate).not.toHaveBeenCalled()
  })

  it('leaves a 401 from /auth/me to the route guard', async () => {
    stubFetch(401, { detail: 'Sign in required' })

    await expect(api.me()).rejects.toMatchObject({ status: 401 })
    expect(hardNavigate).not.toHaveBeenCalled()
  })
})
