import { type ColumnDef } from '@tanstack/react-table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DataTableColumnHeader } from '@/components/data-table'
import { LongText } from '@/components/long-text'
import { type Course } from '@/lib/api'
import { fullTimestamp, humanReadableTime } from '@/lib/utils'

export function coursesColumns(onSelect: (course: Course) => void): ColumnDef<Course>[] {
  return [
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
    accessorKey: 'week',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='Week' />
    ),
    meta: { className: 'w-16' },
    cell: ({ row }) => {
      // week 1-7 → 月..日, 8 → その他 (stored as a number in the DB).
      const WEEK_LABELS: Record<number, string> = {
        1: '月', 2: '火', 3: '水', 4: '木',
        5: '金', 6: '土', 7: '日', 8: 'その他',
      }
      const week = row.getValue('week') as number | null
      return typeof week === 'number' ? (
        <Badge variant='outline'>{WEEK_LABELS[week] ?? week}</Badge>
      ) : (
        '—'
      )
    },
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
    cell: ({ row }) => (
      <Button
        variant='ghost'
        size='sm'
        className='h-7 px-2 text-xs'
        onClick={(e) => {
          e.stopPropagation()
          onSelect(row.original)
        }}
      >
        View
      </Button>
    ),
  },
  ]
}