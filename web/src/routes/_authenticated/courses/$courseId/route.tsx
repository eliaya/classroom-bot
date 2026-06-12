import { createFileRoute } from '@tanstack/react-router'
import { CourseLayout } from '@/features/classroom/course-layout'

export const Route = createFileRoute('/_authenticated/courses/$courseId')({
  component: function Component() {
    const { courseId } = Route.useParams()
    return <CourseLayout courseId={courseId} />
  },
})