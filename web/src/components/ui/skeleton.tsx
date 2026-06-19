import { useEffect, useRef } from 'react'
import { animate } from 'animejs'
import { cn } from '@/lib/utils'

function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  const ref = useRef<HTMLDivElement>(null)

  // Subtle entrance when a loading placeholder appears. Animates transform
  // only (not opacity) so it never fights the `animate-pulse` shimmer.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    animate(el, {
      scale: [0.97, 1],
      translateY: [4, 0],
      duration: 320,
      ease: 'outQuad',
    })
  }, [])

  return (
    <div
      ref={ref}
      data-slot='skeleton'
      className={cn('animate-pulse rounded-md bg-accent', className)}
      {...props}
    />
  )
}

export { Skeleton }
