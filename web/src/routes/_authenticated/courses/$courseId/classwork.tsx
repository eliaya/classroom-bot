import { z } from 'zod'
import { createFileRoute } from '@tanstack/react-router'
import { CourseClassworkPage } from '@/features/classroom/course-classwork'

const classworkSearchSchema = z.object({
  item: z.string().optional().catch(undefined),
  kind: z.enum(['coursework', 'material']).optional().catch(undefined),
})

export const Route = createFileRoute('/_authenticated/courses/$courseId/classwork')({
  validateSearch: classworkSearchSchema,
  component: function Component() {
    const { courseId } = Route.useParams()
    const { item, kind } = Route.useSearch()
    return (
      <CourseClassworkPage
        courseId={courseId}
        initialItemId={item}
        initialKind={kind}
      />
    )
  },
})
