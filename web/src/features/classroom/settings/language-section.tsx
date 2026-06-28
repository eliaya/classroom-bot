import { Languages } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useLocale } from '@/context/locale-provider'
import { type Locale, SUPPORTED_LOCALES } from '@/lib/i18n'

/** Interface-language picker. */
export function LanguageSection() {
  const { t } = useTranslation()
  const { locale, setLocale } = useLocale()

  return (
    <Card>
      <CardHeader>
        <CardTitle className='flex items-center gap-2'>
          <Languages className='h-5 w-5' />
          {t('language.title')}
        </CardTitle>
        <CardDescription>{t('language.desc')}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className='flex flex-col gap-1.5'>
          <Label htmlFor='interface-language'>{t('language.label')}</Label>
          <Select value={locale} onValueChange={(value) => setLocale(value as Locale)}>
            <SelectTrigger id='interface-language' className='w-full sm:w-64'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SUPPORTED_LOCALES.map((l) => (
                <SelectItem key={l.value} value={l.value}>
                  {l.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardContent>
    </Card>
  )
}
