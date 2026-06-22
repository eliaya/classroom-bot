import { create } from 'zustand'
import { getIntervals, getSource } from './config'
import type { SyncPhase, SyncSnapshot } from './types'

export type { SyncPhase } from './types'

/**
 * Global, app-wide source of truth for the *currently observed* Sync Job.
 *
 * This store ONLY observes/reads sync status through the injected
 * `SyncStatusSource` adapter — it never triggers or performs a sync itself.
 * The `NotificationPopUp` component subscribes to this store and renders it.
 *
 * The watcher is *persistent*: once started (when the popup mounts) it keeps
 * polling for as long as the app is open, so a Sync Job kicked off anywhere —
 * including a background cron — pops the notification automatically. It polls
 * fast while a run is active and slowly when idle to keep background cost low.
 * Pages may still call `startPolling()` after firing a sync to force an
 * immediate check for instant feedback.
 */
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

export const useSyncStatusStore = create<SyncStatusState>()((set, get) => {
  // Self-scheduling loop: cadence follows the current phase so we watch
  // cheaply when idle and update smoothly while a run is active. A nudge after
  // an explicit trigger can request a near-term poll via `delayOverride`.
  const scheduleNext = (delayOverride?: number) => {
    if (!get()._watching) return
    const { _pollId } = get()
    if (_pollId != null) window.clearTimeout(_pollId)
    const { runningMs, idleMs } = getIntervals()
    const delay = delayOverride ?? (get().phase === 'running' ? runningMs : idleMs)
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
      scheduleNext(getIntervals().runningMs)
    },

    stopPolling: () => {
      const { _pollId } = get()
      if (_pollId != null) window.clearTimeout(_pollId)
      set({ _watching: false, _pollId: null })
    },

    refreshOnce: async () => {
      const source = getSource()
      if (source == null) return // not configured yet
      let snap: SyncSnapshot
      try {
        snap = await source()
      } catch {
        return // keep last known state on transient errors
      }

      const prevPhase = get().phase

      if (snap.phase === 'running') {
        // A job is running — reflect it live. Clear any pending auto-dismiss.
        const { _dismissId } = get()
        if (_dismissId != null) window.clearTimeout(_dismissId)
        set({
          phase: 'running',
          progress: snap.progress,
          message: snap.message,
          resource: snap.resource,
          itemsCount: snap.itemsCount,
          runId: snap.runId,
          dismissed: false,
          _dismissId: null,
        })
        return
      }

      // No active run. If we were running, transition to the final state. The
      // watcher keeps polling (slowly) so the next background/cron run is caught.
      if (prevPhase === 'running') {
        const phase: SyncPhase = snap.phase === 'error' ? 'error' : 'success'
        set({
          phase,
          progress: 100,
          message: snap.message,
          itemsCount: snap.itemsCount || get().itemsCount,
        })
        // Auto-dismiss the final state after a short while.
        const dismissId = window.setTimeout(() => {
          set({ phase: 'idle', _dismissId: null })
        }, getIntervals().autoDismissMs)
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
