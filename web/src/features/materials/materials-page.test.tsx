import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import type { MaterialList } from '@/lib/api'
import { MaterialsPage } from './materials-page'

const listMaterials = vi.fn()
const navigate = vi.fn()
const renderPdfThumbnail = vi.fn()
let splat: string | undefined
// A real 1×1 GIF: a picture that does not load falls back to the type icon.
const PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'

vi.mock('@/lib/api', () => ({
  api: { listMaterials: (path: string) => listMaterials(path) },
  fileUrl: (path: string) => `/api${path}`,
}))

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useParams: () => ({ _splat: splat }),
  useNavigate: () => navigate,
}))

vi.mock('./pdf-thumbnail', () => ({ renderPdfThumbnail: (url: string) => renderPdfThumbnail(url) }))

// The PDF viewer (WebAssembly) is not under test.
vi.mock('@/features/classroom/components/pdf-preview', () => ({
  usesBrowserViewer: () => false,
  PdfPreview: ({ title }: { title: string }) => <div role='dialog'>{title}</div>,
}))

// The top bar is not under test.
vi.mock('@/features/classroom/layout-header', () => ({ ClassroomHeader: () => null }))

const file = (
  name: string,
  path = name,
  content_type = 'application/pdf',
  created: string | null = null
) => ({ name, path, is_folder: false, size: 2048, created, modified: null, content_type })

function listing(path: string): MaterialList {
  if (path === 'Week 1') {
    return { storage: 'gdrive', path, items: [file('Notes.pdf', 'Week 1/Notes.pdf')], total: 1 }
  }
  const items = [
    { ...file('Week 1'), is_folder: true, size: null, content_type: null },
    ...Array.from({ length: 29 }, (_, i) => file(`f${String(i).padStart(2, '0')}.pdf`)),
  ]
  return { storage: 'gdrive', path, items, total: items.length }
}

describe('MaterialsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.removeItem('materials-view')
    localStorage.removeItem('materials-order')
    splat = undefined
    listMaterials.mockImplementation(async (path: string) => listing(path))
    renderPdfThumbnail.mockResolvedValue(PIXEL)
  })

  it('pages through the files and opens folders by URL', async () => {
    const screen = await render(<MaterialsPage />)

    await expect.element(screen.getByText('Week 1')).toBeVisible()
    await expect.element(screen.getByText('1-25')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }))
    await expect.element(screen.getByText('26-30')).toBeVisible()

    await userEvent.click(screen.getByRole('button', { name: 'Previous page' }))
    await userEvent.click(screen.getByText('Week 1'))
    expect(navigate).toHaveBeenLastCalledWith({ to: '/materials/$', params: { _splat: 'Week 1' } })
  })

  it('lists the folder in the URL and leads back up', async () => {
    splat = 'Week 1'
    const screen = await render(<MaterialsPage />)
    await expect.element(screen.getByText('Notes.pdf')).toBeVisible()
    expect(listMaterials).toHaveBeenCalledWith('Week 1')

    await userEvent.click(screen.getByRole('button', { name: 'Google Drive' }))
    expect(navigate).toHaveBeenLastCalledWith({ to: '/materials' })
  })

  it('opens a PDF in the viewer', async () => {
    splat = 'Week 1'
    const screen = await render(<MaterialsPage />)
    await userEvent.click(screen.getByText('Notes.pdf'))
    await expect.element(screen.getByRole('dialog')).toHaveTextContent('Notes.pdf')
  })

  it('shows thumbnails in the grid view and remembers it', async () => {
    listMaterials.mockResolvedValue({
      storage: 'gdrive', path: '', total: 2,
      items: [file('a.pdf'), file('b.png', 'b.png', 'image/png')],
    })
    const screen = await render(<MaterialsPage />)
    await userEvent.click(screen.getByRole('radio', { name: 'Grid' }))

    await vi.waitFor(() => expect(renderPdfThumbnail).toHaveBeenCalledWith('/api/materials/download?path=a.pdf'))
    const images = () => [...document.querySelectorAll('img')].map((i) => i.getAttribute('src'))
    await vi.waitFor(() => expect(images()).toContain(PIXEL))
    expect(localStorage.getItem('materials-view')).toBe('grid')
  })

  it('orders by creation date, newest first until switched', async () => {
    listMaterials.mockResolvedValue({
      storage: 'gdrive', path: '', total: 3,
      items: [
        file('old.pdf', 'old.pdf', 'application/pdf', '2026-01-01T00:00:00Z'),
        file('undated.pdf'),
        file('new.pdf', 'new.pdf', 'application/pdf', '2026-10-01T00:00:00Z'),
      ],
    })
    const screen = await render(<MaterialsPage />)
    const names = () =>
      [...document.querySelectorAll('span.truncate')].map((e) => e.textContent)
    await vi.waitFor(() => expect(names()).toEqual(['new.pdf', 'old.pdf', 'undated.pdf']))

    await userEvent.click(screen.getByRole('button', { name: 'Newest first' }))
    await vi.waitFor(() => expect(names()).toEqual(['old.pdf', 'new.pdf', 'undated.pdf']))
    await expect.element(screen.getByRole('button', { name: 'Oldest first' })).toBeVisible()
    expect(localStorage.getItem('materials-order')).toBe('asc')
  })

  it('explains when files stay on the server', async () => {
    listMaterials.mockResolvedValue({ storage: 'local', path: '', items: [], total: 0 })
    const screen = await render(<MaterialsPage />)
    await expect.element(screen.getByText(/Connect Google again/)).toBeVisible()
  })
})
