// Global test setup. Initializes i18n (side-effect import) so components that
// use `useTranslation` render real strings (default locale: en) in tests
// instead of raw keys.
import '@/lib/i18n'
