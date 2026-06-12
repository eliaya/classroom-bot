import { createFileRoute } from '@tanstack/react-router'
import { CourseClassworkPage } from '@/features/classroom/course-classwork'

export const Route = createFileRoute('/_authenticated/courses/$courseId/classwork')({
  component: function Component() {
    const { courseId } = Route.useParams()
    return <CourseClassworkPage courseId={courseId} />
  },
})