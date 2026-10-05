import { createFileRoute } from '@tanstack/react-router'
import { UsersSection } from '@/features/classroom/settings/users-section'

export const Route = createFileRoute('/_authenticated/settings/users')({
  component: UsersSection,
})
