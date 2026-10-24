import { useEffect } from 'react'
import { applyFavicon, loadBranding, useBrandingStore } from '@/stores/branding-store'

/** Loads the site logo and favicon for every page, the sign-in page included. */
export function SiteBranding() {
  const favicon = useBrandingStore((state) => state.favicon)
  useEffect(loadBranding, [])
  useEffect(() => applyFavicon(favicon), [favicon])
  return null
}
