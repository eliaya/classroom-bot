# sync-notification

A portable, top-centered "Sync Job" notification: a persistent background
watcher (Zustand) + a compact popup UI. Backend-agnostic — you inject a status
source; the package owns the polling cadence, phase transitions, and rendering.

It only **reads** status (never triggers a sync), so a job started anywhere —
a button, or a background cron — pops the notification automatically.

## Install (copy-in)

Copy the `sync-notification/` folder into your app. It expects the same stack
as the source system:

| Peer | Used for |
|------|----------|
| `react` (18/19) + `react-dom` | rendering |
| `zustand` | the watcher store |
| `lucide-react` | status icons |
| Tailwind CSS | styling (utility classes + theme tokens: `bg-card`, `text-primary`, `bg-muted`, `text-destructive`, `bg-emerald-500`, …) |
| shadcn/ui `Button` at `@/components/ui/button` | the details toggle |
| `cn` helper at `@/lib/utils` | class merging |
| `@/` path alias → your `src/` | imports resolve |

`react-i18next` is **not** required. Translations are optional via the popup's
`labels` prop.

## The contract

Your adapter maps your backend into one normalized snapshot per poll:

```ts
type SyncSnapshot = {
  phase: 'idle' | 'running' | 'success' | 'error'
  runId: number | null
  progress: number      // 0–100
  message: string | null
  resource: string | null
  itemsCount: number
}

type SyncStatusSource = () => Promise<SyncSnapshot>
```

- Return `phase: 'running'` with live `progress`/`message`/`resource`/`itemsCount`
  while a job runs.
- When nothing is running, return the **most recent finished** run as
  `'success'` / `'error'` (the store only surfaces it right after a running →
  finished transition, then auto-dismisses).
- Return `phase: 'idle'` only when there is no run at all.

## Integrate (4 lines)

```ts
configureSyncNotification({ source: async () => mapMyApi(await myApi.status()) })
// then mount once in your app shell:
<NotificationPopUp />            // English defaults
<NotificationPopUp labels={l} /> // or your own/i18n strings
```

Call `configureSyncNotification(...)` once at startup (before the popup mounts).
From any page, `useSyncStatusStore.getState().startPolling()` forces an immediate
re-check for instant feedback after firing a sync.

## Map a different backend

Write a `SyncStatusSource` that reduces your data into a `SyncSnapshot`. Example
for an app whose `/status` returns a list of runs (newest first):

```ts
configureSyncNotification({
  source: async () => {
    const runs = await myApi.listRuns()
    const active = runs.find((r) => r.state === 'in_progress')
    if (active) return { phase: 'running', runId: active.id, progress: active.pct ?? 0,
      message: active.note ?? null, resource: active.target ?? null, itemsCount: active.count ?? 0 }
    const last = runs.find((r) => r.state !== 'in_progress')
    if (!last) return { phase: 'idle', runId: null, progress: 0, message: null, resource: null, itemsCount: 0 }
    return { phase: last.state === 'failed' ? 'error' : 'success', runId: last.id, progress: 100,
      message: last.note ?? last.error ?? null, resource: null, itemsCount: last.count ?? 0 }
  },
  intervals: { runningMs: 1500, idleMs: 5000, autoDismissMs: 1000 }, // optional, these are defaults
  labels: { successTitle: 'Done', errorTitle: 'Failed' },           // optional
})
```

## API

- `configureSyncNotification(config)` — set `source`, optional `intervals`, optional `labels`.
- `<NotificationPopUp labels?={...} />` — mount once; subscribes and renders.
- `useSyncStatusStore` — Zustand store; `startPolling()`, `stopPolling()`,
  `refreshOnce()`, `dismiss()`, plus `phase`/`progress`/`message`/`resource`/`itemsCount`.

## Reactive i18n (optional)

The package bakes nothing at config time for labels. For language switching,
pass `labels` from a component that re-renders on locale change:

```tsx
function AppNotificationPopUp() {
  const { t } = useTranslation()
  return <NotificationPopUp labels={{
    syncingPercent: (p) => t('notification.syncingPercent', { percent: p }),
    successTitle: t('notification.successTitle'),
    errorTitle: t('notification.errorTitle'),
    items: (c) => t('notification.items', { count: c }),
    showDetailsAria: t('notification.showDetailsAria'),
    hideDetailsAria: t('notification.hideDetailsAria'),
  }} />
}
```
