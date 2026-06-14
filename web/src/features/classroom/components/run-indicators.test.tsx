import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { RowActionButton, RunProgressBar, RunStatusBadge } from './run-indicators'

describe('RunProgressBar', () => {
  it('adds .progress--complete when progress is 100%', async () => {
    const screen = await render(<RunProgressBar percent={100} />)
    await expect
      .element(screen.getByTestId('progress-bar'))
      .toHaveClass('progress--complete')
  })

  it('does not add .progress--complete below 100%', async () => {
    const screen = await render(<RunProgressBar percent={50} />)
    const bar = screen.getByTestId('progress-bar').element()
    expect(bar.classList.contains('progress--complete')).toBe(false)
  })
})

describe('RunStatusBadge', () => {
  it('uses .status--success for a success run', async () => {
    const screen = await render(<RunStatusBadge status='success' />)
    const badge = screen.getByText('success').element()
    expect(badge.classList.contains('status--success')).toBe(true)
  })

  it('does not use .status--success for non-success runs', async () => {
    const screen = await render(<RunStatusBadge status='error' />)
    const badge = screen.getByText('error').element()
    expect(badge.classList.contains('status--success')).toBe(false)
  })
})

describe('RowActionButton (accessibility)', () => {
  it('renders a focusable button with an accessible name', async () => {
    const onClick = vi.fn()
    const screen = await render(<RowActionButton label='Clear' onClick={onClick} />)
    const locator = screen.getByRole('button', { name: 'Clear' })
    await expect.element(locator).toBeInTheDocument()

    // Keyboard-reachable: it is a real <button> that can receive focus.
    const el = locator.element() as HTMLButtonElement
    expect(el.tagName).toBe('BUTTON')
    el.focus()
    expect(document.activeElement).toBe(el)
  })
})
