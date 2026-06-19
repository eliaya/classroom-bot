import { create } from 'zustand'
import { api, type SyncRun } from '@/lib/api'

/**
 * Global, app-wide source of truth for the *currently observed* Sync Job.
 *
 * This store ONLY observes/reads sync status from the existing API — it never
 * triggers or performs a sync itself (that stays on the Sync Page). The
 * `NotificationPopUp` component subscribes to this store and renders it; the
 * Sync Page nudges `startPolling()` after firing a sync for instant feedback.
 */

export type SyncPhase = 'idle' | 'running' | 'success' | 'error'

const POLL_INTERVAL_MS = 1500
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

export const useSyncStatusStore = create<SyncStatusState>()((set, get) => ({
  phase: 'idle',
  progress: 0,
  message: null,
  resource: null,
  itemsCount: 0,
  runId: null,
  dismissed: false,
  _pollId: null,
  _dismissId: null,

  startPolling: () => {
    if (get()._pollId != null) return
    const id = window.setInterval(() => void get().refreshOnce(), POLL_INTERVAL_MS)
    set({ _pollId: id })
    void get().refreshOnce()
  },

  stopPolling: () => {
    const { _pollId } = get()
    if (_pollId != null) {
      window.clearInterval(_pollId)
      set({ _pollId: null })
    }
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
      if (_dismissId != null) {
        window.clearTimeout(_dismissId)
      }
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

    // No active run. If we were running, transition to the final state.
    if (prevPhase === 'running') {
      const finalRun = pickFinalRun(runs, get().runId)
      const phase: SyncPhase = finalRun?.status === 'error' ? 'error' : 'success'
      set({
        phase,
        progress: 100,
        message: finalRun?.message ?? finalRun?.error_message ?? null,
        itemsCount: finalRun?.items_count ?? get().itemsCount,
      })
      get().stopPolling()
      // Auto-dismiss the final state after a short while.
      const dismissId = window.setTimeout(() => {
        set({ phase: 'idle', _dismissId: null })
      }, AUTO_DISMISS_MS)
      set({ _dismissId: dismissId })
    } else if (prevPhase === 'idle') {
      // Nothing running and nothing to show — stop the idle polling loop.
      get().stopPolling()
    }
  },

  dismiss: () => {
    const { _dismissId } = get()
    if (_dismissId != null) window.clearTimeout(_dismissId)
    set({ phase: 'idle', dismissed: true, _dismissId: null })
  },
}))
