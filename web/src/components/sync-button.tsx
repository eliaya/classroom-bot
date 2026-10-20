import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useSyncStatusStore } from '@/stores/sync-status-store'
import { api } from '@/lib/api'
import { useCan } from '@/lib/permissions'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

/** Header button: start a full sync; progress shows in the sync notification. */
export function SyncButton() {
  const { t } = useTranslation()
  const canSync = useCan('sync:use')
  const [syncing, setSyncing] = useState(false)
  if (!canSync) return null

  const sync = async () => {
    setSyncing(true)
    try {
      await api.triggerSync()
      useSyncStatusStore.getState().startPolling()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('sync.syncFailed'))
    } finally {
      setSyncing(false)
    }
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant='ghost'
          size='icon'
          className='rounded-full'
          onClick={sync}
          disabled={syncing}
          aria-label={t('sync.syncNow')}
        >
          <RefreshCw className={cn(syncing && 'animate-spin')} aria-hidden='true' />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{t('sync.syncNow')}</TooltipContent>
    </Tooltip>
  )
}
