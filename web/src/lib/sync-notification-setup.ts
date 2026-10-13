/**
 * Wires the portable `sync-notification` package to this app's backend.
 *
 * Side-effect module: importing it once (done by `@/components/notification-popup`)
 * configures the global sync-status source before the popup mounts. To reuse the
 * package in another app, write an equivalent adapter mapping that backend's
 * status into a `SyncSnapshot`.
 */
import { configureSyncNotification, type SyncSnapshot } from '@/packages/sync-notification'
import { toast } from 'sonner'
import { api, type SyncRun } from '@/lib/api'
import i18n from '@/lib/i18n'

/** Reduce this app's run list into the package's normalized snapshot. */
function runsToSnapshot(runs: SyncRun[]): SyncSnapshot {
  const active = runs.find((r) => r.status === 'running')
  if (active) {
    return {
      phase: 'running',
      runId: active.id,
      progress: active.percent != null ? Math.max(0, Math.min(100, active.percent)) : 0,
      message: active.message ?? null,
      resource: active.resource ?? null,
      itemsCount: active.items_count ?? 0,
    }
  }
  // Most recent non-running run = the just-finished one.
  const final = runs.find((r) => r.status !== 'running')
  if (final == null) {
    return { phase: 'idle', runId: null, progress: 0, message: null, resource: null, itemsCount: 0 }
  }
  return {
    phase: final.status === 'error' ? 'error' : 'success',
    runId: final.id,
    progress: 100,
    message: final.message ?? final.error_message ?? null,
    resource: null,
    itemsCount: final.items_count ?? 0,
  }
}

// The run last seen running, so its outcome is announced once when it ends.
let watchedRunId: number | null = null

/** With external storage on, attachments leave the server: tell the user. */
function notifyExternalStorage(runs: SyncRun[]) {
  const active = runs.find((r) => r.status === 'running')
  if (active) {
    watchedRunId = active.id
    return
  }
  const finished = runs.find((r) => r.id === watchedRunId)
  watchedRunId = null
  if (finished?.external_attachments) {
    toast.info(i18n.t('sync.externalStored', { count: finished.external_attachments }))
  }
}

configureSyncNotification({
  source: async () => {
    const data = await api.syncStatus({ page: 1, limit: 10 })
    notifyExternalStorage(data.runs)
    return runsToSnapshot(data.runs)
  },
})
