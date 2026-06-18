import { fileUrl, type Attachment } from '@/lib/api'

// Shared attachment design used by both the Classwork page and the Courses
// split-screen detail panel, so the two stay visually identical.

export function formatBytes(n?: number | null): string {
  if (!n || n <= 0) return ''
  const units = ['B', 'KB', 'MB', 'GB']
  let v = n
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`
}

// SVG icons for each attachment source type
function IconDrive({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox='0 0 24 24' fill='none' aria-hidden='true'>
      <path d='M7.71 3 2 13l4.29 7h11.42L22 13 16.29 3H7.71Z' fill='#4285F4' />
      <path d='m2 13 4.29 7H22L16.29 13H2Z' fill='#34A853' opacity='.9' />
      <path d='M7.71 3 2 13h6.25L16.29 3H7.71Z' fill='#FBBC05' opacity='.9' />
    </svg>
  )
}

function IconYouTube({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox='0 0 24 24' aria-hidden='true'>
      <path
        d='M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2C0 8.1 0 12 0 12s0 3.9.5 5.8a3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1C24 15.9 24 12 24 12s0-3.9-.5-5.8Z'
        fill='#FF0000'
      />
      <path d='M9.6 15.6V8.4L15.8 12 9.6 15.6Z' fill='#fff' />
    </svg>
  )
}

function IconForm({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox='0 0 24 24' fill='none' aria-hidden='true'>
      <rect width='24' height='24' rx='3' fill='#673AB7' />
      <path d='M7 8h10M7 12h10M7 16h6' stroke='#fff' strokeWidth='1.8' strokeLinecap='round' />
    </svg>
  )
}

function IconLink({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'>
      <path d='M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71' />
      <path d='M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71' />
    </svg>
  )
}

function IconPdf({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox='0 0 24 24' fill='none' aria-hidden='true'>
      <rect width='24' height='24' rx='3' fill='#E53E3E' />
      <text x='3' y='17' fontSize='10' fontWeight='bold' fill='#fff' fontFamily='sans-serif'>PDF</text>
    </svg>
  )
}

function IconImage({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'>
      <rect x='3' y='3' width='18' height='18' rx='2' />
      <circle cx='9' cy='9' r='2' />
      <path d='m21 15-5-5L5 21' />
    </svg>
  )
}

export function AttachmentIcon({ att }: { att: Attachment }) {
  if (att.source === 'youtube') return <IconYouTube />
  if (att.source === 'form') return <IconForm />
  if (att.source === 'link') return <IconLink />
  // Drive — pick icon by MIME type
  const mime = att.content_type || ''
  if (mime === 'application/pdf') return <IconPdf />
  if (mime.startsWith('image/')) return <IconImage />
  return <IconDrive />
}

export function AttachmentView({ att }: { att: Attachment }) {
  const label = att.title || att.source

  // Non-Drive items: external link only.
  if (att.source !== 'drive') {
    return (
      <div className='flex items-center gap-2 rounded border p-2 text-sm'>
        <AttachmentIcon att={att} />
        <div className='min-w-0 flex-1'>
          {att.source_url ? (
            <a href={att.source_url} target='_blank' rel='noreferrer' className='text-primary truncate underline'>
              {label} ↗
            </a>
          ) : (
            <span className='truncate'>{label}</span>
          )}
        </div>
      </div>
    )
  }

  // Drive file not cached locally.
  if (att.fetch_status !== 'fetched' || !att.download_url) {
    const hint =
      att.fetch_status === 'skipped'
        ? 'Not downloaded (enable the Drive scope: re-run setup_google_auth.py).'
        : att.fetch_status === 'failed'
          ? 'Download failed during the last sync.'
          : 'Not yet downloaded.'
    return (
      <div className='rounded border p-2 text-sm'>
        <div className='flex items-center gap-2 font-medium'>
          <AttachmentIcon att={att} />
          <span className='truncate'>{label}</span>
        </div>
        <div className='text-muted-foreground mt-0.5 text-xs'>{hint}</div>
        {att.source_url && (
          <a href={att.source_url} target='_blank' rel='noreferrer' className='text-primary text-xs underline'>
            Open in Drive ↗
          </a>
        )}
      </div>
    )
  }

  const url = fileUrl(att.download_url)

  return (
    <div className='flex items-center justify-between gap-2 rounded border p-2 text-sm'>
      <div className='flex min-w-0 items-center gap-2'>
        <AttachmentIcon att={att} />
        <div className='min-w-0 flex-1'>
          <span className='truncate font-medium' title={label}>
            {label}
            {att.exported && <span className='text-muted-foreground ml-1 text-xs'>(exported)</span>}
          </span>
          <div className='mt-0.5 flex items-center gap-2'>
            {att.source_url && (
              <a href={att.source_url} target='_blank' rel='noreferrer' className='text-primary text-xs underline'>
                Open ↗
              </a>
            )}
            <a href={url} download className='text-primary text-xs underline'>
              Download{att.file_size ? ` (${formatBytes(att.file_size)})` : ''}
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
