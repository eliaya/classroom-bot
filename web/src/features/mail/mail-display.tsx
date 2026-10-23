import { useEffect, useRef, useState } from 'react'
import {
  Archive,
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
import { TagColorPicker } from '@/features/tags/tag-color-picker'
import { DetailHeader, DetailToolbar, IconButton } from './inbox-ui'
import { LabelManager } from './label-manager'
import { LabelDot } from './label-dot'
import { formatMailDate, gmailThreadUrl, initials, labelName } from './mail-utils'

export type MailAction = 'archive' | 'spam' | 'trash' | 'unread'

export type MailDisplayProps = {
  thread: MailThread | null
  loading: boolean
  /** The category and label list (dot colours, label manager). */
  labels: MailLabel[]
  canUse: boolean
  onAction: (action: MailAction) => void
  onStar: (on: boolean) => void
  onLabel: (labelId: string, on: boolean) => void
}

/** The Dashboard's post panel for a mail conversation: the toolbar, its header and its messages. */
export function MailDisplay({ thread, loading, labels, canUse, onAction, onStar, onLabel }: MailDisplayProps) {
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
      <DetailToolbar>
        {/* Tags as on a post: by colour, from the toolbar. */}
        {thread && <TagColorPicker target={`mail:${thread.id}`} />}
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
        <div className='ms-auto flex shrink-0 items-center gap-0.5'>
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
      </DetailToolbar>
      {loading ? (
        <div className='flex flex-col gap-3 p-3'>
          <Skeleton className='h-5 w-2/3' />
          <Skeleton className='h-4 w-1/3' />
          <Skeleton className='mt-4 h-24 w-full' />
        </div>
      ) : thread && last ? (
        <div className='flex min-h-0 flex-1 flex-col overflow-hidden'>
          <DetailHeader
            avatar={
              <Avatar>
                <AvatarFallback>{initials(messages[0].from_name)}</AvatarFallback>
              </Avatar>
            }
            title={thread.subject || t('mail.noSubject')}
            aside={formatMailDate(last.date, i18n.language)}
          >
            <p className='mt-1 text-sm font-medium text-foreground'>{last.from_name}</p>
            <p className='mt-0.5 text-xs text-muted-foreground'>
              {t('mail.replyTo')} {last.reply_to}
            </p>
          </DetailHeader>
          {/* The post panel's body padding. */}
          <div className='min-h-0 flex-1 overflow-auto p-3'>
            <div className='flex flex-col gap-5 px-3 pt-2'>
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
              {shown.map((m, i) => (
                // The header above names the latest; earlier ones, when shown, are set apart by a rule.
                <Message key={m.id} message={m} className={i ? 'border-t pt-5' : undefined} />
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

function Message({ message, className }: { message: MailMessage; className?: string }) {
  return (
    <div className={className}>
      {message.html ? (
        <MailHtml html={message.html} title={message.from_name} />
      ) : (
        <div className='text-sm leading-relaxed wrap-anywhere whitespace-pre-wrap text-foreground/80'>
          {message.text.split(WEB_ADDRESS).map((part, i) =>
            i % 2 ? (
              <a key={i} href={part} target='_blank' rel='noopener noreferrer' className='text-primary underline'>
                {part}
              </a>
            ) : (
              part
            )
          )}
        </div>
      )}
    </div>
  )
}

// A web address in plain text, without the punctuation that usually ends a sentence after it.
const WEB_ADDRESS = /(https?:\/\/[^\s<>"]*[^\s<>".,;:!?)\]'」』。、])/

// Mail is untrusted: no scripts, frames, forms or fetches; images, styles and fonts may load.
const MAIL_CSP = "default-src 'none'; img-src https: http: data:; style-src 'unsafe-inline' https: http:; font-src https: http: data:"

/** An HTML mail in a frame without scripts (sandbox and CSP), sized to its
 * content; its links open in a new tab. */
function MailHtml({ html, title }: { html: string; title: string }) {
  const observer = useRef<ResizeObserver>(undefined)
  const [height, setHeight] = useState(0)
  useEffect(() => () => observer.current?.disconnect(), [])

  const onLoad = (e: React.SyntheticEvent<HTMLIFrameElement>) => {
    // Reachable because of allow-same-origin, safe because the frame runs no script.
    const doc = e.currentTarget.contentDocument
    if (!doc) return
    for (const a of doc.querySelectorAll('a[href]')) {
      a.setAttribute('target', '_blank')
      a.setAttribute('rel', 'noopener noreferrer')
    }
    observer.current?.disconnect()
    observer.current = new ResizeObserver(() => setHeight(doc.documentElement.offsetHeight))
    observer.current.observe(doc.documentElement)
  }

  const doc =
    `<!doctype html><html><head><meta charset="utf-8">` +
    `<meta http-equiv="Content-Security-Policy" content="${MAIL_CSP}">` +
    `<meta name="referrer" content="no-referrer"><base target="_blank">` +
    `<style>html,body{margin:0}body{padding:12px;font:14px/1.5 system-ui,sans-serif;color:#1f2937;overflow-wrap:anywhere}img{max-width:100%;height:auto}</style>` +
    `</head><body>${html}</body></html>`
  return (
    <iframe
      title={title}
      srcDoc={doc}
      sandbox='allow-same-origin allow-popups allow-popups-to-escape-sandbox'
      onLoad={onLoad}
      className='w-full rounded-md border bg-white'
      style={{ height: height || 160 }}
    />
  )
}
