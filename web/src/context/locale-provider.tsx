import { createContext, useContext, useState } from 'react'
import i18n, {
  type Locale,
  setLocale as applyLocale,
  isSupportedLocale,
} from '@/lib/i18n'

type LocaleContextType = {
  locale: Locale
  setLocale: (locale: Locale) => void
}

const LocaleContext = createContext<LocaleContextType | null>(null)

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, _setLocale] = useState<Locale>(() =>
    isSupportedLocale(i18n.language) ? i18n.language : 'en'
  )

  const setLocale = (next: Locale) => {
    applyLocale(next)
    _setLocale(next)
  }

  return (
    <LocaleContext value={{ locale, setLocale }}>{children}</LocaleContext>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export const useLocale = () => {
  const context = useContext(LocaleContext)
  if (!context) {
    throw new Error('useLocale must be used within a LocaleProvider')
  }
  return context
}
