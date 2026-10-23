import wasmUrl from '@embedpdf/pdfium/pdfium.wasm?url'

type Engine = Awaited<
  ReturnType<typeof import('@embedpdf/engines/pdfium-direct-engine').createPdfiumEngine>
>

// One PDFium for every thumbnail, loaded only when the first PDF scrolls into view.
// shortcut: renders on the main thread; use the worker engine if big grids jank.
let engine: Promise<Engine> | null = null
const getEngine = () =>
  (engine ??= import('@embedpdf/engines/pdfium-direct-engine').then((m) =>
    m.createPdfiumEngine(new URL(wasmUrl, window.location.href).href, { fontFallback: null })
  ))

/** An object URL of the first page of the PDF at `url`; revoke it when done. */
export async function renderPdfThumbnail(url: string): Promise<string> {
  const [pdf, content] = await Promise.all([
    getEngine(),
    fetch(url).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.arrayBuffer()
    }),
  ])
  const doc = await pdf.openDocumentBuffer({ id: url, content }).toPromise()
  try {
    const blob = await pdf
      .renderThumbnail(doc, doc.pages[0], { scaleFactor: 0.5, imageType: 'image/webp' })
      .toPromise()
    return URL.createObjectURL(blob)
  } finally {
    await pdf.closeDocument(doc).toPromise()
  }
}
