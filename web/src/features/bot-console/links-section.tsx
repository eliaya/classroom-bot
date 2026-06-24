import { useEffect, useMemo, useRef, useState } from 'react'
import { animate } from 'animejs'
import { Plus, Save, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import {
  api,
  type Course,
  type DiscordChannel,
  type DiscordRole,
  type Link,
  type LinkInput,
} from '@/lib/api'
import { notify } from '@/lib/notify'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

type FormState = {
  guild_id: string
  course_id: string
  channel_id: string
  // The notify selection: '' = none, '@everyone'/'@here', or a role id.
  notify: string
  is_active: boolean
}

type Guild = { id: string; name: string }

// Radix Select forbids an empty-string value, so the "none" option uses this.
// @everyone/@here are stored as notify_target; anything else is a role id.
const NO_ROLE = '__none__'
const EVERYONE = '@everyone'
const HERE = '@here'

// `null` = no panel, 'new' = create panel, otherwise the selected link.
type Selection = Link | 'new' | null

function toForm(link: Link | null): FormState {
  const notify =
    link?.notify_target === 'everyone'
      ? EVERYONE
      : link?.notify_target === 'here'
        ? HERE
        : link?.notify_role_id
          ? String(link.notify_role_id)
          : ''
  return {
    guild_id: link ? String(link.guild_id) : '',
    course_id: link?.course_id ?? '',
    channel_id: link ? String(link.channel_id) : '',
    notify,
    is_active: link?.is_active ?? true,
  }
}

/** Split the single notify selection into the API's two fields. */
function notifyFields(notify: string): Pick<LinkInput, 'notify_role_id' | 'notify_target'> {
  if (notify === EVERYONE) return { notify_role_id: null, notify_target: 'everyone' }
  if (notify === HERE) return { notify_role_id: null, notify_target: 'here' }
  return { notify_role_id: notify || null, notify_target: null }
}

export function LinksSection() {
  const { t } = useTranslation()
  const [links, setLinks] = useState<Link[]>([])
  const [courses, setCourses] = useState<Course[]>([])
  const [channels, setChannels] = useState<DiscordChannel[]>([])
  const [roles, setRoles] = useState<DiscordRole[]>([])
  const [error, setError] = useState<string | null>(null)
  const [selection, setSelection] = useState<Selection>(null)

  const reload = () => {
    api
      .listLinks()
      .then((res) => setLinks(res.items))
      .catch((e) => setError(e instanceof Error ? e.message : t('common.loadFailed')))
  }

  useEffect(() => {
    reload()
    api.listCourses().then((res) => setCourses(res.items)).catch(() => {})
    api.listDiscordChannels().then((res) => setChannels(res.items)).catch(() => {})
    api.listDiscordRoles().then((res) => setRoles(res.items)).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Distinct guilds from the reverse-synced inventory.
  const guilds = useMemo<Guild[]>(() => {
    const m = new Map<string, string>()
    channels.forEach((c) => m.set(String(c.guild_id), c.guild_name))
    return [...m].map(([id, name]) => ({ id, name }))
  }, [channels])
  const guildName = (id: string) => guilds.find((g) => g.id === id)?.name
  const channelName = (id: string) =>
    channels.find((c) => c.channel_id === id)?.channel_name

  const handleDelete = async (link: Link) => {
    try {
      await api.deleteLink(link.id)
      setSelection(null)
      reload()
      notify.success(t('common.deleted'))
    } catch (e) {
      const msg = e instanceof Error ? e.message : t('common.deleteFailed')
      setError(msg)
      notify.error(t('common.deleteFailed'), msg)
    }
  }

  const panelOpen = selection !== null
  const selectedId = selection && selection !== 'new' ? selection.id : null

  return (
    <div className='flex flex-col gap-4'>
      <div className='flex items-center justify-between gap-2'>
        {error && <p className='text-destructive text-sm'>{error}</p>}
        <span className='flex-1' />
        <Button size='sm' className='h-8' onClick={() => setSelection('new')}>
          <Plus className='size-4' />
          {t('links.new')}
        </Button>
      </div>

      <div className='flex flex-col gap-3 lg:flex-row lg:items-start'>
        <div
          className={cn(
            'overflow-hidden rounded-md border transition-[width] duration-300 ease-out',
            panelOpen ? 'lg:w-[30%]' : 'w-full'
          )}
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('links.course')}</TableHead>
                {!panelOpen && <TableHead>{t('links.guild')}</TableHead>}
                {!panelOpen && <TableHead>{t('links.channel')}</TableHead>}
                {!panelOpen && <TableHead>{t('links.active')}</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {links.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={panelOpen ? 1 : 4}
                    className='text-muted-foreground h-24 text-center'
                  >
                    {t('links.empty')}
                  </TableCell>
                </TableRow>
              ) : (
                links.map((link) => {
                  const isSelected = selectedId === link.id
                  return (
                    <TableRow
                      key={link.id}
                      data-state={isSelected ? 'selected' : undefined}
                      className='cursor-pointer'
                      onClick={() => setSelection(isSelected ? null : link)}
                    >
                      <TableCell className='font-medium'>
                        {link.course_name ?? t('links.unknownCourse')}
                        {!panelOpen && (
                          <span className='text-muted-foreground ms-2 font-mono text-xs'>
                            {link.course_id}
                          </span>
                        )}
                      </TableCell>
                      {!panelOpen && (
                        <TableCell className='text-xs'>
                          {guildName(link.guild_id) ?? (
                            <span className='font-mono'>{link.guild_id}</span>
                          )}
                        </TableCell>
                      )}
                      {!panelOpen && (
                        <TableCell className='text-xs'>
                          {channelName(link.channel_id) ? (
                            <span>#{channelName(link.channel_id)}</span>
                          ) : (
                            <span className='font-mono'>{link.channel_id}</span>
                          )}
                        </TableCell>
                      )}
                      {!panelOpen && (
                        <TableCell>{link.is_active ? '✅' : '❌'}</TableCell>
                      )}
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </div>

        {panelOpen && (
          <LinkDetail
            key={selection === 'new' ? 'new' : selection.id}
            link={selection === 'new' ? null : selection}
            courses={courses}
            guilds={guilds}
            channels={channels}
            roles={roles}
            onClose={() => setSelection(null)}
            onSaved={() => {
              // Collapse the detail panel back to the full-width list after save.
              setSelection(null)
              reload()
            }}
            onDelete={handleDelete}
          />
        )}
      </div>
    </div>
  )
}

type LinkDetailProps = {
  /** The link being edited, or null when creating a new one. */
  link: Link | null
  courses: Course[]
  guilds: Guild[]
  channels: DiscordChannel[]
  roles: DiscordRole[]
  onClose: () => void
  onSaved: (saved: Link) => void
  onDelete: (link: Link) => void
}

function LinkDetail({
  link,
  courses,
  guilds,
  channels,
  roles,
  onClose,
  onSaved,
  onDelete,
}: LinkDetailProps) {
  const { t } = useTranslation()
  const panelRef = useRef<HTMLDivElement>(null)
  const [form, setForm] = useState<FormState>(() => toForm(link))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isNew = link === null

  // Slide the panel in on mount (component is keyed on the selection upstream).
  useEffect(() => {
    const el = panelRef.current
    if (!el) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    animate(el, { opacity: [0, 1], translateX: [36, 0], duration: 420, ease: 'outExpo' })
  }, [])

  const channelOptions = useMemo(() => {
    const list = channels.filter((c) => c.guild_id === form.guild_id)
    // Keep the current value selectable even if it's not in the inventory.
    if (form.channel_id && !list.some((c) => c.channel_id === form.channel_id)) {
      return [
        { channel_id: form.channel_id, channel_name: `#${form.channel_id}` } as DiscordChannel,
        ...list,
      ]
    }
    return list
  }, [channels, form.guild_id, form.channel_id])

  const roleOptions = useMemo(() => {
    const list = roles.filter((r) => r.guild_id === form.guild_id)
    // Keep a saved role id selectable even if the inventory is empty/stale
    // (e.g. the bot is offline). Sentinels (@everyone/@here) aren't role ids.
    const isRoleId = form.notify && form.notify !== EVERYONE && form.notify !== HERE
    if (isRoleId && !list.some((r) => r.role_id === form.notify)) {
      return [
        { role_id: form.notify, role_name: form.notify } as DiscordRole,
        ...list,
      ]
    }
    return list
  }, [roles, form.guild_id, form.notify])

  const handleSave = async () => {
    setError(null)
    if (!form.course_id || !form.guild_id.trim() || !form.channel_id.trim()) {
      setError(t('links.requiredFields'))
      notify.warning(t('links.requiredFields'))
      return
    }
    setSaving(true)
    try {
      if (isNew) {
        const body: LinkInput = {
          guild_id: form.guild_id,
          course_id: form.course_id,
          channel_id: form.channel_id,
          ...notifyFields(form.notify),
          is_active: form.is_active,
        }
        onSaved(await api.createLink(body))
        notify.success(t('common.created'))
      } else {
        onSaved(
          await api.updateLink(link!.id, {
            guild_id: form.guild_id,
            course_id: form.course_id,
            channel_id: form.channel_id,
            ...notifyFields(form.notify),
            is_active: form.is_active,
          })
        )
        notify.success(t('common.saved'))
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : t('common.saveFailed')
      setError(msg)
      notify.error(t('common.saveFailed'), msg)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      ref={panelRef}
      className='flex h-[80vh] max-h-[80vh] flex-col overflow-hidden rounded-md border lg:w-[70%]'
    >
      <div className='flex items-start justify-between gap-2 border-b p-3'>
        <h3 className='truncate font-medium'>
          {isNew ? t('links.new') : (link?.course_name ?? t('links.unknownCourse'))}
        </h3>
        <Button variant='ghost' size='sm' className='h-7 px-2' onClick={onClose}>
          ✕
        </Button>
      </div>

      <ScrollArea className='min-h-0 flex-1'>
        <div className='flex flex-col gap-4 p-4'>
          {error && <p className='text-destructive text-sm'>{error}</p>}

          <div className='grid gap-2'>
            <Label htmlFor='ln-course'>{t('links.course')}</Label>
            <Select
              value={form.course_id}
              onValueChange={(v) => setForm((f) => ({ ...f, course_id: v }))}
            >
              <SelectTrigger id='ln-course'>
                <SelectValue placeholder={t('links.selectCourse')} />
              </SelectTrigger>
              <SelectContent>
                {courses.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className='grid gap-2'>
            <Label htmlFor='ln-guild'>{t('links.guild')}</Label>
            {guilds.length > 0 ? (
              <Select
                value={form.guild_id}
                onValueChange={(v) =>
                  setForm((f) => ({ ...f, guild_id: v, channel_id: '' }))
                }
              >
                <SelectTrigger id='ln-guild'>
                  <SelectValue placeholder={t('links.selectGuild')} />
                </SelectTrigger>
                <SelectContent>
                  {guilds.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {g.name}
                      <span className='text-muted-foreground ms-2 font-mono text-xs'>
                        {g.id}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                id='ln-guild'
                value={form.guild_id}
                onChange={(e) => setForm((f) => ({ ...f, guild_id: e.target.value }))}
                className='font-mono'
                inputMode='numeric'
              />
            )}
          </div>

          <div className='grid gap-2'>
            <Label htmlFor='ln-channel'>{t('links.channel')}</Label>
            {channelOptions.length > 0 ? (
              <Select
                value={form.channel_id}
                onValueChange={(v) => setForm((f) => ({ ...f, channel_id: v }))}
              >
                <SelectTrigger id='ln-channel'>
                  <SelectValue placeholder={t('links.selectChannel')} />
                </SelectTrigger>
                <SelectContent>
                  {channelOptions.map((c) => (
                    <SelectItem key={c.channel_id} value={String(c.channel_id)}>
                      #{c.channel_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                id='ln-channel'
                value={form.channel_id}
                onChange={(e) => setForm((f) => ({ ...f, channel_id: e.target.value }))}
                className='font-mono'
                inputMode='numeric'
                placeholder={t('links.channelId')}
              />
            )}
          </div>

          <div className='grid gap-2'>
            <Label htmlFor='ln-role'>{t('links.notifyRole')}</Label>
            <Select
              value={form.notify || NO_ROLE}
              onValueChange={(v) =>
                setForm((f) => ({ ...f, notify: v === NO_ROLE ? '' : v }))
              }
            >
              <SelectTrigger id='ln-role'>
                <SelectValue placeholder={t('links.selectRole')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_ROLE}>{t('links.noRole')}</SelectItem>
                <SelectItem value={EVERYONE}>@everyone</SelectItem>
                <SelectItem value={HERE}>@here</SelectItem>
                {roleOptions.map((r) => (
                  <SelectItem key={r.role_id} value={r.role_id}>
                    @{r.role_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className='text-muted-foreground text-xs'>{t('links.notifyRoleHint')}</p>
          </div>

          <div className='flex items-center gap-3'>
            <Switch
              id='ln-active'
              checked={form.is_active}
              onCheckedChange={(v) => setForm((f) => ({ ...f, is_active: v }))}
            />
            <Label htmlFor='ln-active'>{t('links.active')}</Label>
          </div>
        </div>
      </ScrollArea>

      <div className='flex items-center justify-end gap-2 border-t p-3'>
        {!isNew && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant='outline' size='sm' className='text-destructive'>
                <Trash2 className='size-4' />
                {t('links.delete')}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t('links.delete')}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t('links.deleteConfirm', {
                    name: link?.course_name ?? link?.course_id,
                  })}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                <AlertDialogAction onClick={() => onDelete(link!)}>
                  {t('links.delete')}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
        <Button size='sm' onClick={handleSave} disabled={saving}>
          <Save className='size-4' />
          {t('links.save')}
        </Button>
      </div>
    </div>
  )
}
