import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Main } from '@/components/layout/main'
import { api, type SyncRun } from '@/lib/api'
import { ClassroomHeader } from './layout-header'

export function SyncPage() {
  const [runs, setRuns] = useState<SyncRun[]>([])
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = () =>
    api
      .syncStatus()
      .then((res) => {
        setRuns(res.runs)
        setError(null)
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : 'Load failed')
        setRuns([])
      })

  useEffect(() => {
    void load()
  }, [])

  const handleSync = async () => {
    setSyncing(true)
    try {
      await api.triggerSync()
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sync failed')
    } finally {
      setSyncing(false)
    }
  }

  return (
    <>
      <ClassroomHeader fixed />
      <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>
        <div className='flex flex-wrap items-end justify-between gap-2'>
          <div>
            <h2 className='text-2xl font-bold tracking-tight'>Sync</h2>
            <p className='text-muted-foreground'>
              Trigger full Classroom sync and view run history
            </p>
          </div>
          <Button onClick={() => void handleSync()} disabled={syncing}>
            <RefreshCw className={syncing ? 'animate-spin' : ''} />
            {syncing ? 'Starting…' : 'Trigger full sync'}
          </Button>
        </div>

        {error && <p className='text-destructive text-sm'>{error}</p>}

        <div className='overflow-hidden rounded-md border'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>Resource</TableHead>
                <TableHead>Course</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Items</TableHead>
                <TableHead>Error</TableHead>
                <TableHead>Finished</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map((run) => (
                <TableRow key={run.id}>
                  <TableCell>{run.id}</TableCell>
                  <TableCell>{run.resource}</TableCell>
                  <TableCell className='font-mono text-xs'>
                    {run.course_id || 'all'}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        run.status === 'error' ? 'destructive' : 'secondary'
                      }
                    >
                      {run.status}
                    </Badge>
                  </TableCell>
                  <TableCell>{run.items_count}</TableCell>
                  <TableCell className='max-w-48 truncate text-muted-foreground text-sm'>
                    {run.error_message || '—'}
                  </TableCell>
                  <TableCell className='text-muted-foreground text-sm'>
                    {run.finished_at || run.started_at || '—'}
                  </TableCell>
                </TableRow>
              ))}
              {!runs.length && (
                <TableRow>
                  <TableCell colSpan={7} className='text-muted-foreground'>
                    No sync runs recorded yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </Main>
    </>
  )
}