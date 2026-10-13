import { createFileRoute } from '@tanstack/react-router'
import { OpenCloudSection } from '@/features/classroom/settings/opencloud-section'

export const Route = createFileRoute('/_authenticated/settings/opencloud')({
  component: OpenCloudSection,
})
