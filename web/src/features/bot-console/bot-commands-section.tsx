import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api, type BotCommand } from '@/lib/api'
import { type NavigateFn } from '@/hooks/use-table-url-state'
import { BotCommandsTable } from '@/features/bot-commands/components/bot-commands-table'

type BotCommandsSectionProps = {
  search: { name?: string }
  navigate: NavigateFn
}

export function BotCommandsSection({ search, navigate }: BotCommandsSectionProps) {
  const { t } = useTranslation()
  const [commands, setCommands] = useState<BotCommand[]>([])
  const [error, setError] = useState<string | null>(null)

  const reload = () => {
    api
      .listBotCommands()
      .then((res) => setCommands(res.items))
      .catch((e) => setError(e instanceof Error ? e.message : t('common.loadFailed')))
  }

  useEffect(() => {
    reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className='flex flex-col gap-4'>
      {error && <p className='text-destructive text-sm'>{error}</p>}
      <BotCommandsTable
        data={commands}
        search={search}
        navigate={navigate}
        onChanged={reload}
      />
    </div>
  )
}
