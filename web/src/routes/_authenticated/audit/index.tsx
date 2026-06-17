import { createFileRoute } from '@tanstack/react-router'
import { AuditPage } from '@/features/classroom/audit-page'

export const Route = createFileRoute('/_authenticated/audit/')({
  component: AuditPage,
})
