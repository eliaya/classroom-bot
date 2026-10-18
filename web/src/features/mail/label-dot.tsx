import type { MailLabel } from '@/lib/api'
import { cn } from '@/lib/utils'

// Gmail's categories keep the colours of the design; the user's own labels use
// their Gmail colour, else one of these in turn.
const CATEGORY_DOTS: Record<string, string> = {
  CATEGORY_SOCIAL: 'bg-violet-500',
  CATEGORY_UPDATES: 'bg-teal-500',
  CATEGORY_FORUMS: 'bg-orange-500',
  CATEGORY_PROMOTIONS: 'bg-pink-500',
}
const LABEL_DOTS = ['bg-lime-500', 'bg-sky-500', 'bg-amber-500', 'bg-rose-500', 'bg-indigo-500']

/** The coloured dot of a category or label; `index` is its place in the label list. */
export function LabelDot({ label, index, className }: { label: MailLabel; index: number; className?: string }) {
  const tone = CATEGORY_DOTS[label.id] ?? (label.color ? undefined : LABEL_DOTS[index % LABEL_DOTS.length])
  return (
    <span
      aria-hidden='true'
      className={cn('shrink-0 rounded-full', tone, className)}
      style={tone ? undefined : { backgroundColor: label.color ?? undefined }}
    />
  )
}
