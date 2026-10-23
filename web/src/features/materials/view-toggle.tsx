import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  LayoutGrid,
  List,
} from 'lucide-react'
import { MotionConfig, motion } from 'motion/react'
import { useTranslation } from 'react-i18next'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

export type MaterialsView = 'grid' | 'list'
export type MaterialsOrder = 'desc' | 'asc'

const VIEWS = [
  { id: 'grid', icon: LayoutGrid },
  { id: 'list', icon: List },
] as const

const ITEM =
  'group hover:text-foreground text-muted-foreground hover:bg-muted/40 relative inline-flex h-9 cursor-pointer items-center rounded-lg border-0 px-3.5 py-1.5 text-sm font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50'
const LABEL =
  'max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-all duration-300 ease-in-out group-hover:ml-2 group-hover:max-w-24 group-hover:opacity-100 group-focus-visible:ml-2 group-focus-visible:max-w-24 group-focus-visible:opacity-100'

/** Grid / List switch plus the created-date order, in one group: the sliding
 *  pill of shadcn-space toggle-group-01, with toggle-group-02's icon-only
 *  resting state (the label opens on hover/focus). */
export function ViewToggle({
  value,
  onChange,
  order,
  onOrder,
}: {
  value: MaterialsView
  onChange: (view: MaterialsView) => void
  order: MaterialsOrder
  onOrder: (order: MaterialsOrder) => void
}) {
  const { t } = useTranslation()
  const OrderIcon = order === 'desc' ? ArrowDownWideNarrow : ArrowUpNarrowWide
  const orderLabel = t(`materials.order.${order}`)
  return (
    <MotionConfig reducedMotion='user'>
      <div className='flex items-center gap-1 rounded-xl border bg-muted/40 p-1'>
        <ToggleGroup
          type='single'
          value={value}
          onValueChange={(v) => v && onChange(v as MaterialsView)}
          className='gap-1'
        >
          {VIEWS.map(({ id, icon: Icon }) => (
            <ToggleGroupItem
              key={id}
              value={id}
              aria-label={t(`materials.view.${id}`)}
              className={`${ITEM} data-[state=on]:bg-transparent data-[state=on]:text-primary-foreground data-[state=on]:hover:text-primary-foreground`}
            >
              <span className='relative z-10 flex items-center'>
                <Icon className='size-4' aria-hidden='true' />
                <span className={LABEL}>{t(`materials.view.${id}`)}</span>
              </span>
              {value === id && (
                <motion.span
                  layoutId='materials-view-pill'
                  className='absolute inset-0 z-0 rounded-lg bg-primary'
                  transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                />
              )}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <div className='h-5 w-px bg-border' aria-hidden='true' />
        {/* A two-way switch, so a plain button: its label says the current order. */}
        <button
          type='button'
          aria-label={orderLabel}
          onClick={() => onOrder(order === 'desc' ? 'asc' : 'desc')}
          className={ITEM}
        >
          <span className='flex items-center'>
            <OrderIcon className='size-4' aria-hidden='true' />
            <span className={LABEL}>{orderLabel}</span>
          </span>
        </button>
      </div>
    </MotionConfig>
  )
}
