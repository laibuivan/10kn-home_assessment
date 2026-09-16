import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import ActionsMenu, { type ActionsMenuItem } from '../ActionsMenu.vue'

function mountMenu(items: ActionsMenuItem[]) {
  return mount(ActionsMenu, { props: { items } })
}

describe('ActionsMenu', () => {
  it('is closed by default and opens the menu on trigger click', async () => {
    const wrapper = mountMenu([{ key: 'edit', label: 'Sửa', onClick: vi.fn() }])

    expect(wrapper.find('.dropdown-menu').classes()).not.toContain('open')

    await wrapper.find('[data-testid=actions-menu-trigger]').trigger('click')

    expect(wrapper.find('.dropdown-menu').classes()).toContain('open')
  })

  it('calls the item onClick and closes the menu', async () => {
    const onClick = vi.fn()
    const wrapper = mountMenu([{ key: 'view', label: 'Xem chi tiết', onClick, testId: 'device-action-view' }])

    await wrapper.find('[data-testid=actions-menu-trigger]').trigger('click')
    await wrapper.find('[data-testid=device-action-view]').trigger('click')

    expect(onClick).toHaveBeenCalledTimes(1)
    expect(wrapper.find('.dropdown-menu').classes()).not.toContain('open')
  })

  it('does not call onClick for a disabled item and shows the tooltip title', async () => {
    const onClick = vi.fn()
    const wrapper = mountMenu([
      { key: 'edit', label: 'Sửa', onClick, disabled: true, disabledTitle: 'Thiết bị đã retired, không thể sửa', testId: 'device-action-edit' },
    ])

    await wrapper.find('[data-testid=actions-menu-trigger]').trigger('click')
    const item = wrapper.find('[data-testid=device-action-edit]')
    expect(item.attributes('disabled')).toBeDefined()

    await item.trigger('click')
    expect(onClick).not.toHaveBeenCalled()

    expect(wrapper.find('[data-testid=device-action-edit-tooltip]').attributes('title')).toBe(
      'Thiết bị đã retired, không thể sửa',
    )
  })

  it('closes on outside click', async () => {
    const wrapper = mount(ActionsMenu, {
      attachTo: document.body,
      props: { items: [{ key: 'edit', label: 'Sửa', onClick: vi.fn() }] },
    })
    await wrapper.find('[data-testid=actions-menu-trigger]').trigger('click')
    expect(wrapper.find('.dropdown-menu').classes()).toContain('open')

    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.dropdown-menu').classes()).not.toContain('open')
    wrapper.unmount()
  })

  it('closes on Escape', async () => {
    const wrapper = mountMenu([{ key: 'edit', label: 'Sửa', onClick: vi.fn() }])
    await wrapper.find('[data-testid=actions-menu-trigger]').trigger('click')

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.dropdown-menu').classes()).not.toContain('open')
  })
})
