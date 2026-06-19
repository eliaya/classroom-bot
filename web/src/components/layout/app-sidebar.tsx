import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLayout } from '@/context/layout-provider'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarTrigger,
} from '@/components/ui/sidebar'
import { sidebarData } from './data/sidebar-data'
import { NavGroup } from './nav-group'
import { NavUser } from './nav-user'
import { api } from '@/lib/api'

export function AppSidebar() {
  const { t } = useTranslation()
  const { collapsible, variant } = useLayout()
  const [version, setVersion] = useState<string | null>(null)
  const team = sidebarData.teams[0]

  useEffect(() => {
    api
      .version()
      .then((res) => {
        if (res.version) setVersion(res.version)
      })
      .catch(() => {
        // silent fail, version display is non-critical
      })
  }, [])

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
                <div className='flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground'>
                  <team.logo className='size-4' />
                </div>
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
        {sidebarData.navGroups.map((props) => (
          <NavGroup key={props.title} {...props} />
        ))}
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={sidebarData.user} />
        {/* Version display in admin sidebar */}
        <div className="px-3 py-1 text-center text-[10px] font-mono text-muted-foreground/70 select-none border-t border-sidebar-border/50 mt-1">
          {version ? t('sidebar.appVersion', { version }) : t('sidebar.appName')}
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
