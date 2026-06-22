import {
  GraduationCap,
  LayoutDashboard,
  RefreshCw,
  ScrollText,
  Settings,
  Command,
  ClipboardList,
  Bot,
} from 'lucide-react'
import { type SidebarData } from '../types'

export const sidebarData: SidebarData = {
  user: {
    name: 'Classroom Admin',
    email: 'admin@classroom-bot.local',
    avatar: '/avatars/shadcn.jpg',
  },
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
          title: 'nav.todo',
          url: '/todos',
          icon: ClipboardList,
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