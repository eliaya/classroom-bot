import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'
import '@/lib/i18n'
import '@/styles/index.css'
import { ThemeProvider } from '@/context/theme-provider'
import { type Attachment } from '@/lib/api'
import { AttachmentView } from './attachment-view'
import { PdfPreview, setBrowserViewer } from './pdf-preview'

/** A one-page PDF, built with correct xref offsets. */
function onePagePdf(): string {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    '<< /Length 44 >>\nstream\nBT /F1 24 Tf 40 100 Td (Hello PDF) Tj ET\nendstream',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let body = '%PDF-1.4\n'
  const offsets = objects.map((obj, i) => {
    const at = body.length
    body += `${i + 1} 0 obj\n${obj}\nendobj\n`
    return at
  })
  const xref = body.length
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  body += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return URL.createObjectURL(new Blob([body], { type: 'application/pdf' }))
}

describe('PdfPreview', () => {
  it('offers a preview for PDFs only', async () => {
    const pdf: Attachment = {
      id: 1, source: 'drive', title: 'Week 5.pdf', content_type: 'application/pdf',
      fetch_status: 'fetched', download_url: '/courses/c1/attachments/1/download',
    }
    const xlsx: Attachment = { ...pdf, id: 2, title: 'Grades.xlsx', content_type: 'application/vnd.ms-excel' }
    render(
      <ThemeProvider>
        <AttachmentView att={pdf} />
        <AttachmentView att={xlsx} />
      </ThemeProvider>
    )
    await expect.element(page.getByRole('button', { name: 'Preview' })).toBeVisible()
    expect(page.getByRole('button', { name: 'Preview' }).elements()).toHaveLength(1)
  })

  it('opens the browser viewer instead when the setting says so', async () => {
    const pdf: Attachment = {
      id: 1, source: 'drive', title: 'Week 5.pdf', content_type: 'application/pdf',
      fetch_status: 'fetched', download_url: '/courses/c1/attachments/1/download',
    }
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    setBrowserViewer(true)
    try {
      render(
        <ThemeProvider>
          <AttachmentView att={pdf} />
        </ThemeProvider>
      )
      await page.getByRole('button', { name: 'Preview' }).click()
      expect(open).toHaveBeenCalledWith('/api/courses/c1/attachments/1/download', '_blank', 'noopener')
      expect(document.querySelector('[role="dialog"]')).toBeNull()
    } finally {
      setBrowserViewer(false)
      open.mockRestore()
    }
  })

  it('renders the document in the page', async () => {
    await page.viewport(1280, 900)
    render(
      <ThemeProvider>
        <PdfPreview url={onePagePdf()} title='Week 5.pdf' open onOpenChange={() => undefined} />
      </ThemeProvider>
    )
    await expect.element(page.getByRole('dialog')).toHaveTextContent('Week 5.pdf')
    // The viewer draws pages into its shadow DOM as images once PDFium has loaded.
    await expect
      .poll(
        () => {
          const host = document.querySelector('[role="dialog"] embedpdf-container')
          return host?.shadowRoot?.querySelectorAll('img').length ?? 0
        },
        { timeout: 20_000 }
      )
      .toBeGreaterThan(0)

    // The mouse wheel scrolls the pages; the dialog still locks the page behind.
    const host = document.querySelector('[role="dialog"] embedpdf-container')!
    const inside = new WheelEvent('wheel', { deltaY: 100, bubbles: true, composed: true, cancelable: true })
    host.shadowRoot!.querySelector('img')!.dispatchEvent(inside)
    expect(inside.defaultPrevented).toBe(false)
    const outside = new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true })
    page.getByRole('dialog').element().dispatchEvent(outside)
    expect(outside.defaultPrevented).toBe(true)
  })
})
