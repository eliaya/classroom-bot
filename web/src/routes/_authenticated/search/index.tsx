import { z } from 'zod'
import { createFileRoute } from '@tanstack/react-router'
import { SearchPage } from '@/features/classroom/search-page'

const searchSchema = z.object({
  q: z.string().optional().catch(''),
  category: z.enum(['course', 'classwork', 'stream']).optional().catch(undefined),
})

export const Route = createFileRoute('/_authenticated/search/')({
  validateSearch: searchSchema,
  component: SearchPage,
})
