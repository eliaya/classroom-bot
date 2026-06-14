import { cn } from '@/lib/utils'

type GreenCheckIconProps = {
  /** Accessible name, exposed via aria-label and <title>. */
  label: string
  className?: string
}

/**
 * Accessible inline green check icon used for positive states (e.g. a valid
 * OAuth credential). Inline SVG (not an external file) with role="img" and an
 * accessible name; color uses the themeable `green-success` token.
 */
export function GreenCheckIcon({ label, className }: GreenCheckIconProps) {
  return (
    <svg
      role='img'
      aria-label={label}
      className={cn('text-green-success h-8 w-8', className)}
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='2.5'
      strokeLinecap='round'
      strokeLinejoin='round'
    >
      <title>{label}</title>
      <circle cx='12' cy='12' r='10' />
      <path d='m8 12 2.5 2.5L16 9' />
    </svg>
  )
}
