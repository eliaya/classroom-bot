import { useEffect, useId, useRef, useState } from 'react'
import { Check, ChevronDown, Plus, Tag as TagIcon } from 'lucide-react'
import { AnimatePresence, MotionConfig, motion } from 'motion/react'
import { useTranslation } from 'react-i18next'
import type { Tag } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useAssignedTags } from './use-assigned-tags'

// bencho.dev's "Assignees" picker (blocks/picker): a pill whose chosen faces stack up
// in a rail that widens by arithmetic, and a card of rows that springs out under it.
// Here the faces are the tags' colours, and the card ends in an input bar.
const DOT = 18
const OVERLAP = 6
const SPRING = { type: 'spring', stiffness: 500, damping: 18, mass: 0.8 } as const
const SETTLE = { type: 'spring', stiffness: 380, damping: 34, mass: 0.7 } as const

const dotStyle = (tag: Tag) => (tag.color ? { backgroundColor: tag.color } : undefined)

/**
 * The post panel's tag button. Closed, a pill of the tags on `target`, by colour
 * alone. Open, a card of tags under it, with an input bar at its foot: typing narrows
 * the tags and completes the first tag it starts (Tab or → takes it); Enter
 * puts that tag on, or creates it when no tag has the name. A row toggles its tag.
 */
