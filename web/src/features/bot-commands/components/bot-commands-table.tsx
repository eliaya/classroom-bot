import { useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { type NavigateFn } from '@/hooks/use-table-url-state'
import { type BotCommand } from '@/lib/api'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { CommandDetail } from './command-detail'

type BotCommandsTableProps = {
  data: BotCommand[]
  search: { name?: string }
  navigate: NavigateFn
  onChanged: () => void
}

// `null` = no panel, 'new' = create panel, otherwise the selected command.
type Selection = BotCommand | 'new' | null

export function BotCommandsTable({ data, search, navigate, onChanged }: BotCommandsTableProps) {
  const { t } = useTranslation()
  const [selection, setSelection] = useState<Selection>(null)
  const [filter, setFilter] = useState(search.name ?? '')

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return data
    return data.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.description ?? '').toLowerCase().includes(q)
    )
  }, [data, filter])

  const panelOpen = selection !== null
  const selectedId = selection && selection !== 'new' ? selection.id : null

  const onFilterChange = (value: string) => {
    setFilter(value)
    navigate({ search: (prev: Record<string, unknown>) => ({ ...prev, name: value || undefined }) })
  }

  return (
    <div className='flex flex-col gap-4'>
      {/* Toolbar: search + New command */}
      <div className='flex items-center justify-between gap-2'>
        <Input
          value={filter}
          onChange={(e) => onFilterChange(e.target.value)}
          placeholder={t('botCommands.filter')}
          className='h-8 w-[150px] lg:w-[250px]'
        />
        <Button size='sm' className='h-8' onClick={() => setSelection('new')}>
          <Plus className='size-4' />
          {t('botCommands.new')}
        </Button>
      </div>

      <div className='flex flex-col gap-3 lg:flex-row lg:items-start'>
        <div
          className={cn(
            'overflow-hidden rounded-md border transition-[width] duration-300 ease-out',
            panelOpen ? 'lg:w-[30%]' : 'w-full'
          )}
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('botCommands.name')}</TableHead>
                {!panelOpen && <TableHead>{t('botCommands.trigger')}</TableHead>}
                {!panelOpen && <TableHead>{t('botCommands.enabled')}</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length ? (
                filtered.map((cmd) => {
                  const isSelected = selectedId === cmd.id
                  return (
                    <TableRow
                      key={cmd.id}
                      data-state={isSelected ? 'selected' : undefined}
                      className='cursor-pointer'
                      onClick={() => setSelection(isSelected ? null : cmd)}
                    >
                      <TableCell className='font-medium'>
                        <span className='font-mono text-xs text-muted-foreground'>
                          {cmd.group_name ? `/${cmd.group_name} ` : cmd.trigger}
                        </span>
                        {cmd.name}
                        {cmd.kind === 'builtin' && (
                          <span className='ms-2 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground'>
                            {t('botCommands.builtin')}
                          </span>
                        )}
                      </TableCell>
                      {!panelOpen && (
                        <TableCell className='font-mono text-xs'>
                          {cmd.kind === 'builtin' ? 'slash' : cmd.trigger}
                        </TableCell>
                      )}
                      {!panelOpen && (
                        <TableCell>
                          <span
                            className={cn(
                              'rounded px-1.5 py-0.5 text-[10px] font-medium',
                              cmd.enabled
                                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                                : 'bg-muted text-muted-foreground'
                            )}
                          >
                            {cmd.enabled ? t('botCommands.on') : t('botCommands.off')}
                          </span>
                        </TableCell>
                      )}
                    </TableRow>
                  )
                })
              ) : (
                <TableRow>
                  <TableCell colSpan={panelOpen ? 1 : 3} className='h-24 text-center'>
                    {t('botCommands.noCommands')}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        {panelOpen && (
          <CommandDetail
            key={selection === 'new' ? 'new' : selection.id}
            command={selection === 'new' ? null : selection}
            onClose={() => setSelection(null)}
            onSaved={(saved) => {
              setSelection(saved)
              onChanged()
            }}
            onDeleted={() => {
              setSelection(null)
              onChanged()
            }}
          />
        )}
      </div>
    </div>
  )
}
