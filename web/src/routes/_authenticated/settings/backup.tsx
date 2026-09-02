import { createFileRoute } from '@tanstack/react-router'
import { BackupSection } from '@/features/classroom/settings/backup-section'

export const Route = createFileRoute('/_authenticated/settings/backup')({
  component: BackupSection,
})
