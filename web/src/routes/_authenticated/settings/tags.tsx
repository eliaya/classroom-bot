import { createFileRoute } from '@tanstack/react-router'
import { TagsSection } from '@/features/classroom/settings/tags-section'

export const Route = createFileRoute('/_authenticated/settings/tags')({
  component: TagsSection,
})
