import { createFileRoute } from '@tanstack/react-router'
import { BrandingSection } from '@/features/classroom/settings/branding-section'

export const Route = createFileRoute('/_authenticated/settings/branding')({
  component: BrandingSection,
})
