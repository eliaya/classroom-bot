import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

type Tokens = Record<string, string>

/** A theme's fingerprint: background and primary, light then dark. */
export function ThemeSwatches({
  theme,
  labelled,
  className,
}: {
  theme: { light: Tokens; dark: Tokens }
  labelled?: boolean
  className?: string
}) {
  const { t } = useTranslation()
  return (
    <div className={cn('flex items-center gap-2', className)}>
      {(['light', 'dark'] as const).map((mode) => (
        <div key={mode} className='flex items-center gap-1'>
          {labelled && <span className='me-1 text-xs text-muted-foreground'>{t(`settings.themes.${mode}`)}</span>}
          {(['background', 'primary', 'accent'] as const).map((key) => (
            <span
              key={key}
              aria-hidden='true'
              className='size-4 rounded-full border border-border'
              // Values were sanitised by the server; React sets them as a property, not CSS text.
              style={{ background: theme[mode][key] }}
              title={`${mode} ${key}`}
            />
          ))}
        </div>
      ))}
    </div>
  )
}
