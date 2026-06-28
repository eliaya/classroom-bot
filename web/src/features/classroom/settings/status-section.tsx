import { useEffect, useState } from 'react'
import { CheckCircle2, KeyRound, XCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { api } from '@/lib/api'

type GoogleDetail = {
  token_exists: boolean
  client_secret_exists: boolean
  valid: boolean
  missing_scopes?: string[]
  expired?: boolean | null
  error?: string | null
}

/** API health + Google OAuth status, with the authorize/re-authorize flow. */
export function StatusSection() {
  const { t } = useTranslation()
  const [health, setHealth] = useState<string | null>(null)
  const [googleStatus, setGoogleStatus] = useState<string | null>(null)
  const [googleDetail, setGoogleDetail] = useState<GoogleDetail | null>(null)
  const [authorizing, setAuthorizing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadStatus = () =>
    Promise.all([api.health(), api.status()])
      .then(([h, s]) => {
        setHealth(h.status)
        setGoogleStatus(s.google_credentials)
        setGoogleDetail((s.google as GoogleDetail) ?? null)
      })
      .catch((e) => setError(e instanceof Error ? e.message : t('settings.loadFailed')))

  useEffect(() => {
    // Handle the redirect back from the Google OAuth callback.
    const params = new URLSearchParams(window.location.search)
    const authResult = params.get('auth')
    if (authResult === 'success') {
      toast.success(t('settings.authComplete'))
    } else if (authResult === 'error') {
      toast.error(t('settings.authFailed', { reason: params.get('reason') ?? t('settings.authUnknown') }))
    }
    if (authResult) {
      // Strip the query params so a refresh doesn't re-toast.
      window.history.replaceState({}, '', window.location.pathname)
    }
    void loadStatus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleAuthorize = async () => {
    setAuthorizing(true)
    try {
      const { authorization_url } = await api.googleAuthStart(window.location.origin)
      // Full-page redirect to Google's consent screen; the callback returns here.
      window.location.href = authorization_url
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('settings.authStartFailed'))
      setAuthorizing(false)
    }
  }

  const oauthOk = googleStatus === 'valid'

  return (
    <>
      {error && <p className='text-destructive text-sm'>{error}</p>}
      <div className='grid gap-4 md:grid-cols-2'>
        <Card>
          <CardHeader>
            <CardTitle>{t('settings.apiHealth')}</CardTitle>
            <CardDescription>{t('settings.apiHealthDesc')}</CardDescription>
          </CardHeader>
          <CardContent className='flex items-center gap-2'>
            {health === 'ok' ? (
              <CheckCircle2 className='h-5 w-5 text-green-600' />
            ) : (
              <XCircle className='h-5 w-5 text-destructive' />
            )}
            <Badge variant={health === 'ok' ? 'secondary' : 'destructive'}>
              {health || t('settings.unknown')}
            </Badge>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t('settings.googleOauth')}</CardTitle>
            <CardDescription>{t('settings.googleOauthDesc')}</CardDescription>
          </CardHeader>
          <CardContent className='flex flex-col gap-3'>
            <div className='flex items-center gap-2'>
              {oauthOk ? (
                <CheckCircle2 className='h-5 w-5 text-green-600' />
              ) : (
                <XCircle className='h-5 w-5 text-destructive' />
              )}
              <Badge variant={oauthOk ? 'secondary' : 'destructive'}>
                {googleStatus || t('settings.unknown')}
              </Badge>
              {googleDetail?.expired ? (
                <Badge variant='outline'>{t('settings.expired')}</Badge>
              ) : null}
            </div>
            {googleDetail?.missing_scopes &&
              googleDetail.missing_scopes.length > 0 && (
                <p className='text-muted-foreground text-xs'>
                  {t('settings.missingScopes', { count: googleDetail.missing_scopes.length })}
                </p>
              )}
            {!oauthOk && googleDetail?.error && (
              <p className='text-muted-foreground text-xs break-all'>
                {googleDetail.error}
              </p>
            )}
            <Button
              onClick={() => void handleAuthorize()}
              disabled={authorizing || googleDetail?.client_secret_exists === false}
              className='w-fit'
            >
              <KeyRound className={authorizing ? 'animate-pulse' : ''} />
              {authorizing
                ? t('settings.redirecting')
                : oauthOk
                  ? t('settings.reauthorize')
                  : t('settings.authorize')}
            </Button>
            {googleDetail?.client_secret_exists === false && (
              <p className='text-destructive text-xs'>
                {t('settings.clientSecretMissing')}
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  )
}
