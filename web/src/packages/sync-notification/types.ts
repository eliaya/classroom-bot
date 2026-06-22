export type SyncPhase = 'idle' | 'running' | 'success' | 'error'

/**
 * Backend-agnostic, normalized sync status for a single poll. The consumer's
 * adapter maps its own API/data into this shape; the store/UI never touch the
 * backend directly.
 */
export type SyncSnapshot = {
  phase: SyncPhase
  runId: number | null
  progress: number // 0–100
  message: string | null
  resource: string | null
  itemsCount: number
}

/** Adapter the consumer provides to read current status from any backend. */
export type SyncStatusSource = () => Promise<SyncSnapshot>

/** Display strings. Provide plain strings, or wire to i18n via the popup's `labels` prop. */
export type SyncNotificationLabels = {
  syncingPercent: (percent: number) => string
  successTitle: string
  errorTitle: string
  items: (count: number) => string
  showDetailsAria: string
  hideDetailsAria: string
}

export type SyncNotificationConfig = {
  source: SyncStatusSource
  intervals?: Partial<{ runningMs: number; idleMs: number; autoDismissMs: number }>
  labels?: Partial<SyncNotificationLabels>
}
