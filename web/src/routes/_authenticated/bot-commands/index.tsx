import z from 'zod'
import { createFileRoute } from '@tanstack/react-router'
import { BotCommandsPage } from '@/features/bot-commands/bot-commands-page'

const botCommandsSearchSchema = z.object({
  name: z.string().optional().catch(''),
})

export const Route = createFileRoute('/_authenticated/bot-commands/')({
  validateSearch: botCommandsSearchSchema,
  component: BotCommandsPage,
})
