import { createFileRoute } from '@tanstack/react-router'
import { CoursesListPage } from '@/features/classroom/courses-list'

export const Route = createFileRoute('/_authenticated/courses/')({
  component: CoursesListPage,
})