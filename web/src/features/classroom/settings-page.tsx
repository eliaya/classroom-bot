import { useEffect, useState } from 'react'
import { CheckCircle2, XCircle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Main } from '@/components/layout/main'
import { api } from '@/lib/api'
import { ClassroomHeader } from './layout-header'

export function ClassroomSettingsPage() {
  const [health, setHealth] = useState<string | null>(null)
  const [googleStatus, setGoogleStatus] = useState<string | null>(null)
  const [pythonVersion, setPythonVersion] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([api.health(), api.status()])
      .then(([h, s]) => {
        setHealth(h.status)
        setGoogleStatus(s.google_credentials)
        setPythonVersion(s.python ?? null)
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Load failed'))
  }, [])

  const oauthOk = googleStatus === 'valid'

  return (
    <>
      <ClassroomHeader fixed />
      <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>
        <div>
          <h2 className='text-2xl font-bold tracking-tight'>Settings</h2>
          <p className='text-muted-foreground'>
            API health, OAuth credentials, and sync configuration
          </p>
        </div>

        {error && <p className='text-destructive text-sm'>{error}</p>}

        <div className='grid gap-4 md:grid-cols-2'>
          <Card>
            <CardHeader>
              <CardTitle>API health</CardTitle>
              <CardDescription>FastAPI backend status</CardDescription>
            </CardHeader>
            <CardContent className='flex items-center gap-2'>
              {health === 'ok' ? (
                <CheckCircle2 className='h-5 w-5 text-green-600' />
              ) : (
                <XCircle className='h-5 w-5 text-destructive' />
              )}
              <Badge variant={health === 'ok' ? 'secondary' : 'destructive'}>
                {health || 'unknown'}
              </Badge>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Google OAuth</CardTitle>
              <CardDescription>Classroom API credentials</CardDescription>
            </CardHeader>
            <CardContent className='flex items-center gap-2'>
              {oauthOk ? (
                <CheckCircle2 className='h-5 w-5 text-green-600' />
              ) : (
                <XCircle className='h-5 w-5 text-destructive' />
              )}
              <Badge variant={oauthOk ? 'secondary' : 'destructive'}>
                {googleStatus || 'unknown'}
              </Badge>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Setup instructions</CardTitle>
            <CardDescription>
              Required steps when credentials are missing or scopes change
            </CardDescription>
          </CardHeader>
          <CardContent className='space-y-4 text-sm'>
            <div>
              <p className='font-medium'>1. Authorize Google OAuth</p>
              <p className='text-muted-foreground'>
                Run{' '}
                <code className='rounded bg-muted px-1 py-0.5'>
                  python src/scripts/setup_google_auth.py
                </code>{' '}
                on the host to refresh tokens with Classroom scopes (rosters,
                coursework, materials).
              </p>
            </div>
            <Separator />
            <div>
              <p className='font-medium'>2. Background sync interval</p>
              <p className='text-muted-foreground'>
                Set{' '}
                <code className='rounded bg-muted px-1 py-0.5'>
                  CLASSROOM_SYNC_INTERVAL_MINUTES
                </code>{' '}
                in <code className='rounded bg-muted px-1 py-0.5'>.env</code>{' '}
                (default 30). Set to 0 to disable automatic sync.
              </p>
            </div>
            <Separator />
            <div>
              <p className='font-medium'>3. Admin API token (optional)</p>
              <p className='text-muted-foreground'>
                Set{' '}
                <code className='rounded bg-muted px-1 py-0.5'>
                  VITE_ADMIN_API_TOKEN
                </code>{' '}
                in the web build environment if the API requires Bearer auth.
              </p>
            </div>
            {pythonVersion && (
              <>
                <Separator />
                <p className='text-muted-foreground'>
                  API Python version: {pythonVersion}
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </Main>
    </>
  )
}