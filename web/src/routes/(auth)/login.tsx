import { z } from 'zod'
import { createFileRoute } from '@tanstack/react-router'
import { BASE } from '@/lib/area'
import { SignIn } from '@/features/auth/sign-in'
import { AdminSignIn } from '@/features/auth/sign-in/admin-sign-in'

const searchSchema = z.object({
  redirect: z.string().optional(),
  // Set by the API when a Google sign-in attempt fails.
  auth: z.string().optional(),
  reason: z.string().optional(),
})

export const Route = createFileRoute('/(auth)/login')({
  // Under /admin this is the administrators' password form (/admin/login).
  component: BASE ? AdminSignIn : SignIn,
  validateSearch: searchSchema,
})
