import { getRouteApi } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Main } from '@/components/layout/main'
import { Separator } from '@/components/ui/separator'
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
            <TabsTrigger value='commands'>
              {t('botCommands.title')} & {t('botMessages.title')}
            </TabsTrigger>
          </TabsList>
          <TabsContent value='links'>
            <LinksSection />
          </TabsContent>
          {/* Commands and message templates share one tab: a command's reply and
              the bot's built-in response strings are both "what the bot says". */}
          <TabsContent value='commands' className='flex flex-col gap-6'>
            <section className='flex flex-col gap-3'>
              <h3 className='text-sm font-semibold'>{t('botCommands.title')}</h3>
              <BotCommandsSection search={search} navigate={navigate} />
            </section>
            <Separator />
            <section className='flex flex-col gap-3'>
              <h3 className='text-sm font-semibold'>{t('botMessages.title')}</h3>
              <BotMessagesSection />
            </section>
          </TabsContent>
        </Tabs>
      </Main>
    </>
  )
}
