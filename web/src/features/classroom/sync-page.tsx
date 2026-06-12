import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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

  const load = () =>
    api
      .syncStatus()
      .then((res) => setRuns(res.runs))
      .catch(() => setRuns([]))

  useEffect(() => {
    void load()
  }, [])

  const handleSync = async () => {
    setSyncing(true)
    try {
      await api.triggerSync()
      await load()
    } finally {
      setSyncing(false)
    }
  }

  return (
    <>
      <ClassroomHeader title='Sync' />
      <Main>
        <div className='mb-4'>
          <Button onClick={() => void handleSync()} disabled={syncing}>
            {syncing ? 'Starting…' : 'Trigger full sync'}
          </Button>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Sync history</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Resource</TableHead>
                  <TableHead>Course</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Items</TableHead>
                  <TableHead>Finished</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((run) => (
                  <TableRow key={run.id}>
                    <TableCell>{run.id}</TableCell>
                    <TableCell>{run.resource}</TableCell>
                    <TableCell className='font-mono text-xs'>{run.course_id || 'all'}</TableCell>
                    <TableCell>{run.status}</TableCell>
                    <TableCell>{run.items_count}</TableCell>
                    <TableCell>{run.finished_at || run.started_at || '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </Main>
    </>
  )
}