import { useLocation } from '@tanstack/react-router'
import { ConfigDrawer } from '@/components/config-drawer'
import { Header } from '@/components/layout/header'
import { TopNav } from '@/components/layout/top-nav'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { SyncButton } from '@/components/sync-button'
import { ThemeSwitch } from '@/components/theme-switch'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { TagPicker } from '@/features/tags/tag-picker'

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
  /** What the header's tags are on; the page itself by default, none for null. */
  tagTarget?: string | null
}

export function ClassroomHeader({ topNav, fixed, title, description, tagTarget }: ClassroomHeaderProps) {
  const pathname = useLocation({ select: (location) => location.pathname })
  return (
    <Header fixed={fixed}>
      {topNav && <TopNav links={topNav} className='me-auto' />}
      {title && !topNav &&
        (description ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <h2 className='me-auto cursor-default text-3xl font-medium tracking-tight'>
                {title}
              </h2>
            </TooltipTrigger>
            <TooltipContent>{description}</TooltipContent>
          </Tooltip>
        ) : (
          <h2 className='me-auto text-3xl font-medium tracking-tight'>{title}</h2>
        ))}
      {/* Wide screens only: the top bar has no room beside the title on a phone.
          Its height is capped so many tags scroll instead of growing the bar. */}
      {tagTarget !== null && (
        <TagPicker
          target={tagTarget ?? `page:${pathname}`}
          className='hidden min-w-0 flex-1 lg:block lg:max-w-60 xl:max-w-80 [&_[role=combobox]]:max-h-12 [&_[role=combobox]]:overflow-y-auto'
        />
      )}
      <Search className={topNav || title ? undefined : 'ms-auto'} />
      <ThemeSwitch />
      <ConfigDrawer />
      <SyncButton />
      <ProfileDropdown />
    </Header>
  )
}