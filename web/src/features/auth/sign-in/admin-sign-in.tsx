import { useSearch } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { AuthLayout } from '../auth-layout'
import { AdminAuthForm } from './components/admin-auth-form'

/** The administrators' own sign-in page; everyone else uses `/login`. */
export function AdminSignIn() {
  const { redirect } = useSearch({ from: '/(auth)/admin/login' })
  const { t } = useTranslation()

  return (
    <AuthLayout>
      <Card className='max-w-sm gap-4'>
        <CardHeader>
          <CardTitle className='text-lg tracking-tight'>{t('auth.adminSignIn')}</CardTitle>
        </CardHeader>
        <CardContent>
          <AdminAuthForm redirectTo={redirect} />
        </CardContent>
      </Card>
    </AuthLayout>
  )
}
