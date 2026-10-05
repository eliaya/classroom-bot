import { createFileRoute } from '@tanstack/react-router'
import { RolesSection } from '@/features/classroom/settings/roles-section'

export const Route = createFileRoute('/_authenticated/settings/roles')({
  component: RolesSection,
})
