import { lazy, Suspense } from 'react'
import wasmUrl from '@embedpdf/pdfium/pdfium.wasm?url'
import type { EmbedPdfContainer } from '@embedpdf/react-pdf-viewer'
import { useTranslation } from 'react-i18next'
import { useTheme } from '@/context/theme-provider'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'

// The viewer (PDFium compiled to WebAssembly) loads only when a PDF is opened.
const PDFViewer = lazy(() =>
  import('@embedpdf/react-pdf-viewer').then((m) => ({ default: m.PDFViewer }))
)

// Per-device choice: open PDFs in the browser's own viewer instead of EmbedPDF.
const BROWSER_KEY = 'pdf-viewer-browser'
export const usesBrowserViewer = () => {
  try {
    return localStorage.getItem(BROWSER_KEY) === '1'
  } catch {
    return false
  }
}
export const setBrowserViewer = (on: boolean) => {
  try {
    localStorage.setItem(BROWSER_KEY, on ? '1' : '0')
  } catch {
    // private mode: keep the default
  }
}

/** The dialog's scroll lock cannot see the scrollable pages inside the
 * viewer's shadow DOM and cancels every wheel event that reaches the
 * document: keep them inside the viewer. */
const keepWheel = (viewer: EmbedPdfContainer) => {
  const stop = (e: Event) => e.stopPropagation()
  viewer.parentElement?.addEventListener('wheel', stop)
  viewer.parentElement?.addEventListener('touchmove', stop)
}

/** A PDF shown in the page with EmbedPDF (zoom, search, thumbnails, print, download). */
export function PdfPreview({
  url,
  title,
  open,
  onOpenChange,
}: {
  url: string
  title: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { i18n } = useTranslation()
  const { resolvedTheme } = useTheme()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='flex h-[90dvh] max-w-[calc(100%-2rem)] flex-col gap-2 p-3 pt-10 sm:max-w-5xl'>
        <DialogTitle className='absolute top-3 left-4 max-w-[calc(100%-4rem)] truncate text-sm'>
          {title}
        </DialogTitle>
        <DialogDescription className='sr-only'>{title}</DialogDescription>
        <Suspense fallback={null}>
          <PDFViewer
            onInit={keepWheel}
            className='min-h-0 flex-1 overflow-hidden rounded-md border'
            config={{
              // Absolute: the viewer fetches it from a worker.
              src: new URL(url, window.location.href).href,
              // Served with the app instead of from a CDN.
              wasmUrl: new URL(wasmUrl, window.location.href).href,
              theme: { preference: resolvedTheme },
              i18n: { defaultLocale: i18n.language },
              // A viewer: posted files are read, not edited.
              disabledCategories: ['annotation', 'redaction'],
            }}
          />
        </Suspense>
      </DialogContent>
    </Dialog>
  )
}
