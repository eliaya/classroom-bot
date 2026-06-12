import { createFileRoute } from '@tanstack/react-router'
import { SyncPage } from '@/features/classroom/sync-page'

export const Route = createFileRoute('/_authenticated/sync/')({
  component: SyncPage,
})