// Re-export shim: the store now lives in the portable `sync-notification`
// package. Existing call sites import `useSyncStatusStore` from here unchanged;
// the app's backend is wired in `@/lib/sync-notification-setup`.
export { useSyncStatusStore, type SyncPhase } from '@/packages/sync-notification'
