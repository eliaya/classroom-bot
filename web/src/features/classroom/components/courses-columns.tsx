import { Link } from '@tanstack/react-router'
import { type ColumnDef } from '@tanstack/react-table'
import { ExternalLink, MoreHorizontal } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { DataTableColumnHeader } from '@/components/data-table'
import { LongText } from '@/components/long-text'
import { type Course } from '@/lib/api'
import { fullTimestamp, humanReadableTime } from '@/lib/utils'

export const coursesColumns: ColumnDef<Course>[] = [
  {
    accessorKey: 'name',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='Course name' />
    ),
    cell: ({ row }) => (
      <LongText className='max-w-[320px] font-medium'>
        {row.getValue('name')}
      </LongText>
    ),
    meta: { className: 'min-w-[260px]' },
    enableHiding: false,
  },
  {
    accessorKey: 'section',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='Section' />
    ),
    cell: ({ row }) => row.getValue('section') || '—',
  },
  {
    accessorKey: 'room',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='Room' />
    ),
    cell: ({ row }) => row.getValue('room') || '—',
  },
  {
    accessorKey: 'state',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='State' />
    ),
    cell: ({ row }) => {
      const state = row.getValue('state') as string | null
      return state ? (
        <Badge variant='outline' className='capitalize'>
          {state}
        </Badge>
      ) : (
        '—'
      )
    },
  },
  {
    accessorKey: 'synced_at',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='Synced at' />
    ),
    cell: ({ row }) => {
      const value = row.getValue('synced_at') as string | null
      return (
        <span
          className='text-muted-foreground text-sm'
          title={fullTimestamp(value) || undefined}
        >
          {humanReadableTime(value)}
        </span>
      )
    },
  },
  {
    id: 'actions',
    cell: ({ row }) => {
      const course = row.original
      return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant='ghost' className='h-8 w-8 p-0'>
              <span className='sr-only'>Open menu</span>
              <MoreHorizontal className='h-4 w-4' />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end'>
            <DropdownMenuLabel>Actions</DropdownMenuLabel>
            <DropdownMenuItem asChild>
              <Link
                to='/courses/$courseId/stream'
                params={{ courseId: course.id }}
              >
                View stream
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link
                to='/courses/$courseId/classwork'
                params={{ courseId: course.id }}
              >
                View classwork
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link
                to='/courses/$courseId/people'
                params={{ courseId: course.id }}
              >
                View people
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {course.alternate_link && (
              <DropdownMenuItem asChild>
                <a
                  href={course.alternate_link}
                  target='_blank'
                  rel='noreferrer'
                >
                  <ExternalLink className='me-2 h-4 w-4' />
                  Open in Classroom
                </a>
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )
    },
  },
]