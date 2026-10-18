import { useState } from 'react'
import {
  Archive,
  ChevronLeft,
  ChevronsUpDown,
  EllipsisVertical,
  ExternalLink,
  Forward,
  MailOpen,
  OctagonAlert,
  Reply,
  ReplyAll,
  Star,
  Trash2,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { MailLabel, MailMessage, MailThread } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { LabelManager } from './label-manager'
import { LabelDot } from './label-dot'
import { formatMailDate, gmailThreadUrl, initials, labelName } from './mail-utils'

export type MailAction = 'archive' | 'spam' | 'trash' | 'unread'

type MailDisplayProps = {
  thread: MailThread | null
  loading: boolean
  /** The category and label list (dot colours, label manager). */
  labels: MailLabel[]
  canUse: boolean
  onAction: (action: MailAction) => void
  onStar: (on: boolean) => void
  onLabel: (labelId: string, on: boolean) => void
  /** Phone layout: back to the list. */
  onBack?: () => void
}

function IconButton({ label, children, ...props }: React.ComponentProps<typeof Button> & { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant='ghost' size='icon' {...props}>
          {children}
          <span className='sr-only'>{label}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

/** Right pane: the toolbar, the conversation header and its messages. */
export function MailDisplay({ thread, loading, labels, canUse, onAction, onStar, onLabel, onBack }: MailDisplayProps) {
  const { t, i18n } = useTranslation()
  const [expanded, setExpanded] = useState<string | null>(null)
  const messages = thread?.messages ?? []
  const last = messages[messages.length - 1]
  const showAll = expanded === thread?.id
  const shown = showAll ? messages : messages.slice(-1)
  const starred = thread?.label_ids.includes('STARRED') ?? false
  const applied = labels.map((l, i) => [l, i] as const).filter(([l]) => thread?.label_ids.includes(l.id))
  const own = labels.map((l, i) => [l, i] as const).filter(([l]) => l.type === 'user')
  const off = !thread || !canUse
  const gmail = thread ? gmailThreadUrl(thread.id) : undefined

  const link = (label: string, icon: React.ReactNode) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant='ghost' size='icon' asChild disabled={!thread}>
          <a href={gmail} target='_blank' rel='noreferrer' aria-disabled={!thread}>
            {icon}
            <span className='sr-only'>{label}</span>
          </a>
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )

  return (
    <div className='flex h-full min-h-0 flex-col bg-background'>
      <div className='flex items-center gap-1 p-1 max-lg:justify-end lg:p-3'>
        {onBack && (
          <Button variant='ghost' size='icon' className='me-auto' onClick={onBack} aria-label={t('mail.back')}>
            <ChevronLeft />
          </Button>
        )}
        <div className='hidden items-center lg:flex'>
          <IconButton label={t('mail.archive')} disabled={off} onClick={() => onAction('archive')}>
            <Archive />
          </IconButton>
          <IconButton label={t('mail.spam')} disabled={off} onClick={() => onAction('spam')}>
            <OctagonAlert />
          </IconButton>
          <IconButton label={t('mail.trash')} disabled={off} onClick={() => onAction('trash')}>
            <Trash2 />
          </IconButton>
          <LabelManager labels={own} applied={thread?.label_ids ?? []} disabled={off} onChange={onLabel} />
        </div>
        <Separator orientation='vertical' className='hidden h-6 self-center lg:block' />
        <div className='hidden min-w-0 flex-1 items-center gap-2 lg:flex'>
          <IconButton label={t(starred ? 'mail.unstar' : 'mail.star')} disabled={off} onClick={() => onStar(!starred)}>
            <Star className={cn(starred && 'fill-amber-400 text-amber-400')} />
          </IconButton>
          <div className='flex min-w-0 flex-wrap items-center gap-1.5'>
            {applied.map(([l, i]) => (
              <Badge key={l.id} variant='outline' className='gap-1.5 whitespace-nowrap'>
                <LabelDot label={l} index={i} className='size-1.5' />
                <span className='max-xl:hidden'>{labelName(t, l)}</span>
              </Badge>
            ))}
          </div>
        </div>
        <div className='flex shrink-0 items-center gap-0.5'>
          {link(t('mail.reply'), <Reply />)}
          {link(t('mail.replyAll'), <ReplyAll />)}
          {link(t('mail.forward'), <Forward />)}
          <Separator orientation='vertical' className='mx-1 h-6 self-center' />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant='ghost' size='icon' disabled={!thread}>
                <EllipsisVertical />
                <span className='sr-only'>{t('mail.more')}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end'>
              {/* The toolbar's hidden actions, on narrow screens. */}
              <DropdownMenuItem className='lg:hidden' disabled={off} onSelect={() => onAction('archive')}>
                <Archive /> {t('mail.archive')}
              </DropdownMenuItem>
              <DropdownMenuItem className='lg:hidden' disabled={off} onSelect={() => onAction('spam')}>
                <OctagonAlert /> {t('mail.spam')}
              </DropdownMenuItem>
              <DropdownMenuItem className='lg:hidden' disabled={off} onSelect={() => onAction('trash')}>
                <Trash2 /> {t('mail.trash')}
              </DropdownMenuItem>
              <DropdownMenuItem className='lg:hidden' disabled={off} onSelect={() => onStar(!starred)}>
                <Star /> {t(starred ? 'mail.unstar' : 'mail.star')}
              </DropdownMenuItem>
              <DropdownMenuSeparator className='lg:hidden' />
              <DropdownMenuItem disabled={off} onSelect={() => onAction('unread')}>
                <MailOpen /> {t('mail.markUnread')}
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <a href={gmail} target='_blank' rel='noreferrer'>
                  <ExternalLink /> {t('mail.openInGmail')}
                </a>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <Separator />
      {loading ? (
        <div className='flex flex-col gap-3 p-3'>
          <Skeleton className='h-5 w-2/3' />
          <Skeleton className='h-4 w-1/3' />
          <Skeleton className='mt-4 h-24 w-full' />
        </div>
      ) : thread && last ? (
        <div className='flex min-h-0 flex-1 flex-col overflow-hidden'>
          <div className='border-b border-border p-3'>
            <div className='flex items-start justify-between gap-4'>
              <div className='flex min-w-0 flex-1 items-start gap-3'>
                <Avatar className='shrink-0 max-md:hidden'>
                  <AvatarFallback>{initials(messages[0].from_name)}</AvatarFallback>
                </Avatar>
                <div className='min-w-0 flex-1'>
                  <h2 className='line-clamp-2 text-base leading-snug font-medium tracking-tight text-foreground md:font-semibold'>
                    {thread.subject || t('mail.noSubject')}
                  </h2>
                  <p className='mt-1 text-sm font-medium text-foreground'>{last.from_name}</p>
                  <p className='mt-0.5 text-xs text-muted-foreground'>
                    {t('mail.replyTo')} {last.reply_to}
                  </p>
                </div>
              </div>
              <span className='shrink-0 pt-0.5 text-xs text-muted-foreground'>
                {formatMailDate(last.date, i18n.language)}
              </span>
            </div>
          </div>
          <div className='flex-1 overflow-auto p-3'>
            <div className='flex flex-col gap-5'>
              {messages.length > 1 && (
                <button
                  type='button'
                  aria-expanded={showAll}
                  onClick={() => setExpanded(showAll ? null : thread.id)}
                  className='flex w-full items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground'
                >
                  <ChevronsUpDown className='size-4' aria-hidden='true' />
                  {showAll ? t('mail.collapse') : t('mail.earlier', { count: messages.length - 1 })}
                </button>
              )}
              {shown.map((m) => (
                <Message key={m.id} message={m} />
              ))}
            </div>
          </div>
        </div>
      ) : (
        <p className='p-8 text-center text-sm text-muted-foreground'>{t('mail.noSelection')}</p>
      )}
    </div>
  )
}

function Message({ message }: { message: MailMessage }) {
  const { i18n } = useTranslation()
  return (
    <div className='px-3'>
      <div className='mb-4 flex items-start gap-3'>
        <Avatar className='size-9 shrink-0'>
          <AvatarFallback>{initials(message.from_name)}</AvatarFallback>
        </Avatar>
        <div className='min-w-0 flex-1'>
          <div className='flex items-center justify-between gap-2'>
            <span className='truncate text-sm font-semibold'>{message.from_name}</span>
            <span className='shrink-0 text-xs text-muted-foreground'>{formatMailDate(message.date, i18n.language)}</span>
          </div>
          <div className='truncate text-xs text-muted-foreground'>{message.from_email}</div>
        </div>
      </div>
      <div className='text-sm wrap-anywhere whitespace-pre-wrap text-foreground/80'>{message.text}</div>
    </div>
  )
}
