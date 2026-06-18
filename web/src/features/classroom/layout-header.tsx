import { ConfigDrawer } from '@/components/config-drawer'
import { Header } from '@/components/layout/header'
import { TopNav } from '@/components/layout/top-nav'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

type NavLink = {
  title: string
  href: string
  isActive: boolean
  disabled?: boolean
}

type ClassroomHeaderProps = {
  topNav?: NavLink[]
  fixed?: boolean
  title?: string
  /** Shown as a tooltip on the title (the old in-page subtitle). */
  description?: string
}

export function ClassroomHeader({ topNav, fixed, title, description }: ClassroomHeaderProps) {
  return (
    <Header fixed={fixed}>
      {topNav && <TopNav links={topNav} className='me-auto' />}
      {title && !topNav &&
        (description ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <h2 className='me-auto cursor-default text-xl font-bold tracking-tight'>
                {title}
              </h2>
            </TooltipTrigger>
            <TooltipContent>{description}</TooltipContent>
          </Tooltip>
        ) : (
          <h2 className='me-auto text-xl font-bold tracking-tight'>{title}</h2>
        ))}
      <Search className={topNav || title ? undefined : 'ms-auto'} />
      <ThemeSwitch />
      <ConfigDrawer />
      <ProfileDropdown />
    </Header>
  )
}