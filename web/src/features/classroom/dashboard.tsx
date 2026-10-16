import { useTranslation } from 'react-i18next'
import { useCan } from '@/lib/permissions'
import { Main } from '@/components/layout/main'
import { DashboardBoard } from './dashboard-board'
import { ClassroomHeader } from './layout-header'

export function ClassroomDashboard() {
  const { t } = useTranslation()
  // The API would answer 403 otherwise.
  const canCourses = useCan('courses:view')

  return (
    <>
      <ClassroomHeader fixed title={t('dashboard.title')} description={t('dashboard.desc')} />
      <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>{canCourses && <DashboardBoard />}</Main>
    </>
  )
}
