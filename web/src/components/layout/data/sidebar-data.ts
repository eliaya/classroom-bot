import {
  GraduationCap,
  LayoutDashboard,
  RefreshCw,
  ScrollText,
  Settings,
  Command,
  ClipboardList,
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
          title: 'To-do',
          url: '/todos',
          icon: ClipboardList,
        },
        {
          title: 'Sync',
          url: '/sync',
          icon: RefreshCw,
        },
        {
          title: 'Audit log',
          url: '/audit',
          icon: ScrollText,
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