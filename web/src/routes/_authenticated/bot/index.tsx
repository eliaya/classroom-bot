import z from 'zod'
import { createFileRoute } from '@tanstack/react-router'
import { BotConsolePage } from '@/features/bot-console/bot-console-page'

// `name` filters the Bot commands tab (kept in the URL like the old page did).
const botSearchSchema = z.object({
  name: z.string().optional().catch(''),
})

export const Route = createFileRoute('/_authenticated/bot/')({
  validateSearch: botSearchSchema,
  component: BotConsolePage,
})