export function TagColorPicker({ target }: { target: string }) {
  const { t } = useTranslation()
  const { tags, ids, selected, toggle, create } = useAssignedTags(target)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const root = useRef<HTMLDivElement>(null)
  const pill = useRef<HTMLButtonElement>(null)
  const listId = useId()

  const close = (refocus: boolean) => {
    setOpen(false)
    setQuery('')
    if (refocus) pill.current?.focus()
  }

  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => {
      if (root.current?.contains(e.target as Node)) return
      setOpen(false)
      setQuery('')
    }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [open])

  const name = query.trim()
  const lower = name.toLowerCase()
  const exact = tags.find((tag) => tag.name.toLowerCase() === lower)
  const shown = lower ? tags.filter((tag) => tag.name.toLowerCase().includes(lower)) : tags
  // Inline completion: the rest of the first tag the typed text starts.
  const completion = lower ? tags.find((tag) => tag.name.toLowerCase().startsWith(lower) && tag.name.length > name.length) : undefined
  const rest = completion && query === query.trimStart() ? completion.name.slice(query.length) : ''

  const submit = async () => {
    if (!name) return
    if (exact) {
      if (!ids.includes(exact.id)) toggle(exact.id)
      setQuery('')
    } else if (await create(name)) {
      setQuery('')
    }
  }

  // The rail is as wide as its dots need: worked out, not measured.
  const rail = selected.length ? DOT + (selected.length - 1) * (DOT - OVERLAP) : 0

  return (
    <MotionConfig reducedMotion='user'>
      <div ref={root} className='relative flex min-w-0 items-center gap-1.5'>
        <button
          ref={pill}
          type='button'
          aria-label={t('tags.label')}
          aria-expanded={open}
          aria-haspopup='listbox'
          title={selected.map((tag) => tag.name).join(', ') || undefined}
          onClick={() => (open ? close(false) : setOpen(true))}
          className={cn(
            'group inline-flex h-9 shrink-0 items-center gap-2 rounded-full px-2.5 text-sm font-medium outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50',
            open && 'bg-accent'
          )}
        >
          <TagIcon className='size-4' aria-hidden='true' />
          <span className='relative h-[18px] shrink-0 transition-[width] duration-200 ease-out' style={{ width: rail }}>
            <AnimatePresence initial={false}>
              {selected.map((tag, i) => (
                <motion.span
                  key={tag.id}
                  aria-hidden='true'
                  className={cn('absolute top-0 left-0 size-[18px] rounded-full ring-2 ring-background', !tag.color && 'bg-muted-foreground')}
                  style={{ ...dotStyle(tag), zIndex: selected.length - i }}
                  initial={{ scale: 0.2, opacity: 0, x: i * (DOT - OVERLAP), y: -10, rotate: -22 }}
                  animate={{ scale: 1, opacity: 1, x: i * (DOT - OVERLAP), y: 0, rotate: 0 }}
                  exit={{ scale: 0.2, opacity: 0, y: -6, rotate: 14 }}
                  transition={{ ...SPRING, x: SETTLE, y: SETTLE, scale: SETTLE, opacity: { duration: 0.16 } }}
                />
              ))}
            </AnimatePresence>
          </span>
          <ChevronDown
            className='size-4 text-muted-foreground transition-transform duration-200 group-aria-expanded:rotate-180'
            aria-hidden='true'
          />
        </button>

        <AnimatePresence>
          {open && (
            <motion.div
              key='card'
              initial={{ opacity: 0, y: -10, scaleX: 0.86, scaleY: 0.72 }}
              animate={{ opacity: 1, y: 0, scaleX: 1, scaleY: 1 }}
              exit={{ opacity: 0, y: -8, scaleX: 0.92, scaleY: 0.86 }}
              transition={{ type: 'spring', stiffness: 500, damping: 18, mass: 0.9, opacity: { duration: 0.16 } }}
              className='absolute top-full left-0 z-50 mt-2 flex max-h-80 w-64 origin-top-left flex-col rounded-2xl border bg-popover p-1.5 text-popover-foreground shadow-md'
            >
              <div id={listId} role='listbox' aria-multiselectable='true' aria-label={t('tags.label')} className='min-h-0 overflow-y-auto'>
                {shown.map((tag, i) => {
                  const on = ids.includes(tag.id)
                  return (
                    <motion.button
                      key={tag.id}
                      type='button'
                      role='option'
                      aria-selected={on}
                      onClick={() => toggle(tag.id)}
                      initial={{ opacity: 0, y: -8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ ...SETTLE, delay: 0.04 * i + 0.03 }}
                      className='flex h-10 w-full items-center gap-3 rounded-xl px-2 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent'
                    >
                      <span
                        aria-hidden='true'
                        className={cn('size-5 shrink-0 rounded-full ring-1 ring-black/10 dark:ring-white/15', !tag.color && 'bg-muted-foreground')}
                        style={dotStyle(tag)}
                      />
                      <span className='min-w-0 flex-1 truncate'>{tag.name}</span>
                      <span
                        className={cn(
                          'grid size-[18px] shrink-0 place-items-center rounded-md shadow-[inset_0_0_0_1.5px] shadow-foreground/25 transition-colors',
                          on && 'bg-foreground shadow-foreground'
                        )}
                      >
                        <AnimatePresence initial={false}>
                          {on && (
                            <motion.span
                              className='grid place-items-center text-background'
                              initial={{ scale: 0.4, opacity: 0 }}
                              animate={{ scale: 1, opacity: 1 }}
                              exit={{ scale: 0.4, opacity: 0 }}
                              transition={{ type: 'spring', stiffness: 500, damping: 18, mass: 0.6 }}
                            >
                              <Check className='size-3.5' strokeWidth={2} />
                            </motion.span>
                          )}
                        </AnimatePresence>
                      </span>
                    </motion.button>
                  )
                })}
                {name && !exact && (
                  <button
                    type='button'
                    role='option'
                    aria-selected={false}
                    onClick={() => void submit()}
                    className='flex h-10 w-full items-center gap-3 rounded-xl px-2 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent'
                  >
                    <span className='grid size-5 shrink-0 place-items-center rounded-full border border-dashed text-muted-foreground'>
                      <Plus className='size-3' aria-hidden='true' />
                    </span>
                    <span className='min-w-0 flex-1 truncate'>{t('tags.create', { name })}</span>
                  </button>
                )}
                {!shown.length && !name && <p className='px-2 py-2 text-sm text-muted-foreground'>{t('tags.empty')}</p>}
              </div>
              <div className='relative mt-1 flex h-9 shrink-0 items-center rounded-xl bg-muted px-3'>
                {/* The completion, drawn behind the input as the typed text plus its muted rest. */}
                <span aria-hidden='true' className='pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm whitespace-pre'>
                  <span className='invisible'>{query}</span>
                  <span className='text-muted-foreground/70'>{rest}</span>
                </span>
                <input
                  autoFocus
                  role='combobox'
                  aria-label={t('tags.addOrFind')}
                  aria-expanded
                  aria-controls={listId}
                  aria-autocomplete='both'
                  placeholder={t('tags.addOrFind')}
                  value={query}
                  maxLength={64}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      e.preventDefault()
                      close(true)
                    } else if (e.key === 'Enter') {
                      e.preventDefault()
                      void submit()
                    } else if (rest && (e.key === 'Tab' || (e.key === 'ArrowRight' && e.currentTarget.selectionStart === query.length))) {
                      e.preventDefault()
                      setQuery(completion!.name)
                    }
                  }}
                  className='relative w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground'
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </MotionConfig>
  )
}
