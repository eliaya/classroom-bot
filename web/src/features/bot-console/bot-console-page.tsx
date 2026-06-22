import { getRouteApi } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Main } from '@/components/layout/main'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ClassroomHeader } from '../classroom/layout-header'
import { BotCommandsSection } from './bot-commands-section'
import { BotMessagesSection } from './bot-messages-section'
import { LinksSection } from './links-section'

const route = getRouteApi('/_authenticated/bot/')

export function BotConsolePage() {
  const { t } = useTranslation()
  const search = route.useSearch()
  const navigate = route.useNavigate()

  return (
    <>
      <ClassroomHeader
        fixed
        title={t('botConsole.title')}
        description={t('botConsole.desc')}
      />
      <Main fluid className='flex flex-1 flex-col gap-4 sm:gap-6'>
        <Tabs defaultValue='links' className='flex flex-1 flex-col gap-4'>
          <TabsList>
            <TabsTrigger value='links'>{t('links.title')}</TabsTrigger>
            <TabsTrigger value='commands'>{t('botCommands.title')}</TabsTrigger>
            <TabsTrigger value='messages'>{t('botMessages.title')}</TabsTrigger>
          </TabsList>
          <TabsContent value='links'>
            <LinksSection />
          </TabsContent>
          <TabsContent value='commands'>
            <BotCommandsSection search={search} navigate={navigate} />
          </TabsContent>
          <TabsContent value='messages'>
            <BotMessagesSection />
          </TabsContent>
        </Tabs>
      </Main>
    </>
  )
}
