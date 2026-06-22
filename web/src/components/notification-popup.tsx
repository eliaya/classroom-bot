import { useTranslation } from 'react-i18next'
import { NotificationPopUp as BaseNotificationPopUp } from '@/packages/sync-notification'
// Side-effect: configure the package's sync-status source for this app.
import '@/lib/sync-notification-setup'

/**
 * App wrapper around the portable `NotificationPopUp`: injects this app's i18n
 * strings so the notification stays reactive to language changes. The package
 * itself is i18n-free; other apps can mount `NotificationPopUp` directly.
 */
export function NotificationPopUp() {
  const { t } = useTranslation()
  return (
    <BaseNotificationPopUp
      labels={{
        syncingPercent: (percent) => t('notification.syncingPercent', { percent }),
        successTitle: t('notification.successTitle'),
        errorTitle: t('notification.errorTitle'),
        items: (count) => t('notification.items', { count }),
        showDetailsAria: t('notification.showDetailsAria'),
        hideDetailsAria: t('notification.hideDetailsAria'),
      }}
    />
  )
}
