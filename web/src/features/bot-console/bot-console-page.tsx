import { getRouteApi } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useCan } from '@/lib/permissions'
import { Main } from '@/components/layout/main'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ClassroomHeader } from '../classroom/layout-header'
import { BotCommandsSection } from './bot-commands-section'
import { LinksSection } from './links-section'

const route = getRouteApi('/_authenticated/bot/')

export function BotConsolePage() {
  const { t } = useTranslation()
  const search = route.useSearch()
  const navigate = route.useNavigate()
  // Two modules share this page: channel links (per user) and bot commands (system).
  const canLinks = useCan('links:view')
  const canCommands = useCan('bot:view')

  return (
    <>
      <ClassroomHeader
        fixed
        title={t('botConsole.title')}
        description={t('botConsole.desc')}
      />
      <Main fluid className='flex flex-1 flex-col gap-4 sm:gap-6'>
        <Tabs defaultValue={canLinks ? 'links' : 'commands'} className='flex flex-1 flex-col gap-4'>
          <TabsList>
            {canLinks && <TabsTrigger value='links'>{t('links.title')}</TabsTrigger>}
            {canCommands && <TabsTrigger value='commands'>{t('botCommands.title')}</TabsTrigger>}
          </TabsList>
          {canLinks && (
            <TabsContent value='links'>
              <LinksSection />
            </TabsContent>
          )}
          {/* Message templates (`<command>.*`) are edited inside each command's
              detail panel — see CommandMessages. */}
          {canCommands && (
            <TabsContent value='commands'>
              <BotCommandsSection search={search} navigate={navigate} />
            </TabsContent>
          )}
        </Tabs>
      </Main>
    </>
  )
}
