// From Shadcn Space "Tooltip 03 - Animated Tooltip"
// (https://shadcnspace.com/r/tooltip-03.json): its demo people became the
// `items` prop, its <img> this app's Avatar (initials when there is no picture),
// and its blue the theme's tooltip colours. A keyboard user gets it on focus.
import { motion, useMotionValue, useSpring, useTransform } from 'motion/react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'

export type TooltipPerson = {
  id: string
  name: string
  designation: string
  image?: string | null
}

const TooltipItem = ({ item }: { item: TooltipPerson }) => {
  const x = useMotionValue(0)

  const rotate = useSpring(useTransform(x, [-100, 100], [-45, 45]), {
    stiffness: 100,
    damping: 15,
  })

  const translateX = useSpring(useTransform(x, [-100, 100], [-50, 50]), {
    stiffness: 100,
    damping: 15,
  })

  return (
    <div
      tabIndex={0}
      aria-label={`${item.name} (${item.designation})`}
      className='group relative rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring'
    >
      <motion.div
        style={{ translateX, rotate }}
        className='pointer-events-none absolute bottom-full left-1/2 z-40 mb-1 hidden -translate-x-1/2 flex-col items-center rounded-md bg-primary px-3 py-1.5 shadow-xl group-hover:flex group-focus-visible:flex'
      >
        <p className='text-xs font-medium whitespace-nowrap text-primary-foreground'>{item.name}</p>
        <p className='text-[11px] whitespace-nowrap text-primary-foreground/60 capitalize'>
          {item.designation}
        </p>
      </motion.div>

      <Avatar
        onMouseMove={(e) => x.set(e.nativeEvent.offsetX - e.currentTarget.offsetWidth / 2)}
        className='border-2 border-background transition duration-500 group-hover:z-30 group-hover:scale-105'
      >
        {item.image && <AvatarImage src={item.image} alt='' className='object-cover object-top' />}
        <AvatarFallback className='text-xs font-medium'>{item.name.trim().charAt(0) || '?'}</AvatarFallback>
      </Avatar>
    </div>
  )
}

/** Overlapping avatars, each naming its person on hover; `more` is how many are left out. */
export default function AnimatedTooltipMotion({ items, more = 0 }: { items: TooltipPerson[]; more?: number }) {
  return (
    <div className='flex items-center -space-x-2'>
      {items.map((item) => (
        <TooltipItem key={item.id} item={item} />
      ))}
      {more > 0 && (
        <span className='relative flex size-8 items-center justify-center rounded-full border-2 border-background bg-muted text-xs font-medium tabular-nums'>
          +{more}
        </span>
      )}
    </div>
  )
}
