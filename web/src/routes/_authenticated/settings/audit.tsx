import { createFileRoute } from '@tanstack/react-router'
import { AuditSection } from '@/features/classroom/settings/audit-section'

export const Route = createFileRoute('/_authenticated/settings/audit')({
  component: AuditSection,
})
