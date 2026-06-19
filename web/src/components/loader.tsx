import { useEffect, useRef } from 'react'
import { animate, stagger } from 'animejs'
import { cn } from '@/lib/utils'

/**
 * Anime.js-powered loading indicator: three dots bouncing in sequence.
 * Used for lazy-load / route-pending fallbacks and inline loading states.
 */
export function Loader({ className }: { className?: string }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const root = ref.current
    if (!root) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const dots = root.querySelectorAll('span')
    const animation = animate(dots, {
      translateY: [0, -8, 0],
      opacity: [0.35, 1, 0.35],
      duration: 700,
      delay: stagger(120),
      loop: true,
      ease: 'inOutSine',
    })
    return () => {
      animation.pause()
    }
  }, [])

  return (
    <div
      ref={ref}
      role='status'
      aria-label='Loading'
      className={cn('flex items-center justify-center gap-1.5', className)}
    >
      <span className='size-2 rounded-full bg-primary' />
      <span className='size-2 rounded-full bg-primary' />
      <span className='size-2 rounded-full bg-primary' />
    </div>
  )
}
