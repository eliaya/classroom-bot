import { useTranslation } from 'react-i18next'
import { fileUrl } from '@/lib/api'
import { useBrandingStore } from '@/stores/branding-store'

type AuthLayoutProps = {
  children: React.ReactNode
}

export function AuthLayout({ children }: AuthLayoutProps) {
  const { t } = useTranslation()
  const logo = useBrandingStore((state) => state.logo)
  return (
    <div className='container grid h-svh max-w-none items-center justify-center'>
      <div className='mx-auto flex w-full flex-col justify-center space-y-2 py-8 sm:p-8'>
        <div className='mb-4 flex items-center justify-center'>
          {logo && <img src={fileUrl(logo)} alt='' className='me-2 size-6 object-contain' />}
          <h1 className='text-xl font-medium'>{t('auth.appName')}</h1>
        </div>
        {children}
      </div>
    </div>
  )
}
