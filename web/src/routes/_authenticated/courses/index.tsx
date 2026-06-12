import z from 'zod'
import { createFileRoute } from '@tanstack/react-router'
import { CoursesListPage } from '@/features/classroom/courses-list'

const coursesSearchSchema = z.object({
  page: z.number().optional().catch(1),
  pageSize: z.number().optional().catch(10),
  name: z.string().optional().catch(''),
})

export const Route = createFileRoute('/_authenticated/courses/')({
  validateSearch: coursesSearchSchema,
  component: CoursesListPage,
})