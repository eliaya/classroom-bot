import { useAuthStore } from '@/stores/auth-store'
import { type NavGroup } from '@/components/layout/types'

/** Held by the admin role: every permission. */
const WILDCARD = '*'

/**
 * A person's own Classroom data and Discord bot. These are used in the root
 * area only, so the wildcard does not open them: the admin area has no
 * courses, to-dos, sync, OpenCloud, bot or mail pages.
 */
const USER_MODULES: readonly string[] = ['courses', 'todos', 'sync', 'links', 'bot', 'mail']

/** Does this permission list grant `key` (e.g. `sync:use`)? */
export function can(permissions: readonly string[], key: string): boolean {
  if (permissions.includes(key)) return true
  return permissions.includes(WILDCARD) && !USER_MODULES.includes(key.split(':')[0])
}

/** Administrators (the wildcard holders) use the `/admin` area. */
export function isAdmin(permissions: readonly string[]): boolean {
  return permissions.includes(WILDCARD)
}

/**
 * Page path prefix -> permissions that open it (any one is enough). The route
 * guard, sidebar, settings nav and command menu all read this one table; a
 * path matching no entry (dashboard, settings status/language) is open
 * to every approved user. The API enforces the same keys on its own.
 */
export const ROUTE_PERMISSIONS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['/courses', ['courses:view']],
  // Shows the courses' posts.
  ['/calendar', ['courses:view']],
  ['/search', ['search:view']],
  // The user's own Gmail.
  ['/mail', ['mail:view']],
  ['/sync', ['sync:view']],
  ['/audit', ['audit:view']],
  // Two tabs: channel links (links) and bot commands (bot).
  ['/bot', ['links:view', 'bot:view']],
  ['/settings/opencloud', ['sync:view']],
  // A user's own sync schedule.
  ['/settings/scheduler', ['sync:view']],
  ['/settings/audit', ['audit:view']],
  ['/settings/backup', ['backup:view']],
  ['/settings/users', ['users:view']],
  ['/settings/roles', ['users:view']],
  // Server setup guide: administrators only.
  ['/settings/setup', [WILDCARD]],
]

/** Permissions that open `pathname` (any-of), or null when it needs none. */
export function requiredPermissions(pathname: string): readonly string[] | null {
  const path = pathname.split(/[?#]/)[0]
  const hit = ROUTE_PERMISSIONS.find(
    ([prefix]) => path === prefix || path.startsWith(`${prefix}/`)
  )
  return hit ? hit[1] : null
}

export function canOpen(permissions: readonly string[], pathname: string): boolean {
  const needed = requiredPermissions(pathname)
  return needed === null || needed.some((key) => can(permissions, key))
}

/** Sidebar groups with the pages this user may not open removed. */
export function visibleNav(groups: NavGroup[], permissions: readonly string[]): NavGroup[] {
  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => !item.url || canOpen(permissions, item.url)),
    }))
    .filter((group) => group.items.length > 0)
}

/** The signed-in user's permission keys (empty while signed out). */
export function usePermissions(): readonly string[] {
  return useAuthStore((state) => state.auth.user?.permissions) ?? NONE
}

/** True when the signed-in user holds `key`. Use to disable what the API would refuse. */
export function useCan(key: string): boolean {
  return can(usePermissions(), key)
}

const NONE: readonly string[] = []
