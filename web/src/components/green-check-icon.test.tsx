import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { GreenCheckIcon } from './green-check-icon'

describe('GreenCheckIcon', () => {
  it('renders an SVG with an accessible name', async () => {
    const screen = await render(<GreenCheckIcon label='Valid' />)
    await expect
      .element(screen.getByRole('img', { name: 'Valid' }))
      .toBeInTheDocument()
  })

  it('uses the success-green token class', async () => {
    const screen = await render(<GreenCheckIcon label='Valid' />)
    const svg = screen.getByRole('img', { name: 'Valid' }).element()
    expect(svg.classList.contains('text-green-success')).toBe(true)
  })
})
