import { useState } from 'react'
import { Loader2, LogIn } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { hardNavigate } from '@/lib/navigate'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

interface UserAuthFormProps extends React.HTMLAttributes<HTMLDivElement> {
  redirectTo?: string
}

export function UserAuthForm({
  className,
  redirectTo,
  ...props
}: UserAuthFormProps) {
  const { t } = useTranslation()
  const [isLoading, setIsLoading] = useState(false)

  async function signIn() {
    setIsLoading(true)
    try {
      // Google sends the browser back to the API, which sets the session
      // cookie and redirects to `redirectTo`.
      const { authorization_url } = await api.loginStart(
        window.location.origin,
        redirectTo || '/'
      )
      hardNavigate(authorization_url)
    } catch (error) {
      setIsLoading(false)
      toast.error(error instanceof Error ? error.message : t('auth.error'))
    }
  }

  return (
    <div className={cn('grid gap-3', className)} {...props}>
      <Button type='button' onClick={signIn} disabled={isLoading}>
        {isLoading ? <Loader2 className='animate-spin' /> : <LogIn />}
        {t('auth.continueWithGoogle')}
      </Button>
    </div>
  )
}
