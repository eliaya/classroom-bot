import { createFileRoute } from '@tanstack/react-router'
import { ClassroomSettingsPage } from '@/features/classroom/settings-page'

export const Route = createFileRoute('/_authenticated/settings/')({
  component: ClassroomSettingsPage,
})