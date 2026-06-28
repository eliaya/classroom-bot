import { createFileRoute } from '@tanstack/react-router'
import { LanguageSection } from '@/features/classroom/settings/language-section'

export const Route = createFileRoute('/_authenticated/settings/language')({
  component: LanguageSection,
})
