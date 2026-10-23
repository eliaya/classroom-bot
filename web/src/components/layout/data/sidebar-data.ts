import {
  CalendarDays,
  FolderOpen,
  GraduationCap,
  LayoutDashboard,
  RefreshCw,
  ScrollText,
  Settings,
  Command,
  Bot,
} from 'lucide-react'
import { type SidebarData } from '../types'

export const sidebarData: SidebarData = {
  teams: [
    {
      name: 'Classroom Bot Admin',
      logo: Command,
      plan: 'Google Classroom Sync',
    },
  ],
  navGroups: [
    {
      // Titles are i18n keys, translated at render time (see nav-group / command-menu).
      title: 'nav.general',
      items: [
        {
          title: 'nav.dashboard',
          url: '/',
          icon: LayoutDashboard,
        },
        {
          title: 'nav.courses',
          url: '/courses',
          icon: GraduationCap,
        },
        {
          title: 'nav.calendar',
          url: '/calendar',
          icon: CalendarDays,
        },
        {
          title: 'nav.materials',
          url: '/materials',
          icon: FolderOpen,
        },
        {
          title: 'nav.sync',
          url: '/sync',
          icon: RefreshCw,
        },
        {
          title: 'nav.audit',
          url: '/audit',
          icon: ScrollText,
        },
        {
          title: 'nav.botConsole',
          url: '/bot',
          icon: Bot,
        },
        {
          title: 'nav.settings',
          url: '/settings',
          icon: Settings,
        },
      ],
    },
  ],
}