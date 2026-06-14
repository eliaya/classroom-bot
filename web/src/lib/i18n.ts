import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

/**
 * Minimal i18n setup. The app was previously hardcoded in English; this
 * introduces the infrastructure and keys for the strings touched by the
 * Dashboard / Sync / Courses UI work. New strings should be added as keys
 * here rather than hardcoded inline.
 */
export const defaultNS = 'translation'

export const resources = {
  en: {
    translation: {
      common: {
        dash: '—',
        never: 'Never',
        lastCheck: 'Last check',
      },
      dashboard: {
        lastSync: 'Last sync',
        mostRecentRun: 'Most recent run',
        botStatus: 'Discord Bot',
        botStatusDesc: 'Bot connection status',
        oauthValidLabel: 'Valid',
      },
      bot: {
        connected: 'Connected',
        disconnected: 'Disconnected',
        disabled: 'Disabled',
        error: 'Error',
        unknown: 'Unknown',
      },
      sync: {
        actionLabel: 'Action',
        clear: 'Clear',
        clearStuck: 'Clear stuck',
        viewDetails: 'View details',
      },
      courses: {
        courseName: 'Course name',
        section: 'Section',
        room: 'Room',
        state: 'State',
        syncedAt: 'Synced at',
      },
    },
  },
} as const

void i18n.use(initReactI18next).init({
  resources,
  lng: 'en',
  fallbackLng: 'en',
  defaultNS,
  interpolation: { escapeValue: false },
})

export default i18n
