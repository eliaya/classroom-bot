import { describe, expect, it } from 'vitest'
import { areaOf } from './area'

describe('areaOf', () => {
  it('puts /admin and everything under it in the admin area', () => {
    expect(areaOf('/admin')).toBe('/admin')
    expect(areaOf('/admin/')).toBe('/admin')
    expect(areaOf('/admin/courses/1/stream')).toBe('/admin')
  })

  it('leaves every other path in the root area', () => {
    expect(areaOf('/')).toBe('')
    expect(areaOf('/courses')).toBe('')
    expect(areaOf('/administrators')).toBe('')
  })
})
