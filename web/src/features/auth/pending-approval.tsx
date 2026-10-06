import { useTranslation } from 'react-i18next'
import { api } from '@/lib/api'
import { hardNavigate } from '@/lib/navigate'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { AuthLayout } from './auth-layout'

/** Shown to a signed-in user that no administrator has given a role yet. */
export function PendingApproval({ email }: { email: string }) {
  const { t } = useTranslation()

  const signOut = async () => {
    await api.logout().catch(() => undefined)
    hardNavigate('/login')
  }

  return (
    <AuthLayout>
      <Card className='max-w-sm gap-4'>
        <CardHeader>
          <CardTitle className='text-lg tracking-tight'>{t('auth.pendingTitle')}</CardTitle>
          <CardDescription>{t('auth.pendingDesc', { email })}</CardDescription>
        </CardHeader>
        <CardFooter className='gap-2'>
          <Button onClick={() => window.location.reload()}>{t('auth.pendingCheck')}</Button>
          <Button variant='outline' onClick={signOut}>
            {t('userMenu.signOut')}
          </Button>
        </CardFooter>
      </Card>
    </AuthLayout>
  )
}
