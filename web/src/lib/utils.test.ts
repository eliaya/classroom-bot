import { describe, expect, it } from 'vitest'
import { fullTimestamp, getPageNumbers, humanReadableTime } from './utils'

describe('getPageNumbers', () => {
  it('returns all pages when total is at most 5', () => {
    expect(getPageNumbers(1, 3)).toEqual([1, 2, 3])
    expect(getPageNumbers(3, 5)).toEqual([1, 2, 3, 4, 5])
  })

  it('shows ellipsis near the beginning', () => {
    expect(getPageNumbers(1, 10)).toEqual([1, 2, 3, 4, '...', 10])
    expect(getPageNumbers(3, 10)).toEqual([1, 2, 3, 4, '...', 10])
  })

  it('shows ellipsis near the end', () => {
    expect(getPageNumbers(10, 10)).toEqual([1, '...', 7, 8, 9, 10])
    expect(getPageNumbers(9, 10)).toEqual([1, '...', 7, 8, 9, 10])
  })

  it('shows ellipsis on both side in the middle', () => {
    expect(getPageNumbers(5, 10)).toEqual([1, '...', 4, 5, 6, '...', 10])
  })

  it('handles current page greater than total pages', () => {
    expect(getPageNumbers(6, 5)).toEqual([1, 2, 3, 4, 5])
    expect(getPageNumbers(11, 10)).toEqual([1, '...', 7, 8, 9, 10])
  })
})

describe('humanReadableTime', () => {
  it('returns a relative string with suffix for a past date', () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000)
    expect(humanReadableTime(threeHoursAgo)).toMatch(/3 hours ago$/)
  })

  it('accepts ISO strings', () => {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    expect(humanReadableTime(oneDayAgo)).toMatch(/1 day ago$/)
  })

  it('returns the empty label for missing or invalid values', () => {
    expect(humanReadableTime(null)).toBe('—')
    expect(humanReadableTime(undefined)).toBe('—')
    expect(humanReadableTime('')).toBe('—')
    expect(humanReadableTime('not-a-date')).toBe('—')
    expect(humanReadableTime(null, 'Never')).toBe('Never')
  })
})

describe('fullTimestamp', () => {
  it('formats a valid date into a non-empty locale string', () => {
    const out = fullTimestamp('2026-06-14T09:45:00Z')
    expect(out).not.toBe('')
    expect(out).toMatch(/2026/)
  })

  it('returns an empty string for missing or invalid values', () => {
    expect(fullTimestamp(null)).toBe('')
    expect(fullTimestamp('nope')).toBe('')
  })
})
