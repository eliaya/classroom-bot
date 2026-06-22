/**
 * Wires the portable `sync-notification` package to this app's backend.
 *
 * Side-effect module: importing it once (done by `@/components/notification-popup`)
 * configures the global sync-status source before the popup mounts. To reuse the
 * package in another app, write an equivalent adapter mapping that backend's
 * status into a `SyncSnapshot`.
 */
import { configureSyncNotification, type SyncSnapshot } from '@/packages/sync-notification'
import { api, type SyncRun } from '@/lib/api'

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

configureSyncNotification({
  source: async () => {
    const data = await api.syncStatus({ page: 1, limit: 10 })
    return runsToSnapshot(data.runs)
  },
})
