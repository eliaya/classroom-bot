import { cn } from '@/lib/utils'

/** A tag's dot: its color, or the muted default. */
export function TagDot({
  color,
  className,
}: {
  color: string | null
  className?: string
}) {
  return (
    <svg
      viewBox='0 0 8 8'
      aria-hidden='true'
      className={cn(
        'size-2 shrink-0',
        !color && 'text-muted-foreground',
        className
      )}
      style={color ? { color } : undefined}
    >
      <circle cx='4' cy='4' r='4' fill='currentColor' />
    </svg>
  )
}
