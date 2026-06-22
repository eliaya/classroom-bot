import type {
  SyncNotificationConfig,
  SyncNotificationLabels,
  SyncStatusSource,
} from './types'

// Defaults preserve the original behavior/timings of the source system.
const DEFAULT_INTERVALS = {
  runningMs: 1500, // snappy progress updates while a job runs
  idleMs: 5000, // calmer watch for background/cron-started jobs
  autoDismissMs: 1000,
}

const DEFAULT_LABELS: SyncNotificationLabels = {
  syncingPercent: (percent) => `Syncing… ${percent}%`,
  successTitle: 'Sync complete',
  errorTitle: 'Sync failed',
  items: (count) => `${count} items`,
  showDetailsAria: 'Show details',
  hideDetailsAria: 'Hide details',
}

let _source: SyncStatusSource | null = null
let _intervals = DEFAULT_INTERVALS
let _labels = DEFAULT_LABELS

/** Wire the module to a backend (call once, before the popup mounts). */
export function configureSyncNotification(config: SyncNotificationConfig): void {
  _source = config.source
  _intervals = { ...DEFAULT_INTERVALS, ...config.intervals }
  _labels = { ...DEFAULT_LABELS, ...config.labels }
}

export const getSource = (): SyncStatusSource | null => _source
export const getIntervals = () => _intervals
export const getLabels = (): SyncNotificationLabels => _labels
