/**
 * The app is served in two areas with the same pages: administrators under
 * `/admin/*`, everyone else at the root. The area is fixed by the URL the page
 * was loaded at and is the router's basepath; the route guard reloads a
 * signed-in user who is in the wrong one.
 */
export const ADMIN_BASE = '/admin'

/** URL prefix of the area `pathname` is in: `/admin`, or `''` for the root. */
export function areaOf(pathname: string): string {
  return pathname === ADMIN_BASE || pathname.startsWith(`${ADMIN_BASE}/`) ? ADMIN_BASE : ''
}

export const BASE = areaOf(window.location.pathname)
