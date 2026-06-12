import { useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Main } from '@/components/layout/main'
import { api } from '@/lib/api'
import { ClassroomHeader } from './layout-header'

export function ClassroomDashboard() {
  const [courseCount, setCourseCount] = useState(0)
  const [googleStatus, setGoogleStatus] = useState('unknown')
  const [lastRun, setLastRun] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    try {
      setError(null)
      const [courses, status, sync] = await Promise.all([
        api.listCourses(),
        api.status(),
        api.syncStatus(),
      ])
      setCourseCount(courses.total)
      setGoogleStatus(status.google_credentials)
      setLastRun(sync.runs[0]?.finished_at || sync.runs[0]?.started_at || null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load dashboard')
    }
  }

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
      <ClassroomHeader title='Classroom Admin' />
      <Main>
        <div className='mb-4 flex items-center justify-between'>
          <div>
            <h2 className='text-2xl font-bold tracking-tight'>Dashboard</h2>
            <p className='text-muted-foreground text-sm'>
              Google Classroom cache stored in local SQLite
            </p>
          </div>
          <Button onClick={() => void handleSync()} disabled={syncing}>
            {syncing ? 'Syncing…' : 'Sync all courses'}
          </Button>
        </div>

        {error && (
          <Card className='mb-4 border-destructive'>
            <CardContent className='pt-6 text-destructive text-sm'>{error}</CardContent>
          </Card>
        )}

        <div className='grid gap-4 md:grid-cols-3'>
          <Card>
            <CardHeader>
              <CardTitle>Courses</CardTitle>
              <CardDescription>Cached in database</CardDescription>
            </CardHeader>
            <CardContent className='text-3xl font-bold'>{courseCount}</CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Google OAuth</CardTitle>
              <CardDescription>API credential status</CardDescription>
            </CardHeader>
            <CardContent className='text-lg font-medium capitalize'>{googleStatus}</CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Last sync</CardTitle>
              <CardDescription>Most recent background run</CardDescription>
            </CardHeader>
            <CardContent className='text-sm'>{lastRun || 'Never'}</CardContent>
          </Card>
        </div>

        <Card className='mt-4'>
          <CardHeader>
            <CardTitle>Quick links</CardTitle>
          </CardHeader>
          <CardContent className='flex flex-wrap gap-2'>
            <Button variant='outline' asChild>
              <Link to='/courses'>Browse courses</Link>
            </Button>
            <Button variant='outline' asChild>
              <Link to='/sync'>Sync history</Link>
            </Button>
          </CardContent>
        </Card>
      </Main>
    </>
  )
}