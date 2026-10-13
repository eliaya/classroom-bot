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

  it('keeps the wildcard out of the pages users have for their own data', () => {
    for (const key of ['courses:view', 'todos:view', 'sync:use', 'links:use', 'bot:view']) {
      expect(can(['*'], key)).toBe(false)
      expect(can(['*', key], key)).toBe(true)
    }
    for (const path of ['/courses/1/stream', '/calendar', '/sync', '/bot', '/settings/opencloud']) {
      expect(canOpen(['*'], path)).toBe(false)
    }
    expect(canOpen(['*'], '/settings/users')).toBe(true)
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

  it('keeps the setup guide for administrators', () => {
    expect(canOpen(['*'], '/settings/setup')).toBe(true)
    expect(canOpen(['courses:view', 'sync:use'], '/settings/setup')).toBe(false)
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

  it('leaves the wildcard the pages that are not a user\'s own', () => {
    const nav = visibleNav(groups, ['*'])
    expect(nav).toHaveLength(1)
    expect(nav[0].items.map((i) => i.title)).toEqual(['dashboard', 'audit'])
  })
})
