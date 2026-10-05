/**
 * Full-page navigation, for leaving the SPA router (Google sign-in, the
 * sign-in page after a session ends, a file download). Its own module so
 * browser tests can mock it: `window.location` cannot be spied on.
 */
export function hardNavigate(url: string): void {
  window.location.assign(url)
}
