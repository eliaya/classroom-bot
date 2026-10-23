import { describe, expect, it } from 'vitest'
import {
  googleFontHref,
  pickThemeTokens,
  shareLinkId,
  slugify,
  themeFontFamilies,
  themeStyleCss,
} from './theme-tokens'

describe('theme tokens', () => {
  it('keeps usable tokens and drops whatever could leave the <style> tag', () => {
    expect(
      pickThemeTokens({
        background: ' oklch(0.98 0 0) ',
        primary: 'url(//evil.example/x)',
        'font-sans': '"Inter", sans-serif',
        radius: '1rem;} body{display:none',
        spacing: '/* x */ 1px',
        'font-mono': "'unbalanced",
        'Bad Name': 'red',
        number: 3,
      })
    ).toEqual({ background: 'oklch(0.98 0 0)', 'font-sans': '"Inter", sans-serif' })
  })

  it('writes both modes over the built-in colours, the font, and a usable tracking base', () => {
    const css = themeStyleCss({
      light: { background: '#fff', 'font-sans': 'Oxanium, sans-serif', 'tracking-normal': 'normal', 'letter-spacing': '0.02em' },
      dark: { background: '#000', inject: 'red;}' },
    })
    expect(css).toBe(
      'html:root{--background:#fff;--font-sans:Oxanium, sans-serif;--tracking-normal:0.02em;--letter-spacing:0.02em}' +
        'html.dark{--background:#000}html{font-family:var(--font-sans)}'
    )
    // Tracking tokens without a base get one; no font token, no font rule.
    expect(themeStyleCss({ light: { 'tracking-wide': 'calc(var(--tracking-normal) + 0.025em)' }, dark: {} })).toBe(
      'html:root{--tracking-wide:calc(var(--tracking-normal) + 0.025em);--tracking-normal:0em}html.dark{}'
    )
  })

  it('loads only the fonts Google hosts', () => {
    expect(
      themeFontFamilies({
        light: { 'font-sans': '"Oxanium", sans-serif', 'font-mono': 'ui-monospace, monospace' },
        dark: { 'font-serif': 'Georgia, serif' },
      })
    ).toEqual(['Oxanium'])
    expect(googleFontHref('Space Grotesk')).toBe(
      'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&display=swap'
    )
  })

  it('reads preset names and share links', () => {
    expect(slugify(' Doom 64 ')).toBe('doom-64')
    expect(shareLinkId('see https://tweakcn.com/themes/cmlhfpjhw000004l4f4ax3m7z please')).toBe(
      'cmlhfpjhw000004l4f4ax3m7z'
    )
    expect(shareLinkId('doom-64')).toBeNull()
  })
})
