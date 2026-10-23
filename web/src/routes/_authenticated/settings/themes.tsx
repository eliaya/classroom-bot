import { createFileRoute } from '@tanstack/react-router'
import { ThemesSection } from '@/features/classroom/settings/themes-section'

export const Route = createFileRoute('/_authenticated/settings/themes')({
  component: ThemesSection,
})
