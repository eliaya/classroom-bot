import { useLayout } from '@/context/layout-provider'
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarTrigger,
} from '@/components/ui/sidebar'
import { sidebarData } from './data/sidebar-data'
import { NavGroup } from './nav-group'
import { visibleNav } from '@/lib/permissions'
import { useAuthStore } from '@/stores/auth-store'
import { useBrandingStore } from '@/stores/branding-store'
import { fileUrl } from '@/lib/api'

export function AppSidebar() {
  const { collapsible, variant } = useLayout()
  const team = sidebarData.teams[0]
  const user = useAuthStore((state) => state.auth.user)
  const logo = useBrandingStore((state) => state.logo)

  return (
    <Sidebar collapsible={collapsible} variant={variant}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size='lg'
              className='hover:bg-transparent active:bg-transparent'
              asChild
            >
              <div>
                {logo ? (
                  <img src={fileUrl(logo)} alt='' className='aspect-square size-8 shrink-0 rounded-lg object-contain' />
                ) : (
                  <div className='flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground'>
                    <team.logo className='size-4' />
                  </div>
                )}
                <div className='grid flex-1 text-start text-sm leading-tight'>
                  <span className='truncate font-semibold'>{team.name}</span>
                  <span className='truncate text-xs'>{team.plan}</span>
                </div>
                <SidebarTrigger className='ms-auto' />
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {visibleNav(sidebarData.navGroups, user?.permissions ?? []).map((props) => (
          <NavGroup key={props.title} {...props} />
        ))}
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  )
}
