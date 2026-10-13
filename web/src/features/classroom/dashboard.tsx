import { useTranslation } from 'react-i18next'
import { useCan } from '@/lib/permissions'
import { Main } from '@/components/layout/main'
import { ClassroomHeader } from './layout-header'
import { TodoBoard } from './todo-board'

export function ClassroomDashboard() {
  const { t } = useTranslation()
  // The API would answer 403 otherwise (administrators have no to-dos).
  const canTodos = useCan('todos:view')

  return (
    <>
      <ClassroomHeader fixed title={t('dashboard.title')} description={t('dashboard.desc')} />
      <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>{canTodos && <TodoBoard />}</Main>
    </>
  )
}
