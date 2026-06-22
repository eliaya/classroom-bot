import { create } from 'zustand'
import { api, type SyncRun } from '@/lib/api'

/**
 * Global, app-wide source of truth for the *currently observed* Sync Job.
 *
 * This store ONLY observes/reads sync status from the existing API — it never
 * triggers or performs a sync itself (that stays on the Sync Page). The
 * `NotificationPopUp` component subscribes to this store and renders it.
 *
 * The watcher is *persistent*: once started (when the authenticated layout
 * mounts) it keeps polling for as long as the app is open, so a Sync Job kicked
 * off anywhere — Sync Now, Run Now, or a background cron — pops the notification
 * automatically. It polls fast while a run is active and slowly when idle to
 * keep background cost low. Pages may still call `startPolling()` after firing a
 * sync to force an immediate check for instant feedback.
 */

export type SyncPhase = 'idle' | 'running' | 'success' | 'error'

const RUNNING_POLL_MS = 1500 // snappy progress updates while a job runs
const IDLE_POLL_MS = 5000 // calmer watch for background/cron-started jobs
const AUTO_DISMISS_MS = 1000

interface SyncStatusState {
  phase: SyncPhase
  progress: number // 0–100
  message: string | null
  resource: string | null
  itemsCount: number
  runId: number | null
  /** User manually closed the current notification; suppress until next run. */
  dismissed: boolean

  // internal timers (not for rendering)
  _watching: boolean
  _pollId: number | null
  _dismissId: number | null

  startPolling: () => void
  stopPolling: () => void
  refreshOnce: () => Promise<void>
  dismiss: () => void
}

function pickFinalRun(runs: SyncRun[], runId: number | null): SyncRun | undefined {
  if (runId != null) {
    const exact = runs.find((r) => r.id === runId)
    if (exact) return exact
  }
  // Fall back to the most recent non-running run.
  return runs.find((r) => r.status !== 'running')
}

export const useSyncStatusStore = create<SyncStatusState>()((set, get) => {
  // Self-scheduling loop: cadence follows the current phase so we watch
  // cheaply when idle and update smoothly while a run is active. A nudge after
  // an explicit trigger can request a near-term poll via `delayOverride`.
  const scheduleNext = (delayOverride?: number) => {
    if (!get()._watching) return
    const { _pollId } = get()
    if (_pollId != null) window.clearTimeout(_pollId)
    const delay = delayOverride ?? (get().phase === 'running' ? RUNNING_POLL_MS : IDLE_POLL_MS)
    const id = window.setTimeout(async () => {
      await get().refreshOnce()
      scheduleNext()
    }, delay)
    set({ _pollId: id })
  }

  return {
    phase: 'idle',
    progress: 0,
    message: null,
    resource: null,
    itemsCount: 0,
    runId: null,
    dismissed: false,
    _watching: false,
    _pollId: null,
    _dismissId: null,

    startPolling: () => {
      // Always refresh immediately for instant feedback after a trigger.
      void get().refreshOnce()
      if (!get()._watching) set({ _watching: true })
      // (Re)schedule a near-term poll so a just-fired sync — which may not be
      // visible as "running" yet — is detected within a second.
      scheduleNext(RUNNING_POLL_MS)
    },

    stopPolling: () => {
      const { _pollId } = get()
      if (_pollId != null) window.clearTimeout(_pollId)
      set({ _watching: false, _pollId: null })
    },

    refreshOnce: async () => {
      let runs: SyncRun[]
      try {
        const data = await api.syncStatus({ page: 1, limit: 10 })
        runs = data.runs
      } catch {
        return // keep last known state on transient errors
      }

      const active = runs.find((r) => r.status === 'running')
      const prevPhase = get().phase

      if (active) {
        // A job is running — reflect it live. Clear any pending auto-dismiss.
        const { _dismissId } = get()
        if (_dismissId != null) window.clearTimeout(_dismissId)
        set({
          phase: 'running',
          progress: active.percent != null ? Math.max(0, Math.min(100, active.percent)) : 0,
          message: active.message ?? null,
          resource: active.resource ?? null,
          itemsCount: active.items_count ?? 0,
          runId: active.id,
          dismissed: false,
          _dismissId: null,
        })
        return
      }

      // No active run. If we were running, transition to the final state. The
      // watcher keeps polling (slowly) so the next background/cron run is caught.
      if (prevPhase === 'running') {
        const finalRun = pickFinalRun(runs, get().runId)
        const phase: SyncPhase = finalRun?.status === 'error' ? 'error' : 'success'
        set({
          phase,
          progress: 100,
          message: finalRun?.message ?? finalRun?.error_message ?? null,
          itemsCount: finalRun?.items_count ?? get().itemsCount,
        })
        // Auto-dismiss the final state after a short while.
        const dismissId = window.setTimeout(() => {
          set({ phase: 'idle', _dismissId: null })
        }, AUTO_DISMISS_MS)
        set({ _dismissId: dismissId })
      }
    },

    dismiss: () => {
      const { _dismissId } = get()
      if (_dismissId != null) window.clearTimeout(_dismissId)
      set({ phase: 'idle', dismissed: true, _dismissId: null })
    },
  }
})
