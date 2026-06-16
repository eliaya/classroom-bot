import { createFileRoute } from '@tanstack/react-router'
import { TodoPage } from '@/features/classroom/todo-page'

export const Route = createFileRoute('/_authenticated/todos/')({
  component: TodoPage,
})
