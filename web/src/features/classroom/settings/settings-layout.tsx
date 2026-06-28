import { Link, Outlet } from '@tanstack/react-router'
import {
  Activity,
  BookOpen,
  CalendarClock,
  Languages,
  ScrollText,
  type LucideIcon,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { buttonVariants } from '@/components/ui/button'
import { Main } from '@/components/layout/main'
import { cn } from '@/lib/utils'
import { ClassroomHeader } from '../layout-header'

type NavItem = { to: string; label: string; icon: LucideIcon; exact?: boolean }

const navItems: NavItem[] = [
  { to: '/settings', label: 'settings.nav.status', icon: Activity, exact: true },
  { to: '/settings/language', label: 'settings.nav.language', icon: Languages },
  { to: '/settings/scheduler', label: 'settings.nav.scheduler', icon: CalendarClock },
  { to: '/settings/audit', label: 'settings.nav.audit', icon: ScrollText },
  { to: '/settings/setup', label: 'settings.nav.setup', icon: BookOpen },
]

/** Settings shell: header + a left sub-sidebar that routes to each section. */
export function SettingsLayout() {
  const { t } = useTranslation()
  return (
    <>
      <ClassroomHeader fixed title={t('settings.title')} description={t('settings.desc')} />
      <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>
        <div className='flex flex-1 flex-col gap-6 lg:flex-row lg:gap-8'>
          <aside className='lg:w-56 lg:shrink-0'>
            <nav className='flex gap-1 overflow-x-auto lg:flex-col'>
              {navItems.map(({ to, label, icon: Icon, exact }) => (
                <Link
                  key={to}
                  to={to}
                  activeOptions={{ exact: !!exact }}
                  activeProps={{
                    className: cn(buttonVariants({ variant: 'secondary' }), 'justify-start whitespace-nowrap'),
                  }}
                  inactiveProps={{
                    className: cn(buttonVariants({ variant: 'ghost' }), 'justify-start whitespace-nowrap'),
                  }}
                >
                  <Icon className='me-2 h-4 w-4' />
                  {t(label)}
                </Link>
              ))}
            </nav>
          </aside>
          <div className='flex flex-1 flex-col gap-4 sm:gap-6'>
            <Outlet />
          </div>
        </div>
      </Main>
    </>
  )
}
