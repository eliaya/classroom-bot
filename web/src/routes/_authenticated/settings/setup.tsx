import { createFileRoute } from '@tanstack/react-router'
import { SetupSection } from '@/features/classroom/settings/setup-section'

export const Route = createFileRoute('/_authenticated/settings/setup')({
  component: SetupSection,
})
