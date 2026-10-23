import { describe, expect, it } from 'vitest'
import { renderPdfThumbnail } from './pdf-thumbnail'

// A one-page PDF (PDFium repairs the missing cross-reference table).
const PDF = [
  '%PDF-1.4',
  '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj',
  '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj',
  '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]>>endobj',
  'trailer<</Root 1 0 R>>',
  '%%EOF',
].join('\n')

describe('renderPdfThumbnail', () => {
  it('draws the first page as an image', async () => {
    const src = URL.createObjectURL(new Blob([PDF], { type: 'application/pdf' }))
    const thumb = await renderPdfThumbnail(src)
    const img = new Image()
    img.src = thumb
    await img.decode()
    expect(img.naturalWidth).toBeGreaterThan(img.naturalHeight)
    URL.revokeObjectURL(thumb)
  })
})
