import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { getCookie, setCookie } from '@/lib/cookies'
import en from './locales/en'
import ja from './locales/ja'
import zhCN from './locales/zh-CN'
import zhTW from './locales/zh-TW'

/**
 * i18n setup. Strings live in src/lib/locales/<locale>.ts; en is the source of
 * truth and the fallback. New UI strings should be added as keys there rather
 * than hardcoded inline.
 */
export const defaultNS = 'translation'

export const resources = {
  en: { translation: en },
  'zh-TW': { translation: zhTW },
  'zh-CN': { translation: zhCN },
  ja: { translation: ja },
} as const

export type Locale = keyof typeof resources

// Language picker options (settings page + anywhere a switcher is shown).
export const SUPPORTED_LOCALES: { value: Locale; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'zh-TW', label: '繁體中文' },
  { value: 'zh-CN', label: '简体中文' },
  { value: 'ja', label: '日本語' },
]

const LOCALE_COOKIE = 'locale'
const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365 // 1 year

export function isSupportedLocale(value: string | undefined): value is Locale {
  return !!value && SUPPORTED_LOCALES.some((l) => l.value === value)
}

function initialLocale(): Locale {
  const saved = getCookie(LOCALE_COOKIE)
  return isSupportedLocale(saved) ? saved : 'en'
}

/** Persist + apply a locale (cookie, i18next, and <html lang>). */
export function setLocale(locale: Locale) {
  setCookie(LOCALE_COOKIE, locale, LOCALE_COOKIE_MAX_AGE)
  void i18n.changeLanguage(locale)
  if (typeof document !== 'undefined') {
    document.documentElement.lang = locale
  }
}

const startLocale = initialLocale()

void i18n.use(initReactI18next).init({
  resources,
  lng: startLocale,
  fallbackLng: 'en',
  defaultNS,
  interpolation: { escapeValue: false },
})

if (typeof document !== 'undefined') {
  document.documentElement.lang = startLocale
}

export default i18n
