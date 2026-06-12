import {
  GraduationCap,
  LayoutDashboard,
  RefreshCw,
  Settings,
  Command,
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
      title: 'General',
      items: [
        {
          title: 'Dashboard',
          url: '/',
          icon: LayoutDashboard,
        },
        {
          title: 'Courses',
          url: '/courses',
          icon: GraduationCap,
        },
        {
          title: 'Sync',
          url: '/sync',
          icon: RefreshCw,
        },
        {
          title: 'Settings',
          url: '/settings',
          icon: Settings,
        },
      ],
    },
  ],
}