import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api, type DiscordGuild } from '@/lib/api'
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

/**
 * The Discord servers the bot is in, and which of them are connected to you.
 * A server must be connected before its channels can be linked: the bot then
 * acts there with your Classroom data. `onChange` fires after a server is
 * connected or disconnected so the caller can reload what depends on it.
 */
export function GuildsCard({ onChange }: { onChange: () => void }) {
  const { t } = useTranslation()
  const canEdit = useCan('links:use')
  const [guilds, setGuilds] = useState<DiscordGuild[]>([])
  const [msg, setMsg] = useState<string | null>(null)

  const load = () =>
    api
      .listGuilds()
      .then((res) => setGuilds(res.items))
      .catch((e) => setMsg(e instanceof Error ? e.message : t('common.loadFailed')))

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const run = async (action: () => Promise<unknown>) => {
    setMsg(null)
    try {
      await action()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : t('common.saveFailed'))
    }
    await load()
    onChange()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('links.servers')}</CardTitle>
        <CardDescription>{t('links.serversDesc')}</CardDescription>
      </CardHeader>
      <CardContent className='flex flex-col divide-y'>
        {guilds.length === 0 && (
          <p className='text-muted-foreground text-sm'>{t('links.noServers')}</p>
        )}
        {guilds.map((g) => (
          <div key={g.guild_id} className='flex items-center justify-between gap-3 py-2 text-sm'>
            <div className='flex min-w-0 items-center gap-2'>
              <span className='truncate font-medium'>
                {g.guild_name ?? <span className='font-mono'>{g.guild_id}</span>}
              </span>
              <Badge variant={g.state === 'mine' ? 'secondary' : 'outline'}>
                {t(`links.serverState.${g.state}`)}
              </Badge>
            </div>
            {g.state === 'unbound' ? (
              <Button size='sm' disabled={!canEdit} onClick={() => void run(() => api.bindGuild(g.guild_id))}>
                {t('links.claim')}
              </Button>
            ) : (
              // Yours, or (for a user administrator) someone else's.
              <Button
                size='sm'
                variant='outline'
                disabled={!canEdit}
                onClick={() => void run(() => api.releaseGuild(g.guild_id))}
              >
                {t('links.release')}
              </Button>
            )}
          </div>
        ))}
        {msg && <p className='text-destructive pt-2 text-xs'>{msg}</p>}
      </CardContent>
    </Card>
  )
}
