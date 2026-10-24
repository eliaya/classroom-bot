import { useEffect, useMemo, useState } from 'react'
import { AppWindow, ImageIcon, X, type LucideIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { api, fileUrl, type SiteBranding } from '@/lib/api'
import { useBrandingStore } from '@/stores/branding-store'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import {
  FileUpload,
  FileUploadDropzone,
  FileUploadItem,
  FileUploadItemDelete,
  FileUploadItemMetadata,
  FileUploadItemPreview,
  FileUploadList,
  FileUploadTrigger,
} from '@/components/diceui/file-upload'
import { sidebarData } from '@/components/layout/data/sidebar-data'

type Kind = keyof SiteBranding

// Mirrors the API's allowlist and limits (src/api/routes/site.py).
const IMAGES = 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml'
const FIELDS: { kind: Kind; icon: LucideIcon; accept: string; maxSize: number }[] = [
  { kind: 'logo', icon: ImageIcon, accept: IMAGES, maxSize: 1024 * 1024 },
  { kind: 'favicon', icon: AppWindow, accept: `${IMAGES},image/x-icon,image/vnd.microsoft.icon,.ico`, maxSize: 256 * 1024 },
]

/** A picked file's object URL for the preview, freed when the file changes. */
function usePreviewUrl(file: File | undefined) {
  const url = useMemo(() => (file ? URL.createObjectURL(file) : null), [file])
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url])
  return url
}

/** Settings → Branding: the admin uploads the site logo and favicon; the
 *  preview shows them in the browser tab, the sidebar and the sign-in page before saving. */
