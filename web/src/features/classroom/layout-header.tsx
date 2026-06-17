import { ConfigDrawer } from '@/components/config-drawer'
import { Header } from '@/components/layout/header'
import { TopNav } from '@/components/layout/top-nav'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'

type NavLink = {
  title: string
  href: string
  isActive: boolean
  disabled?: boolean
}

type ClassroomHeaderProps = {
  topNav?: NavLink[]
  fixed?: boolean
}

export function ClassroomHeader({ topNav, fixed }: ClassroomHeaderProps) {
  return (
    <Header fixed={fixed}>
      {topNav && <TopNav links={topNav} className='me-auto' />}
      <Search className={topNav ? undefined : 'ms-auto'} />
      <ThemeSwitch />
      <ConfigDrawer />
      <ProfileDropdown />
    </Header>
  )
}