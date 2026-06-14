import { useEffect, useState } from 'react'
import { useLayout } from '@/context/layout-provider'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from '@/components/ui/sidebar'
// import { AppTitle } from './app-title'
import { sidebarData } from './data/sidebar-data'
import { NavGroup } from './nav-group'
import { NavUser } from './nav-user'
import { TeamSwitcher } from './team-switcher'
import { api } from '@/lib/api'

export function AppSidebar() {
  const { collapsible, variant } = useLayout()
  const [version, setVersion] = useState<string | null>(null)

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
        <TeamSwitcher teams={sidebarData.teams} />

        {/* Replace <TeamSwitch /> with the following <AppTitle />
         /* if you want to use the normal app title instead of TeamSwitch dropdown */}
        {/* <AppTitle /> */}
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
          {version ? `Classroom Bot v${version}` : 'Classroom Bot'}
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