export function BrandingSection() {
  const { t } = useTranslation()
  const saved = useBrandingStore()
  const [files, setFiles] = useState<Record<Kind, File[]>>({ logo: [], favicon: [] })
  const [removed, setRemoved] = useState<Record<Kind, boolean>>({ logo: false, favicon: false })
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const picked = { logo: usePreviewUrl(files.logo[0]), favicon: usePreviewUrl(files.favicon[0]) }
  // What the site will show once saved: the new file, else the upload in use, else nothing.
  const shown = (kind: Kind) => picked[kind] ?? (!removed[kind] && saved[kind] ? fileUrl(saved[kind]) : null)
  const dirty = FIELDS.some(({ kind }) => files[kind].length || (removed[kind] && saved[kind]))

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setMsg(null)
    try {
      for (const { kind } of FIELDS) {
        const file = files[kind][0]
        if (file) useBrandingStore.setState(await api.uploadSiteImage(kind, file))
        else if (removed[kind] && saved[kind]) useBrandingStore.setState(await api.deleteSiteImage(kind))
      }
      setFiles({ logo: [], favicon: [] })
      setRemoved({ logo: false, favicon: false })
      setMsg(t('common.saved'))
    } catch (err) {
      setMsg(err instanceof Error ? err.message : t('common.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const team = sidebarData.teams[0]
  const logo = shown('logo')
  const favicon = shown('favicon')

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.branding.title')}</CardTitle>
        <CardDescription>{t('settings.branding.desc')}</CardDescription>
      </CardHeader>
      <CardContent className='grid gap-8 lg:grid-cols-2'>
        <form onSubmit={onSubmit} className='w-full max-w-md space-y-6'>
          {FIELDS.map(({ kind, icon: Icon, accept, maxSize }) => (
            <div key={kind} className='space-y-2'>
              <Label>{t(`settings.branding.${kind}`)}</Label>
              <FileUpload
                value={files[kind]}
                onValueChange={(value) => setFiles((prev) => ({ ...prev, [kind]: value }))}
                onFileReject={(file, message) =>
                  setMsg(
                    t(
                      message === 'File too large'
                        ? 'settings.branding.tooLarge'
                        : message === 'File type not accepted'
                          ? 'settings.branding.wrongType'
                          : 'settings.branding.oneFile',
                      { name: file.name }
                    )
                  )
                }
                accept={accept}
                maxFiles={1}
                maxSize={maxSize}
                label={t(`settings.branding.${kind}`)}
                disabled={saving}
              >
                <FileUploadDropzone className='py-4'>
                  <div className='flex items-center gap-2'>
                    <Icon className='size-4 text-muted-foreground' />
                    <span className='text-sm text-muted-foreground'>{t('settings.branding.drop')}</span>
                    <FileUploadTrigger asChild>
                      <Button variant='link' size='sm' className='h-auto p-0'>
                        {t('settings.branding.browse')}
                      </Button>
                    </FileUploadTrigger>
                  </div>
                </FileUploadDropzone>
                <FileUploadList forceMount={!removed[kind] && !!saved[kind]}>
                  {files[kind].map((file, index) => (
                    <FileUploadItem key={index} value={file} className='p-2'>
                      <FileUploadItemPreview className='size-8' />
                      <FileUploadItemMetadata size='sm' />
                      <FileUploadItemDelete asChild>
                        <Button variant='ghost' size='icon' className='size-6' aria-label={t('settings.branding.remove')}>
                          <X className='size-3' />
                        </Button>
                      </FileUploadItemDelete>
                    </FileUploadItem>
                  ))}
                  {/* The upload in use, styled as a list item, until a new file replaces it. */}
                  {!files[kind].length && !removed[kind] && saved[kind] && (
                    <div role='listitem' className='relative flex items-center gap-2.5 rounded-md border p-2'>
                      <img
                        src={fileUrl(saved[kind])}
                        alt=''
                        className='size-8 shrink-0 rounded border bg-accent/50 object-contain'
                      />
                      <span className='min-w-0 flex-1 truncate text-sm font-medium'>
                        {t('settings.branding.inUse')}
                      </span>
                      <Button
                        type='button'
                        variant='ghost'
                        size='icon'
                        className='size-6'
                        aria-label={t('settings.branding.restore')}
                        title={t('settings.branding.restore')}
                        onClick={() => setRemoved((prev) => ({ ...prev, [kind]: true }))}
                      >
                        <X className='size-3' />
                      </Button>
                    </div>
                  )}
                </FileUploadList>
              </FileUpload>
              <p className='text-xs text-muted-foreground'>{t(`settings.branding.${kind}Hint`)}</p>
            </div>
          ))}

          {msg && (
            <p role='status' className='text-xs text-muted-foreground'>
              {msg}
            </p>
          )}
          <Button type='submit' className='w-full' disabled={!dirty || saving}>
            {t('settings.branding.save')}
          </Button>
        </form>

        <div className='space-y-2'>
          <Label>{t('settings.branding.preview')}</Label>
          <div className='overflow-hidden rounded-lg border text-start' aria-live='polite'>
            {/* Browser tab */}
            <div className='flex items-end border-b bg-muted px-3 pt-2'>
              <div className='flex max-w-60 items-center gap-2 rounded-t-md border border-b-0 bg-background px-3 py-1.5 text-xs'>
                {favicon ? (
                  <img src={favicon} alt='' className='size-4 shrink-0 object-contain' />
                ) : (
                  <>
                    <img src='/images/favicon.png' alt='' className='size-4 shrink-0 dark:hidden' />
                    <img src='/images/favicon_light.png' alt='' className='hidden size-4 shrink-0 dark:block' />
                  </>
                )}
                <span className='truncate'>{document.title || team.name}</span>
              </div>
            </div>
            {/* Sidebar header, as AppSidebar draws it */}
            <div className='flex items-center gap-2 border-b bg-sidebar p-3 text-sidebar-foreground'>
              {logo && <img src={logo} alt='' className='aspect-square size-8 shrink-0 rounded-lg object-contain' />}
              <div className='grid flex-1 text-sm leading-tight'>
                <span className='truncate font-semibold'>{team.name}</span>
                <span className='truncate text-xs'>{team.plan}</span>
              </div>
            </div>
            {/* Sign-in page heading, as AuthLayout draws it */}
            <div className='flex items-center justify-center bg-background py-8 text-foreground'>
              {logo && <img src={logo} alt='' className='me-2 size-6 object-contain' />}
              <span className='text-xl font-medium'>{t('auth.appName')}</span>
            </div>
          </div>
          <p className='text-xs text-muted-foreground'>{t('settings.branding.previewHint')}</p>
        </div>
      </CardContent>
    </Card>
  )
}
