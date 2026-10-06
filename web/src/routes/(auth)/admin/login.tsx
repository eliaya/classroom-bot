import { z } from 'zod'
import { createFileRoute } from '@tanstack/react-router'
import { AdminSignIn } from '@/features/auth/sign-in/admin-sign-in'

const searchSchema = z.object({
  redirect: z.string().optional(),
})

export const Route = createFileRoute('/(auth)/admin/login')({
  component: AdminSignIn,
  validateSearch: searchSchema,
})
