import { beforeEach, describe, expect, it, vi } from 'vitest'
import { type Me } from '@/lib/api'

const me: Me = {
  id: 1,
  email: 'user@example.com',
  name: 'User',
  picture_url: null,
  role: 'user',
  permissions: ['todos:view'],
}

describe('useAuthStore', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('starts signed out, caches the user, and reset clears it', async () => {
    const { useAuthStore } = await import('./auth-store')
    expect(useAuthStore.getState().auth.user).toBeNull()

    useAuthStore.getState().auth.setUser(me)
    expect(useAuthStore.getState().auth.user).toEqual(me)

    useAuthStore.getState().auth.reset()
    expect(useAuthStore.getState().auth.user).toBeNull()
  })
})
