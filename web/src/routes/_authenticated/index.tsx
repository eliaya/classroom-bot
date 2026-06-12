import { createFileRoute } from '@tanstack/react-router'
import { ClassroomDashboard } from '@/features/classroom/dashboard'

export const Route = createFileRoute('/_authenticated/')({
  component: ClassroomDashboard,
})