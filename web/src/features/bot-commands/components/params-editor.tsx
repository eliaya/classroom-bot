import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

// Mirrors the backend (src/cogs/custom_commands.py::PARAM_TYPES).
const PARAM_TYPES = ['string', 'integer', 'number', 'boolean', 'user'] as const
type ParamType = (typeof PARAM_TYPES)[number]
const CHOICE_TYPES: ParamType[] = ['string', 'integer', 'number']

type ParamRow = {
  name: string
  type: ParamType
  description: string
  required: boolean
  choices: string // comma-separated values, UI-only
}

type ParamsEditorProps = {
  /** The serialized JSON string stored in BotCommand.params. */
  value: string
  onChange: (next: string) => void
}

function deserialize(raw: string): ParamRow[] {
  try {
    const data = JSON.parse(raw || '[]')
    if (!Array.isArray(data)) return []
    return data.map((it: Record<string, unknown>) => ({
      name: String(it.name ?? ''),
      type: (PARAM_TYPES as readonly string[]).includes(it.type as string)
        ? (it.type as ParamType)
        : 'string',
      description: String(it.description ?? ''),
      required: Boolean(it.required),
      choices: Array.isArray(it.choices)
        ? it.choices
            .map((c: Record<string, unknown>) => String(c?.value ?? ''))
            .filter(Boolean)
            .join(', ')
        : '',
    }))
  } catch {
    return []
  }
}

function serialize(rows: ParamRow[]): string {
  const out = rows
    .filter((r) => r.name.trim())
    .map((r) => {
      const o: Record<string, unknown> = {
        name: r.name.trim().toLowerCase(),
        type: r.type,
        required: r.required,
      }
      if (r.description.trim()) o.description = r.description.trim()
      if (CHOICE_TYPES.includes(r.type) && r.choices.trim()) {
        o.choices = r.choices
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
          .map((v) => ({
            name: v,
            value:
              r.type === 'integer'
                ? parseInt(v, 10)
                : r.type === 'number'
                  ? parseFloat(v)
                  : v,
          }))
      }
      return o
    })
  return out.length ? JSON.stringify(out) : ''
}

export function ParamsEditor({ value, onChange }: ParamsEditorProps) {
  const { t } = useTranslation()
  const [rows, setRows] = useState<ParamRow[]>(() => deserialize(value))

  const commit = (next: ParamRow[]) => {
    setRows(next)
    onChange(serialize(next))
  }

  const update = (idx: number, patch: Partial<ParamRow>) =>
    commit(rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)))

  const add = () =>
    commit([
      ...rows,
      { name: '', type: 'string', description: '', required: false, choices: '' },
    ])

  const remove = (idx: number) => commit(rows.filter((_, i) => i !== idx))

  return (
    <div className='flex flex-col gap-3'>
      <div className='flex items-center justify-between'>
        <Label>{t('botCommands.paramsTitle')}</Label>
        <Button type='button' variant='outline' size='sm' className='h-7' onClick={add}>
          <Plus className='size-3.5' />
          {t('botCommands.addParam')}
        </Button>
      </div>
      <p className='text-xs text-muted-foreground'>{t('botCommands.paramsHint')}</p>

      {rows.length === 0 ? (
        <p className='rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground'>
          {t('botCommands.noParams')}
        </p>
      ) : (
        rows.map((row, idx) => (
          <div key={idx} className='flex flex-col gap-2 rounded-md border p-3'>
            <div className='flex items-start gap-2'>
              <div className='grid flex-1 gap-2 sm:grid-cols-2'>
                <Input
                  value={row.name}
                  onChange={(e) => update(idx, { name: e.target.value })}
                  placeholder={t('botCommands.paramName')}
                  className='font-mono'
                />
                <Select
                  value={row.type}
                  onValueChange={(v) => update(idx, { type: v as ParamType })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PARAM_TYPES.map((tp) => (
                      <SelectItem key={tp} value={tp}>
                        {t(`botCommands.paramType_${tp}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                type='button'
                variant='ghost'
                size='sm'
                className='h-9 px-2 text-destructive'
                onClick={() => remove(idx)}
                aria-label={t('botCommands.removeParam')}
              >
                <Trash2 className='size-4' />
              </Button>
            </div>

            <Input
              value={row.description}
              onChange={(e) => update(idx, { description: e.target.value })}
              placeholder={t('botCommands.paramDesc')}
            />

            {CHOICE_TYPES.includes(row.type) && (
              <Input
                value={row.choices}
                onChange={(e) => update(idx, { choices: e.target.value })}
                placeholder={t('botCommands.paramChoices')}
              />
            )}

            <div className='flex items-center gap-2'>
              <Switch
                checked={row.required}
                onCheckedChange={(v) => update(idx, { required: v })}
              />
              <Label className='text-sm font-normal'>{t('botCommands.paramRequired')}</Label>
            </div>
          </div>
        ))
      )}
    </div>
  )
}
