import { useState } from 'react'
import { Loader2, LogIn } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { api, ApiError } from '@/lib/api'
import { hardNavigate } from '@/lib/navigate'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/** Administrators (ADMIN_EMAILS) sign in with a password instead of Google. */
export function AdminAuthForm({ redirectTo }: { redirectTo?: string }) {
  const { t } = useTranslation()
  const [isLoading, setIsLoading] = useState(false)

  async function signIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setIsLoading(true)
    try {
      // The API sets the session cookie and hands back a checked return path.
      const { next } = await api.loginPassword(
        String(form.get('email')),
        String(form.get('password')),
        redirectTo || '/'
      )
      hardNavigate(next)
    } catch (error) {
      setIsLoading(false)
      const wrongPassword = error instanceof ApiError && error.status === 401
      toast.error(
        wrongPassword
          ? t('auth.signInFailed', { reason: t('auth.signInErrors.invalid_credentials') })
          : error instanceof Error ? error.message : t('auth.error')
      )
    }
  }

  return (
    <form onSubmit={signIn} className='grid gap-3'>
      <div className='grid gap-1.5'>
        <Label htmlFor='admin-email'>{t('auth.email')}</Label>
        <Input
          id='admin-email'
          name='email'
          type='email'
          autoComplete='username'
          placeholder={t('auth.emailPlaceholder')}
          required
        />
      </div>
      <div className='grid gap-1.5'>
        <Label htmlFor='admin-password'>{t('auth.password')}</Label>
        <Input
          id='admin-password'
          name='password'
          type='password'
          autoComplete='current-password'
          required
        />
      </div>
      <Button type='submit' disabled={isLoading}>
        {isLoading ? <Loader2 className='animate-spin' /> : <LogIn />}
        {t('auth.signInButton')}
      </Button>
    </form>
  )
}
