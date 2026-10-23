import '@/styles/index.css'
import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'
import { api, type Tag } from '@/lib/api'
import '@/lib/i18n'
import { TagPicker } from './tag-picker'

let TAGS: Tag[] = [
  { id: 1, name: 'React', count: 1 },
  { id: 2, name: 'TypeScript', count: 1 },
  { id: 3, name: 'Next.js', count: 0 },
]

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      listTags: vi.fn(async () => ({ items: TAGS, total: TAGS.length })),
      getAssignedTags: vi.fn(async (target: string) => ({
        target,
        tag_ids: [1, 2],
      })),
      setAssignedTags: vi.fn(async (target: string, tag_ids: number[]) => ({
        target,
        tag_ids,
      })),
      createTag: vi.fn(async (name: string) => {
        const tag = { id: 4, name, count: 0 }
        TAGS = [...TAGS, tag]
        return tag
      }),
    },
  }
})

describe('TagPicker', () => {
  it('shows the tags on its target, removes, adds and creates them', async () => {
    await page.viewport(668, 501)
    const screen = await render(
      <div className='flex min-h-svh items-center justify-center p-4'>
        <TagPicker target='page:/mail' className='max-w-[400px]' />
      </div>
    )
    const trigger = screen.getByRole('combobox', { name: 'Tags' })
    await expect
      .element(trigger)
      .toHaveTextContent('ReactTypeScriptSelect a tag...')

    await trigger.click()
    await expect
      .element(screen.getByRole('option', { name: 'Next.js' }))
      .toBeVisible()

    // Choosing an unselected tag adds it to the target.
    await screen.getByRole('option', { name: 'Next.js' }).click()
    expect(api.setAssignedTags).toHaveBeenLastCalledWith(
      'page:/mail',
      [1, 2, 3]
    )

    // A name no tag has offers to create it, and puts it on the target.
    await userEvent.type(screen.getByPlaceholder('Search tag...'), 'Vue')
    await screen.getByRole('option', { name: 'Create new tag: Vue' }).click()
    expect(api.createTag).toHaveBeenCalledWith('Vue')
    expect(api.setAssignedTags).toHaveBeenLastCalledWith(
      'page:/mail',
      [1, 2, 3, 4]
    )
    await userEvent.keyboard('{Escape}')
    await expect
      .element(trigger)
      .toHaveTextContent('ReactTypeScriptNext.jsVueSelect a tag...')
  })
})
