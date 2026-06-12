import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated/courses/$courseId/')({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/courses/$courseId/stream',
      params: { courseId: params.courseId },
    })
  },
  component: () => null,
})