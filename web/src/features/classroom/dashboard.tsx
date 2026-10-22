import { useTranslation } from 'react-i18next'
import { useCan } from '@/lib/permissions'
import { Main } from '@/components/layout/main'
import { DashboardInbox } from './dashboard-inbox'
import { ClassroomHeader } from './layout-header'

export function ClassroomDashboard() {
  const { t } = useTranslation()
  // The API would answer 403 otherwise.
  const canCourses = useCan('courses:view')

  return (
    <>
      <ClassroomHeader fixed title={t('dashboard.title')} description={t('dashboard.desc')} />
      {/* Edge to edge, as the inbox7 block. */}
      <Main fixed className='p-0 sm:px-0 lg:px-0'>
        {canCourses && <DashboardInbox />}
      </Main>
    </>
  )
}
