import { Tag } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { MailLabel } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { LabelDot } from './label-dot'

type LabelManagerProps = {
  /** The user's own labels with their place in the label list (for the dot colour). */
  labels: (readonly [MailLabel, number])[]
  applied: string[]
  disabled?: boolean
  onChange: (labelId: string, on: boolean) => void
}

/** Toolbar popover: tick the user's own Gmail labels on or off for the conversation. */
export function LabelManager({ labels, applied, disabled, onChange }: LabelManagerProps) {
  const { t } = useTranslation()
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button variant='ghost' size='icon' disabled={disabled}>
              <Tag />
              <span className='sr-only'>{t('mail.manageLabels')}</span>
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{t('mail.manageLabels')}</TooltipContent>
      </Tooltip>
      <PopoverContent align='start' className='w-56 p-2'>
        <p className='px-2 pb-2 text-[11px] font-medium text-muted-foreground uppercase'>
          {t('mail.manageLabels')}
        </p>
        {labels.length ? (
          <div className='grid gap-1'>
            {labels.map(([label, index]) => {
              const id = `mail-label-${label.id}`
              return (
                <div key={label.id} className='flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/60'>
                  <Checkbox
                    id={id}
                    checked={applied.includes(label.id)}
                    onCheckedChange={(on) => onChange(label.id, on === true)}
                  />
                  <LabelDot label={label} index={index} className='size-2' />
                  <Label htmlFor={id} className='min-w-0 flex-1 truncate font-normal'>
                    {label.name}
                  </Label>
                </div>
              )
            })}
          </div>
        ) : (
          <p className='px-2 pb-1 text-sm text-muted-foreground'>{t('mail.noLabels')}</p>
        )}
      </PopoverContent>
    </Popover>
  )
}
