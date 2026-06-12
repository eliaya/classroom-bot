import { createFileRoute } from '@tanstack/react-router'
import { CoursePeoplePage } from '@/features/classroom/course-people'

export const Route = createFileRoute('/_authenticated/courses/$courseId/people')({
  component: function Component() {
    const { courseId } = Route.useParams()
    return <CoursePeoplePage courseId={courseId} />
  },
})