import { useEffect, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { api } from '@/lib/api'

// The browser-visible URL Google redirects back to after consent. Must be
// registered as an authorized redirect URI on the OAuth client in the console.
const callbackUri =
  typeof window !== 'undefined'
    ? `${window.location.origin}/api/auth/google/callback`
    : ''

/** Static onboarding guide for wiring up Google OAuth credentials. */
export function SetupSection() {
  const { t } = useTranslation()
  const [pythonVersion, setPythonVersion] = useState<string | null>(null)

  useEffect(() => {
    api
      .status()
      .then((s) => setPythonVersion(s.python ?? null))
      .catch(() => setPythonVersion(null))
  }, [])

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.setupTitle')}</CardTitle>
        <CardDescription>{t('settings.setupDesc')}</CardDescription>
      </CardHeader>
      <CardContent className='space-y-4 text-sm'>
        <div className='flex flex-col gap-2'>
          <p className='font-medium'>{t('settings.step1Title')}</p>
          <p className='text-muted-foreground'>
            <Trans i18nKey='settings.step1Desc' components={{ strong: <strong /> }} />
          </p>
          <Alert>
            <AlertTitle>{t('settings.step1AlertTitle')}</AlertTitle>
            <AlertDescription>
              <p>
                <Trans i18nKey='settings.step1AlertDesc' components={{ strong: <strong /> }} />
              </p>
              <code className='rounded bg-muted px-1 py-0.5 break-all'>{callbackUri}</code>
            </AlertDescription>
          </Alert>
        </div>
        <Separator />
        <div>
          <p className='font-medium'>{t('settings.step2Title')}</p>
          <p className='text-muted-foreground'>
            <Trans
              i18nKey='settings.step2Desc'
              components={{
                strong: <strong />,
                code: <code className='rounded bg-muted px-1 py-0.5' />,
              }}
            />
          </p>
        </div>
        <Separator />
        <div>
          <p className='font-medium'>{t('settings.step3Title')}</p>
          <p className='text-muted-foreground'>
            <Trans
              i18nKey='settings.step3Desc'
              components={{ code: <code className='rounded bg-muted px-1 py-0.5' /> }}
            />
          </p>
        </div>
        {pythonVersion && (
          <>
            <Separator />
            <p className='text-muted-foreground'>
              {t('settings.pythonVersion', { version: pythonVersion })}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  )
}
