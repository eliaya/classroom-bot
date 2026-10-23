import { createFileRoute } from '@tanstack/react-router'
import { MaterialsPage } from '@/features/materials/materials-page'

// A folder inside the storage: /materials/<folder>/<sub>.
export const Route = createFileRoute('/_authenticated/materials/$')({
  component: MaterialsPage,
})
