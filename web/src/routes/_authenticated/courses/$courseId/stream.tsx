import { createFileRoute } from '@tanstack/react-router'
import { CourseStreamPage } from '@/features/classroom/course-stream'

export const Route = createFileRoute('/_authenticated/courses/$courseId/stream')({
  component: function Component() {
    const { courseId } = Route.useParams()
    return <CourseStreamPage courseId={courseId} />
  },
})