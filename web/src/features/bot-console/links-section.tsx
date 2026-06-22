import { useEffect, useMemo, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  api,
  type Course,
  type DiscordChannel,
  type Link,
  type LinkInput,
} from '@/lib/api'
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
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
  is_active: boolean
}

function emptyForm(): FormState {
  return { guild_id: '', course_id: '', channel_id: '', is_active: true }
}

export function LinksSection() {
  const { t } = useTranslation()
  const [links, setLinks] = useState<Link[]>([])
  const [courses, setCourses] = useState<Course[]>([])
  const [channels, setChannels] = useState<DiscordChannel[]>([])
  const [error, setError] = useState<string | null>(null)
  // null = closed; otherwise the link being edited, or 'new' for create.
  const [editing, setEditing] = useState<Link | 'new' | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [saving, setSaving] = useState(false)

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Distinct guilds and per-guild channels from the reverse-synced inventory.
  const guilds = useMemo(() => {
    const m = new Map<string, string>()
    channels.forEach((c) => m.set(String(c.guild_id), c.guild_name))
    return [...m].map(([id, name]) => ({ id, name }))
  }, [channels])
  const guildName = (id: string) => guilds.find((g) => g.id === id)?.name
  const channelName = (id: string) =>
    channels.find((c) => c.channel_id === id)?.channel_name
  const channelOptions = useMemo(() => {
    const list = channels.filter((c) => c.guild_id === form.guild_id)
    // Keep the current value selectable even if it's not in the inventory.
    if (form.channel_id && !list.some((c) => c.channel_id === form.channel_id)) {
      return [
        { channel_id: form.channel_id, channel_name: `#${form.channel_id}` },
        ...list,
      ]
    }
    return list
  }, [channels, form.guild_id, form.channel_id])

  const openNew = () => {
    setForm(emptyForm())
    setError(null)
    setEditing('new')
  }

  const openEdit = (link: Link) => {
    setForm({
      guild_id: String(link.guild_id),
      course_id: link.course_id,
      channel_id: String(link.channel_id),
      is_active: link.is_active,
    })
    setError(null)
    setEditing(link)
  }

  const handleSave = async () => {
    setError(null)
    if (!form.course_id || !form.guild_id.trim() || !form.channel_id.trim()) {
      setError(t('links.requiredFields'))
      return
    }
    setSaving(true)
    try {
      if (editing === 'new') {
        const body: LinkInput = {
          guild_id: form.guild_id,
          course_id: form.course_id,
          channel_id: form.channel_id,
          is_active: form.is_active,
        }
        await api.createLink(body)
      } else if (editing) {
        await api.updateLink(editing.id, {
          channel_id: form.channel_id,
          is_active: form.is_active,
        })
      }
      setEditing(null)
      reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.loadFailed'))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (link: Link) => {
    try {
      await api.deleteLink(link.id)
      reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.loadFailed'))
    }
  }

  const isNew = editing === 'new'

  return (
    <>
      <div className='flex flex-col gap-4'>
        <div className='flex items-center justify-between'>
          {error && <p className='text-destructive text-sm'>{error}</p>}
          <span className='flex-1' />
          <Button size='sm' onClick={openNew}>
            <Plus className='size-4' />
            {t('links.new')}
          </Button>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('links.course')}</TableHead>
              <TableHead>{t('links.guild')}</TableHead>
              <TableHead>{t('links.channel')}</TableHead>
              <TableHead>{t('links.active')}</TableHead>
              <TableHead className='w-px' />
            </TableRow>
          </TableHeader>
          <TableBody>
            {links.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className='text-muted-foreground text-center'>
                  {t('links.empty')}
                </TableCell>
              </TableRow>
            ) : (
              links.map((link) => (
                <TableRow
                  key={link.id}
                  className='cursor-pointer'
                  onClick={() => openEdit(link)}
                >
                  <TableCell>
                    {link.course_name ?? t('links.unknownCourse')}
                    <span className='text-muted-foreground ms-2 font-mono text-xs'>
                      {link.course_id}
                    </span>
                  </TableCell>
                  <TableCell className='text-xs'>
                    {guildName(link.guild_id) ?? (
                      <span className='font-mono'>{link.guild_id}</span>
                    )}
                  </TableCell>
                  <TableCell className='text-xs'>
                    {channelName(link.channel_id) ? (
                      <span>#{channelName(link.channel_id)}</span>
                    ) : (
                      <span className='font-mono'>{link.channel_id}</span>
                    )}
                  </TableCell>
                  <TableCell>{link.is_active ? '✅' : '❌'}</TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant='ghost' size='sm' className='text-destructive'>
                          <Trash2 className='size-4' />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>{t('links.delete')}</AlertDialogTitle>
                          <AlertDialogDescription>
                            {t('links.deleteConfirm', {
                              name: link.course_name ?? link.course_id,
                            })}
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                          <AlertDialogAction onClick={() => handleDelete(link)}>
                            {t('links.delete')}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{isNew ? t('links.new') : t('links.edit')}</DialogTitle>
          </DialogHeader>
          <div className='flex flex-col gap-4'>
            {error && <p className='text-destructive text-sm'>{error}</p>}

            <div className='grid gap-2'>
              <Label htmlFor='ln-course'>{t('links.course')}</Label>
              <Select
                value={form.course_id}
                onValueChange={(v) => setForm((f) => ({ ...f, course_id: v }))}
                disabled={!isNew}
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
                  disabled={!isNew}
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
                  disabled={!isNew}
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

            <div className='flex items-center gap-3'>
              <Switch
                id='ln-active'
                checked={form.is_active}
                onCheckedChange={(v) => setForm((f) => ({ ...f, is_active: v }))}
              />
              <Label htmlFor='ln-active'>{t('links.active')}</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant='ghost' onClick={() => setEditing(null)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {t('links.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
