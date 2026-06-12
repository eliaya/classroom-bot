import {
  GraduationCap,
  LayoutDashboard,
  RefreshCw,
  Users,
  BookOpen,
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
      name: 'Classroom Bot',
      logo: Command,
      plan: 'Google Classroom Sync',
    },
  ],
  navGroups: [
    {
      title: 'Classroom',
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
      ],
    },
    {
      title: 'Views',
      items: [
        {
          title: 'Stream',
          url: '/courses',
          icon: BookOpen,
        },
        {
          title: 'People',
          url: '/courses',
          icon: Users,
        },
      ],
    },
  ],
}