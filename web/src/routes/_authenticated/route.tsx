import { createFileRoute, redirect } from '@tanstack/react-router'
import { useAuthStore } from '@/stores/auth-store'
import { ApiError, api } from '@/lib/api'
import { ADMIN_BASE, BASE } from '@/lib/area'
import { canOpen, isAdmin } from '@/lib/permissions'
import { AuthenticatedLayout } from '@/components/layout/authenticated-layout'

export const Route = createFileRoute('/_authenticated')({
  // Runs before every page under this layout: who is signed in, and may they
  // open this path? The API enforces the same permissions on its own.
  beforeLoad: async ({ location }) => {
    const { auth } = useAuthStore.getState()
    const fetchUser = async () => {
      try {
        const me = await api.me()
        auth.setUser(me)
        return me
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          throw redirect({ to: '/login', search: { redirect: location.href } })
        }
        throw error
      }
    }
    // Fetched once per page load; a page the cached role cannot open fetches it again below.
    let user = auth.user ?? (await fetchUser())
    // Administrators' pages are under /admin, everyone else's at the root:
    // reload into the right area, then wait for the page to unload.
    const base = isAdmin(user.permissions) ? ADMIN_BASE : ''
    if (base !== BASE) {
      window.location.replace(base + location.href)
      await new Promise(() => {})
    }
    if (user.permissions.length > 0 && !canOpen(user.permissions, location.pathname)) {
      // The role may have been granted this page since the load: ask once more.
      user = await fetchUser()
      if (!canOpen(user.permissions, location.pathname)) throw redirect({ to: '/403' })
    }
  },
  component: AuthenticatedLayout,
})
