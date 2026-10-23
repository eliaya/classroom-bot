// Kibo UI Tags (https://www.kibo-ui.com/r/tags.json), the base of shadcnblocks
// tags-multi-1. Changes: the trigger's placeholder is a prop (translated), and
// TagsValue is a pill like the block's badges.
import {
  type ComponentProps,
  createContext,
  type MouseEventHandler,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import { XIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'

type TagsContextType = {
  value?: string
  setValue?: (value: string) => void
  open: boolean
  onOpenChange: (open: boolean) => void
  width?: number
  setWidth?: (width: number) => void
}

const TagsContext = createContext<TagsContextType>({
  value: undefined,
  setValue: undefined,
  open: false,
  onOpenChange: () => {},
  width: undefined,
  setWidth: undefined,
})

const useTagsContext = () => useContext(TagsContext)

export type TagsProps = {
  value?: string
  setValue?: (value: string) => void
  open?: boolean
  onOpenChange?: (open: boolean) => void
  children?: ReactNode
  className?: string
}

export const Tags = ({
  value,
  setValue,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  children,
  className,
}: TagsProps) => {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const [width, setWidth] = useState<number>()
  const ref = useRef<HTMLDivElement>(null)

  const open = controlledOpen ?? uncontrolledOpen
  const onOpenChange = controlledOnOpenChange ?? setUncontrolledOpen

  useEffect(() => {
    if (!ref.current) return
    const resizeObserver = new ResizeObserver((entries) => {
      setWidth(entries[0].contentRect.width)
    })
    resizeObserver.observe(ref.current)
    return () => resizeObserver.disconnect()
  }, [])

  return (
    <TagsContext.Provider
      value={{ value, setValue, open, onOpenChange, width, setWidth }}
    >
      <Popover onOpenChange={onOpenChange} open={open}>
        <div className={cn('relative w-full', className)} ref={ref}>
          {children}
        </div>
      </Popover>
    </TagsContext.Provider>
  )
}

export type TagsTriggerProps = ComponentProps<typeof Button> & {
  placeholder?: string
}

export const TagsTrigger = ({
  className,
  children,
  placeholder = 'Select a tag...',
  ...props
}: TagsTriggerProps) => (
  <PopoverTrigger asChild>
    <Button
      className={cn('h-auto w-full justify-between p-2', className)}
      role='combobox'
      variant='outline'
      {...props}
    >
      <div className='flex flex-wrap items-center gap-1'>
        {children}
        <span className='px-2 py-px text-muted-foreground'>{placeholder}</span>
      </div>
    </Button>
  </PopoverTrigger>
)

export type TagsValueProps = ComponentProps<typeof Badge>

export const TagsValue = ({
  className,
  children,
  onRemove,
  ...props
}: TagsValueProps & { onRemove?: () => void }) => {
  const handleRemove: MouseEventHandler<HTMLDivElement> = (event) => {
    event.preventDefault()
    event.stopPropagation()
    onRemove?.()
  }

  return (
    <Badge
      className={cn('flex items-center gap-2 rounded-full', className)}
      {...props}
    >
      {children}
      {onRemove && (
        // A div, as in Kibo UI: the trigger is a button and cannot hold one.
        // The keyboard removes a tag by choosing it again in the list.
        <div
          className='size-auto cursor-pointer hover:text-muted-foreground'
          onClick={handleRemove}
        >
          <XIcon size={12} />
        </div>
      )}
    </Badge>
  )
}

export type TagsContentProps = ComponentProps<typeof PopoverContent>

export const TagsContent = ({
  className,
  children,
  ...props
}: TagsContentProps) => {
  const { width } = useTagsContext()

  return (
    <PopoverContent
      className={cn('p-0', className)}
      style={{ width }}
      {...props}
    >
      <Command>{children}</Command>
    </PopoverContent>
  )
}

export type TagsInputProps = ComponentProps<typeof CommandInput>

export const TagsInput = ({ className, ...props }: TagsInputProps) => (
  <CommandInput className={cn('h-9', className)} {...props} />
)

export type TagsListProps = ComponentProps<typeof CommandList>

export const TagsList = ({ className, ...props }: TagsListProps) => (
  <CommandList className={cn('max-h-[200px]', className)} {...props} />
)

export type TagsEmptyProps = ComponentProps<typeof CommandEmpty>

export const TagsEmpty = ({ children, ...props }: TagsEmptyProps) => (
  <CommandEmpty {...props}>{children ?? 'No tags found.'}</CommandEmpty>
)

export const TagsGroup = CommandGroup

export type TagsItemProps = ComponentProps<typeof CommandItem>

export const TagsItem = ({ className, ...props }: TagsItemProps) => (
  <CommandItem
    className={cn('cursor-pointer items-center justify-between', className)}
    {...props}
  />
)
