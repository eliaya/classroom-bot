import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '@/stores/auth-store'
import { api, type AdminUser, type Role } from '@/lib/api'
import { useCan } from '@/lib/permissions'
import { humanReadableTime } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
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

// Radix Select has no empty value; this stands for "no role" (awaiting approval).
const PENDING = 'pending'

/** Everyone who has signed in with Google: approve them by assigning a role. */
export function UsersSection() {
  const { t } = useTranslation()
  const me = useAuthStore((state) => state.auth.user)
  const canEdit = useCan('users:use')
  const [users, setUsers] = useState<AdminUser[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([api.listUsers(), api.listRoles()])
      .then(([u, r]) => {
        setUsers(u.items)
        setRoles(r.items)
      })
      .catch((e) => setMsg(e instanceof Error ? e.message : t('common.loadFailed')))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const update = async (id: number, body: { role_id?: number | null; is_active?: boolean }) => {
    setMsg(null)
    try {
      const saved = await api.updateUser(id, body)
      setUsers((prev) => prev.map((u) => (u.id === id ? saved : u)))
      setMsg(t('common.saved'))
    } catch (e) {
      setMsg(e instanceof Error ? e.message : t('common.saveFailed'))
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.users.title')}</CardTitle>
        <CardDescription>{t('settings.users.desc')}</CardDescription>
      </CardHeader>
      <CardContent className='space-y-4'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('settings.users.colUser')}</TableHead>
              <TableHead>{t('settings.users.colRole')}</TableHead>
              <TableHead>{t('settings.users.colActive')}</TableHead>
              <TableHead>{t('settings.users.colLastLogin')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((u) => {
              // Your own role and status are locked so you cannot lock yourself out.
              const locked = !canEdit || u.id === me?.id
              return (
                <TableRow key={u.id}>
                  <TableCell>
                    <div className='font-medium'>
                      {u.name || u.email}{' '}
                      {u.id === me?.id && <Badge variant='outline'>{t('settings.users.you')}</Badge>}{' '}
                      {u.is_env_admin && (
                        <Badge variant='secondary' title={t('settings.users.envAdminHint')}>
                          {t('settings.users.envAdmin')}
                        </Badge>
                      )}
                    </div>
                    <div className='text-muted-foreground text-xs'>{u.email}</div>
                  </TableCell>
                  <TableCell>
                    <Select
                      value={u.role_id == null ? PENDING : String(u.role_id)}
                      onValueChange={(v) =>
                        void update(u.id, { role_id: v === PENDING ? null : Number(v) })
                      }
                      disabled={locked}
                    >
                      <SelectTrigger className='w-56' aria-label={t('settings.users.colRole')}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={PENDING}>{t('settings.users.pending')}</SelectItem>
                        {roles.map((r) => (
                          <SelectItem key={r.id} value={String(r.id)}>
                            {r.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={u.is_active}
                      onCheckedChange={(checked) => void update(u.id, { is_active: checked })}
                      disabled={locked}
                      aria-label={t('settings.users.colActive')}
                    />
                  </TableCell>
                  <TableCell className='text-muted-foreground text-sm'>
                    {humanReadableTime(u.last_login_at, t('common.never'))}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
        {msg && <p className='text-muted-foreground text-xs'>{msg}</p>}
      </CardContent>
    </Card>
  )
}
