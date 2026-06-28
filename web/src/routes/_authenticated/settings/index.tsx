import { createFileRoute } from '@tanstack/react-router'
import { StatusSection } from '@/features/classroom/settings/status-section'

export const Route = createFileRoute('/_authenticated/settings/')({
  component: StatusSection,
})