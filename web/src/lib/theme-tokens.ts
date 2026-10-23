/**
 * Theme tokens from tweakcn.com: the same sanitising rules as the server's
 * src/themes.py, the CSS text that applies a theme, and the install dialog's
 * name helpers. A token's value lands in a <style> tag, so it is checked again
 * here before every injection.
 */

export type ThemeTokens = Record<string, string>

export const THEME_TOKEN_KEYS = [
  'background', 'foreground', 'card', 'card-foreground', 'popover', 'popover-foreground',
  'primary', 'primary-foreground', 'secondary', 'secondary-foreground', 'muted', 'muted-foreground',
  'accent', 'accent-foreground', 'destructive', 'border', 'input', 'ring',
  'chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5',
] as const
const CORE = new Set<string>(THEME_TOKEN_KEYS)
const NAME = /^[a-z][a-z0-9-]{0,39}$/
const SAFE_COLOR = /^[a-zA-Z0-9#%.,()/\s-]+$/
const SAFE_TOKEN = /^[a-zA-Z0-9#%.,()/\s'"+*-]+$/
const FORBIDDEN = /url\s*\(|\/\*|\*\//i
const VALUE_MAX = 400
const EXTRA_MAX = 80

export function isSafeColorValue(value: string): boolean {
  const v = value.trim()
  return v.length > 0 && v.length <= VALUE_MAX && SAFE_COLOR.test(v) && !FORBIDDEN.test(v)
}

export function isSafeThemeValue(value: string): boolean {
  const v = value.trim()
  return (
    v.length > 0 &&
    v.length <= VALUE_MAX &&
    SAFE_TOKEN.test(v) &&
    v.split('"').length % 2 === 1 &&
    v.split("'").length % 2 === 1 &&
    !FORBIDDEN.test(v)
  )
}

/** Every usable token of a map; an unusable name or value is dropped, never repaired. */
export function pickThemeTokens(value: unknown): ThemeTokens {
  const out: ThemeTokens = {}
  let extras = 0
  for (const [key, raw] of Object.entries((value ?? {}) as Record<string, unknown>)) {
    if (typeof raw !== 'string' || !NAME.test(key)) continue
    const core = CORE.has(key)
    if (core ? !isSafeColorValue(raw) : !isSafeThemeValue(raw)) continue
    if (!core && ++extras > EXTRA_MAX) continue
    out[key] = raw.trim()
  }
  return out
}

/**
 * The rules that put a theme over styles/theme.css: both modes at once, so the
 * light/dark switch keeps working. `html:root` / `html.dark` outrank theme.css's
 * `:root` / `.dark` whatever order the stylesheets load in.
 */
export function themeStyleCss(theme: { light: unknown; dark: unknown }): string {
  const light = pickThemeTokens(theme.light)
  const dark = pickThemeTokens(theme.dark)
  // tweakcn's tracking-* are calc(var(--tracking-normal) ± n), with the base in
  // the light block only, and in one preset the keyword `normal`, which breaks
  // every calc(). So the keyword is replaced, from letter-spacing or 0em.
  const base = (t: ThemeTokens) => {
    const ls = t['letter-spacing']
    return ls && ls !== 'normal' ? ls : '0em'
  }
  const usesTracking = [light, dark].some((t) => Object.keys(t).some((k) => k.startsWith('tracking-')))
  if (light['tracking-normal'] === 'normal' || (usesTracking && !light['tracking-normal'])) {
    light['tracking-normal'] = base(light)
  }
  if (dark['tracking-normal'] === 'normal') dark['tracking-normal'] = base(dark)

  const vars = (t: ThemeTokens) =>
    Object.entries(t)
      .map(([key, value]) => `--${key}:${value}`)
      .join(';')
  // FontProvider's font-* class sits in Tailwind's utilities layer; this unlayered rule wins over it.
  const font = light['font-sans'] || dark['font-sans'] ? 'html{font-family:var(--font-sans)}' : ''
  return `html:root{${vars(light)}}html.dark{${vars(dark)}}${font}`
}

// System and generic families: never on Google Fonts.
const LOCAL_FONT =
  /^(ui-|-apple-|system-ui$|blinkmacsystemfont$|(sans-serif|serif|monospace|cursive|fantasy|emoji|math)$|georgia$|menlo$|monaco$|consolas$|courier new$|arial$|helvetica|times new roman$|segoe ui)/i

/** The first family of each font stack a theme sets: the one it asks for. */
export function themeFontFamilies(theme: { light: ThemeTokens; dark: ThemeTokens }): string[] {
  const families = new Set<string>()
  for (const tokens of [theme.light, theme.dark]) {
    for (const key of ['font-sans', 'font-serif', 'font-mono']) {
      const first = tokens[key]?.split(',')[0]?.trim().replace(/^["']|["']$/g, '')
      if (first && !LOCAL_FONT.test(first)) families.add(first)
    }
  }
  return [...families]
}

export function googleFontHref(family: string): string {
  const name = encodeURIComponent(family).replace(/%20/g, '+')
  return `https://fonts.googleapis.com/css2?family=${name}:wght@400;500;600;700&display=swap`
}

/** Some of tweakcn's built-in presets, offered as the install dialog's suggestions. */
export const TWEAKCN_PRESETS = [
  'modern-minimal', 'violet-bloom', 't3-chat', 'mocha-mousse', 'amethyst-haze', 'doom-64',
  'kodama-grove', 'cosmic-night', 'quantum-rose', 'bold-tech', 'elegant-luxury', 'amber-minimal',
  'neo-brutalism', 'solar-dusk', 'pastel-dreams', 'clean-slate', 'ocean-breeze', 'retro-arcade',
  'midnight-bloom', 'northern-lights', 'vintage-paper', 'sunset-horizon', 'starry-night', 'soft-pop',
  'sage-garden', 'perpetuity',
] as const

/** "Doom 64" -> "doom-64": a preset name typed the way the user reads it. */
export const slugify = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

/** The theme id in a share link (tweakcn.com/themes/<id>), or null. */
export const shareLinkId = (text: string) => /tweakcn\.com\/themes\/([a-z0-9-]+)/i.exec(text)?.[1] ?? null
