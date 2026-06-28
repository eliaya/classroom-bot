import { createFileRoute } from '@tanstack/react-router'
import { SchedulerSection } from '@/features/classroom/settings/scheduler-section'

export const Route = createFileRoute('/_authenticated/settings/scheduler')({
  component: SchedulerSection,
})
