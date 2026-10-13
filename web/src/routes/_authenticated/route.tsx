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
    let user = auth.user
    if (!user) {
      // ponytail: fetched once per page load, so a role change reaches the
      // user on their next reload; refetch per navigation if that ever matters.
      try {
        user = await api.me()
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          throw redirect({ to: '/login', search: { redirect: location.href } })
        }
        throw error
      }
      auth.setUser(user)
    }
    // Administrators' pages are under /admin, everyone else's at the root:
    // reload into the right area, then wait for the page to unload.
    const base = isAdmin(user.permissions) ? ADMIN_BASE : ''
    if (base !== BASE) {
      window.location.replace(base + location.href)
      await new Promise(() => {})
    }
    if (user.permissions.length > 0 && !canOpen(user.permissions, location.pathname)) {
      throw redirect({ to: '/403' })
    }
  },
  component: AuthenticatedLayout,
})
