import { describe, expect, it } from 'vitest'
import { formatMailDate, initials } from './mail-utils'

const HOUR = 3_600_000

describe('mail helpers', () => {
  it('formats initials and dates', () => {
    expect(initials('Sarah Johnson')).toBe('SJ')
    expect(initials('bob@example.com')).toBe('BO')
    const now = new Date(2026, 9, 18, 12).getTime()
    expect(formatMailDate(now - 2 * HOUR, 'en', now)).toBe('2 hours ago')
    expect(formatMailDate(new Date(2026, 9, 17, 9).getTime(), 'en', now)).toBe('yesterday')
    expect(formatMailDate(new Date(2026, 9, 11, 9).getTime(), 'en', now)).toBe('Oct 11')
  })
})
