import { create } from 'zustand'
import { api, fileUrl, type SiteBranding } from '@/lib/api'

// The site logo and favicon (Settings → Branding), read once per page and
// replaced by whatever an upload or removal answers.
export const useBrandingStore = create<SiteBranding>()(() => ({ logo: null, favicon: null }))

export function loadBranding(): void {
  api
    .siteBranding()
    .then((branding) => useBrandingStore.setState(branding))
    .catch(() => {
      // The built-in logo and favicon stay.
    })
}

/** Points index.html's icon links at the uploaded favicon, or back at their own. */
export function applyFavicon(path: string | null): void {
  document.querySelectorAll<HTMLLinkElement>('link[rel="icon"]').forEach((link) => {
    link.dataset.href ??= link.getAttribute('href') ?? ''
    link.dataset.type ??= link.getAttribute('type') ?? ''
    link.href = path ? fileUrl(path) : link.dataset.href
    // The built-in links name their type; an uploaded .ico or .png is neither svg nor png.
    if (path) link.removeAttribute('type')
    else if (link.dataset.type) link.type = link.dataset.type
  })
}
