import '@/styles/index.css'
import { afterEach, describe, expect, it } from 'vitest'
import { THEME_CACHE_KEY, applyTheme } from './theme'

const THEME = {
  light: { primary: 'rgb(1, 2, 3)', 'font-sans': '"Oxanium", sans-serif' },
  dark: { primary: 'rgb(4, 5, 6)' },
}

describe('applyTheme', () => {
  afterEach(() => {
    applyTheme(null)
    document.documentElement.classList.remove('dark')
    document.body.replaceChildren()
  })

  it('puts the theme over the built-in colours, the Dashboard inbox included, in both modes', () => {
    const inbox = document.body.appendChild(document.createElement('div'))
    inbox.className = 'inbox7'
    const primary = (el: Element) => getComputedStyle(el).getPropertyValue('--primary').trim()
    // Without a theme the inbox keeps its own neutral tokens.
    const neutral = primary(inbox)
    expect(neutral).not.toBe(primary(document.documentElement))

    applyTheme(THEME)
    expect(document.documentElement.hasAttribute('data-theme')).toBe(true)
    expect(primary(document.documentElement)).toBe('rgb(1, 2, 3)')
    expect(primary(inbox)).toBe('rgb(1, 2, 3)')
    document.documentElement.classList.add('dark')
    expect(primary(inbox)).toBe('rgb(4, 5, 6)')
    expect(document.querySelectorAll('link[data-theme-font]')).toHaveLength(1)
    // Cached for this area, for index.html to paint before React on the next load.
    expect(JSON.parse(localStorage.getItem(THEME_CACHE_KEY)!).css).toContain('--primary:rgb(1, 2, 3)')

    applyTheme(null)
    document.documentElement.classList.remove('dark')
    expect(document.getElementById('theme-tokens')).toBeNull()
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
    expect(document.querySelectorAll('link[data-theme-font]')).toHaveLength(0)
    expect(localStorage.getItem(THEME_CACHE_KEY)).toBeNull()
    expect(primary(inbox)).toBe(neutral)
  })
})
