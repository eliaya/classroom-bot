import { Link, useSearch } from '@tanstack/react-router'
import { Trans, useTranslation } from 'react-i18next'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { AuthLayout } from '../auth-layout'
import { UserAuthForm } from './components/user-auth-form'

export function SignIn() {
  const { redirect } = useSearch({ from: '/(auth)/sign-in' })
  const { t } = useTranslation()

  return (
    <AuthLayout>
      <Card className='max-w-sm gap-4'>
        <CardHeader>
          <CardTitle className='text-lg tracking-tight'>{t('auth.signInTitle')}</CardTitle>
          <CardDescription>
            {t('auth.signInDesc')}{' '}
            <Link
              to='/sign-up'
              className='text-nowrap underline underline-offset-4 hover:text-primary'
            >
              {t('auth.signUpLink')}
            </Link>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <UserAuthForm redirectTo={redirect} />
        </CardContent>
        <CardFooter>
          <p className='px-8 text-center text-sm text-muted-foreground'>
            <Trans
              i18nKey='auth.terms'
              components={{
                terms: (
                  <a
                    href='/terms'
                    className='underline underline-offset-4 hover:text-primary'
                  />
                ),
                privacy: (
                  <a
                    href='/privacy'
                    className='underline underline-offset-4 hover:text-primary'
                  />
                ),
              }}
            />
          </p>
        </CardFooter>
      </Card>
    </AuthLayout>
  )
}
