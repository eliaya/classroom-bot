import { BASE } from '@/lib/area'
import { googleFontHref, themeFontFamilies, themeStyleCss, type ThemeTokens } from '@/lib/theme-tokens'

const STYLE_ID = 'theme-tokens'
const FONT_ATTR = 'data-theme-font'
/** Per area, so the admin's theme never paints the user panel; index.html reads it before React. */
export const THEME_CACHE_KEY = `theme-css:${BASE}`

/**
 * Puts a theme over the built-in colours (one <style> tag and its fonts' <link>s),
 * or removes it. `data-theme` on <html> tells styles/theme.css a theme is on, so
 * the Dashboard's neutral inbox7 tokens step aside.
 */
export function applyTheme(theme: { light: ThemeTokens; dark: ThemeTokens } | null): void {
  const root = document.documentElement
  const tag = document.getElementById(STYLE_ID)
  const fonts = theme ? themeFontFamilies(theme).map(googleFontHref) : []
  loadFonts(fonts)
  if (!theme) {
    tag?.remove()
    root.removeAttribute('data-theme')
    cache(null)
    return
  }
  const css = themeStyleCss(theme)
  const style = tag ?? document.createElement('style')
  style.id = STYLE_ID
  style.textContent = css
  // Last in <head>, after the app's own stylesheets.
  document.head.appendChild(style)
  root.setAttribute('data-theme', '')
  cache({ css, fonts })
}

function cache(value: { css: string; fonts: string[] } | null) {
  try {
    if (value) localStorage.setItem(THEME_CACHE_KEY, JSON.stringify(value))
    else localStorage.removeItem(THEME_CACHE_KEY)
  } catch {
    // Storage off (private mode): the theme still applies, a reload just shows the built-in colours first.
  }
}

/** One <link> per family, so one Google does not host fails alone; switching theme drops the old ones. */
function loadFonts(hrefs: string[]) {
  const wanted = new Set(hrefs)
  for (const link of document.querySelectorAll<HTMLLinkElement>(`link[${FONT_ATTR}]`)) {
    if (!wanted.delete(link.getAttribute('href') ?? '')) link.remove()
  }
  for (const href of wanted) {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = href
    link.setAttribute(FONT_ATTR, '')
    document.head.appendChild(link)
  }
}
