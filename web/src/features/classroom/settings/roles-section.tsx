import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api, type ExternalStorageAdmin, type Role } from '@/lib/api'
import { useCan } from '@/lib/permissions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

type Modules = Record<string, string[]>

/** Roles are named permission sets; each user holds exactly one. */
export function RolesSection() {
  const { t } = useTranslation()
  const canEdit = useCan('users:use')
  const [roles, setRoles] = useState<Role[]>([])
  const [modules, setModules] = useState<Modules>({})
  const [newName, setNewName] = useState('')
  const [msg, setMsg] = useState<string | null>(null)

  const load = () =>
    api
      .listRoles()
      .then((r) => {
        setRoles(r.items)
        setModules(r.modules)
      })
      .catch((e) => setMsg(e instanceof Error ? e.message : t('common.loadFailed')))

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Every change is saved at once; a failure reloads what the server holds.
  const run = async (action: () => Promise<unknown>, ok: string) => {
    setMsg(null)
    try {
      await action()
      setMsg(ok)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : t('common.saveFailed'))
    }
    await load()
  }

  const toggle = (role: Role, key: string, on: boolean) => {
    const permissions = on
      ? [...role.permissions, key]
      : role.permissions.filter((p) => p !== key)
    void run(() => api.updateRole(role.id, { permissions }), t('common.saved'))
  }

  const create = () => {
    const name = newName.trim()
    if (!name) return
    setNewName('')
    void run(() => api.createRole({ name, permissions: [] }), t('common.created'))
  }

  return (
    <div className='flex flex-col gap-4 sm:gap-6'>
      <Card>
        <CardHeader>
          <CardTitle>{t('settings.roles.title')}</CardTitle>
          <CardDescription>{t('settings.roles.desc')}</CardDescription>
        </CardHeader>
        <CardContent className='space-y-3'>
          <div className='flex flex-wrap items-end gap-3'>
            <div className='space-y-1'>
              <Label htmlFor='new-role-name'>{t('settings.roles.newRole')}</Label>
              <Input
                id='new-role-name'
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                maxLength={64}
                className='w-56'
                disabled={!canEdit}
              />
            </div>
            <Button onClick={create} disabled={!canEdit || !newName.trim()}>
              {t('settings.roles.create')}
            </Button>
          </div>
          <p className='text-muted-foreground text-xs'>{t('settings.roles.adminHint')}</p>
          {msg && <p className='text-muted-foreground text-xs'>{msg}</p>}
        </CardContent>
      </Card>

      <ExternalStorageCard canEdit={canEdit} />

      {roles.map((role) => {
        const isAdmin = role.permissions.includes('*')
        return (
          <Card key={role.id}>
            <CardHeader>
              <CardTitle className='flex items-center gap-2'>
                {role.name}
                {role.is_system && <Badge variant='secondary'>{t('settings.roles.system')}</Badge>}
              </CardTitle>
              {isAdmin && <CardDescription>{t('settings.roles.allPermissions')}</CardDescription>}
            </CardHeader>
            {!isAdmin && (
              <CardContent className='space-y-3'>
                <div className='grid gap-2 sm:grid-cols-2'>
                  {Object.entries(modules).map(([module, actions]) => (
                    <div key={module} className='flex items-center justify-between gap-3 rounded border p-2 text-sm'>
                      <span className='font-medium'>{t(`settings.roles.modules.${module}`, { defaultValue: module })}</span>
                      <div className='flex gap-4'>
                        {actions.map((action) => {
                          const key = `${module}:${action}`
                          const id = `role-${role.id}-${key}`
                          return (
                            <div key={key} className='flex items-center gap-1.5'>
                              <Checkbox
                                id={id}
                                checked={role.permissions.includes(key)}
                                onCheckedChange={(checked) => toggle(role, key, checked === true)}
                                disabled={!canEdit}
                              />
                              <Label htmlFor={id} className='font-normal'>
                                {t(`settings.roles.actions.${action}`, { defaultValue: action })}
                              </Label>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
                {!role.is_system && (
                  <Button
                    variant='outline'
                    size='sm'
                    className='text-destructive'
                    disabled={!canEdit}
                    onClick={() => void run(() => api.deleteRole(role.id), t('common.deleted'))}
                  >
                    {t('settings.roles.delete')}
                  </Button>
                )}
              </CardContent>
            )}
          </Card>
        )
      })}
    </div>
  )
}

/**
 * Whether users may move attachments to external storage, and the WebDAV hosts
 * the server may connect to for them (formerly OPENCLOUD_ALLOWED_HOSTS).
 */
function ExternalStorageCard({ canEdit }: { canEdit: boolean }) {
  const { t } = useTranslation()
  const [config, setConfig] = useState<ExternalStorageAdmin | null>(null)
  const [hosts, setHosts] = useState('')
  const [msg, setMsg] = useState<string | null>(null)

  const show = (c: ExternalStorageAdmin) => {
    setConfig(c)
    setHosts(c.allowed_hosts.join(', '))
  }

  useEffect(() => {
    api
      .getExternalStorage()
      .then(show)
      .catch((e) => setMsg(e instanceof Error ? e.message : t('common.loadFailed')))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const save = async (body: Partial<ExternalStorageAdmin>) => {
    setMsg(null)
    try {
      show(await api.updateExternalStorage(body))
      setMsg(t('common.saved'))
    } catch (e) {
      setMsg(e instanceof Error ? e.message : t('common.saveFailed'))
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.roles.externalStorage.title')}</CardTitle>
        <CardDescription>{t('settings.roles.externalStorage.desc')}</CardDescription>
      </CardHeader>
      <CardContent className='space-y-3'>
        <div className='flex items-center justify-between gap-3'>
          <Label htmlFor='external-storage-enabled'>
            {t(config?.enabled ? 'settings.roles.externalStorage.enabled' : 'settings.roles.externalStorage.disabled')}
          </Label>
          <Switch
            id='external-storage-enabled'
            checked={config?.enabled ?? false}
            disabled={!config || !canEdit}
            onCheckedChange={(enabled) => void save({ enabled })}
          />
        </div>
        <div className='flex flex-wrap items-end gap-3'>
          <div className='min-w-0 flex-1 space-y-1'>
            <Label htmlFor='external-storage-hosts'>{t('settings.roles.externalStorage.hosts')}</Label>
            <Input
              id='external-storage-hosts'
              value={hosts}
              onChange={(e) => setHosts(e.target.value)}
              placeholder='cloud.example.com, nextcloud.example.org'
              disabled={!config || !canEdit}
            />
          </div>
          <Button
            onClick={() => void save({ allowed_hosts: hosts.split(',') })}
            disabled={!config || !canEdit}
          >
            {t('settings.save')}
          </Button>
        </div>
        <p className='text-muted-foreground text-xs'>{t('settings.roles.externalStorage.hostsHint')}</p>
        {msg && <p className='text-muted-foreground text-xs'>{msg}</p>}
      </CardContent>
    </Card>
  )
}
