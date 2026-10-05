import { create } from 'zustand'
import { type Me } from '@/lib/api'

// The session itself is an HttpOnly cookie owned by the API; this store only
// caches who is signed in (GET /auth/me) for the lifetime of the page.
interface AuthState {
  auth: {
    user: Me | null
    setUser: (user: Me | null) => void
    reset: () => void
  }
}

export const useAuthStore = create<AuthState>()((set) => ({
  auth: {
    user: null,
    setUser: (user) =>
      set((state) => ({ ...state, auth: { ...state.auth, user } })),
    reset: () =>
      set((state) => ({ ...state, auth: { ...state.auth, user: null } })),
  },
}))
