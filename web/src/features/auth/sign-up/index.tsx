import { Link } from '@tanstack/react-router'
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
import { SignUpForm } from './components/sign-up-form'

export function SignUp() {
  const { t } = useTranslation()
  return (
    <AuthLayout>
      <Card className='max-w-sm gap-4'>
        <CardHeader>
          <CardTitle className='text-lg tracking-tight'>
            {t('auth.signUpTitle')}
          </CardTitle>
          <CardDescription>
            {t('auth.signUpDesc')}{' '}
            <Link
              to='/sign-in'
              className='underline underline-offset-4 hover:text-primary'
            >
              {t('auth.signInLink')}
            </Link>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SignUpForm />
        </CardContent>
        <CardFooter>
          <p className='px-8 text-center text-sm text-muted-foreground'>
            <Trans
              i18nKey='auth.termsSignUp'
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
