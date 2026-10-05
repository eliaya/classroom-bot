import { describe, expect, it } from 'vitest'
import { type NavGroup } from '@/components/layout/types'
import { can, canOpen, requiredPermissions, visibleNav } from './permissions'

describe('can', () => {
  it('matches an exact key, and the wildcard matches everything', () => {
    expect(can(['sync:view'], 'sync:view')).toBe(true)
    expect(can(['sync:view'], 'sync:use')).toBe(false)
    expect(can([], 'sync:view')).toBe(false)
    expect(can(['*'], 'backup:use')).toBe(true)
  })
})

describe('requiredPermissions', () => {
  it('maps a page and everything under it to its module', () => {
    expect(requiredPermissions('/courses')).toEqual(['courses:view'])
    expect(requiredPermissions('/courses/1/stream')).toEqual(['courses:view'])
    expect(requiredPermissions('/search?q=x')).toEqual(['search:view'])
    expect(requiredPermissions('/settings/roles')).toEqual(['users:view'])
  })

  it('needs nothing for pages open to every approved user', () => {
    expect(requiredPermissions('/')).toBeNull()
    expect(requiredPermissions('/settings')).toBeNull()
    expect(requiredPermissions('/settings/language')).toBeNull()
  })

  it('matches whole path segments only', () => {
    expect(requiredPermissions('/courseship')).toBeNull()
    expect(requiredPermissions('/synced')).toBeNull()
  })
})

describe('canOpen', () => {
  it('opens the bot page with either of its two modules', () => {
    expect(canOpen(['links:view'], '/bot')).toBe(true)
    expect(canOpen(['bot:view'], '/bot')).toBe(true)
    expect(canOpen(['courses:view'], '/bot')).toBe(false)
  })

  it('does not treat :use as :view', () => {
    expect(canOpen(['sync:use'], '/sync')).toBe(false)
  })
})

describe('visibleNav', () => {
  const groups: NavGroup[] = [
    {
      title: 'general',
      items: [
        { title: 'dashboard', url: '/' },
        { title: 'courses', url: '/courses' },
        { title: 'audit', url: '/audit' },
      ],
    },
    { title: 'admin', items: [{ title: 'sync', url: '/sync' }] },
  ]

  it('drops pages the user may not open, and groups left empty', () => {
    const nav = visibleNav(groups, ['courses:view'])
    expect(nav).toHaveLength(1)
    expect(nav[0].items.map((i) => i.title)).toEqual(['dashboard', 'courses'])
  })

  it('keeps everything for the wildcard', () => {
    expect(visibleNav(groups, ['*'])).toEqual(groups)
  })
})
