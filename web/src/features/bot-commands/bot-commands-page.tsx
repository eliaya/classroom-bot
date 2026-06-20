import { useEffect, useState } from 'react'
import { getRouteApi } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Main } from '@/components/layout/main'
import { api, type BotCommand } from '@/lib/api'
import { ClassroomHeader } from '../classroom/layout-header'
import { BotCommandsTable } from './components/bot-commands-table'

const route = getRouteApi('/_authenticated/bot-commands/')

export function BotCommandsPage() {
  const { t } = useTranslation()
  const search = route.useSearch()
  const navigate = route.useNavigate()
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
    <>
      <ClassroomHeader
        fixed
        title={t('botCommands.title')}
        description={t('botCommands.desc')}
      />
      <Main fluid className='flex flex-1 flex-col gap-4 sm:gap-6'>
        {error && <p className='text-destructive text-sm'>{error}</p>}
        <BotCommandsTable
          data={commands}
          search={search}
          navigate={navigate}
          onChanged={reload}
        />
      </Main>
    </>
  )
}
