import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import ConfirmModal from '../ConfirmModal.vue'

const TITLE = 'Xóa group?'
const MESSAGE =
  'Xóa group "Sales Team" sẽ gỡ toàn bộ liên kết của group này với device và policy đang gán. ' +
  'Thiết bị và policy không bị xóa. Hành động không thể hoàn tác.'

function mountModal(overrides: Record<string, unknown> = {}) {
  return mount(ConfirmModal, {
    attachTo: document.body,
    props: {
      title: TITLE,
      message: MESSAGE,
      confirmLabel: 'Xóa',
      destructive: true,
      onConfirm: vi.fn(),
      testId: 'confirm-modal',
      confirmTestId: 'confirm-modal-confirm',
      cancelTestId: 'confirm-modal-cancel',
      ...overrides,
    },
  })
}

/** A promise whose settling this test controls, to observe the in-flight state. */
function deferred<T = void>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('ConfirmModal', () => {
  it('renders the title, message and labels', () => {
    const wrapper = mountModal()

    expect(wrapper.find('h3').text()).toBe(TITLE)
    expect(wrapper.find('p').text()).toBe(MESSAGE)
    expect(wrapper.find('[data-testid=confirm-modal-confirm]').text()).toContain('Xóa')
    expect(wrapper.find('[data-testid=confirm-modal-cancel]').text()).toContain('Hủy')
    wrapper.unmount()
  })

  it('uses the danger style when destructive, the primary style otherwise', () => {
    const danger = mountModal()
    expect(danger.find('[data-testid=confirm-modal-confirm]').classes()).toContain('btn-danger')
    danger.unmount()

    const neutral = mountModal({ destructive: false })
    expect(neutral.find('[data-testid=confirm-modal-confirm]').classes()).toContain('btn-primary')
    neutral.unmount()
  })

  it('is an accessible dialog labelled by its own heading', () => {
    const wrapper = mountModal()
    const backdrop = wrapper.find('[data-testid=confirm-modal]')

    expect(backdrop.attributes('role')).toBe('dialog')
    expect(backdrop.attributes('aria-modal')).toBe('true')
    expect(backdrop.attributes('aria-labelledby')).toBe(wrapper.find('h3').attributes('id'))
    wrapper.unmount()
  })

  it('focuses the cancel button on mount (a stray Enter must not delete)', () => {
    const wrapper = mountModal()

    expect(document.activeElement).toBe(wrapper.find('[data-testid=confirm-modal-cancel]').element)
    wrapper.unmount()
  })

  it('calls onConfirm once on click', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined)
    const wrapper = mountModal({ onConfirm })

    await wrapper.find('[data-testid=confirm-modal-confirm]').trigger('click')
    await flushPromises()

    expect(onConfirm).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('sends only one request when the confirm button is clicked twice in a row (A24)', async () => {
    const pending = deferred()
    const onConfirm = vi.fn().mockReturnValue(pending.promise)
    const wrapper = mountModal({ onConfirm })
    const confirm = wrapper.find('[data-testid=confirm-modal-confirm]')

    await confirm.trigger('click')
    await confirm.trigger('click')

    expect(onConfirm).toHaveBeenCalledTimes(1)

    pending.resolve()
    await flushPromises()
    wrapper.unmount()
  })

  it('disables both buttons and marks the confirm button busy while running', async () => {
    const pending = deferred()
    const wrapper = mountModal({ onConfirm: () => pending.promise })

    await wrapper.find('[data-testid=confirm-modal-confirm]').trigger('click')

    const confirm = wrapper.find('[data-testid=confirm-modal-confirm]')
    const cancel = wrapper.find('[data-testid=confirm-modal-cancel]')
    expect(confirm.attributes('disabled')).toBeDefined()
    expect(confirm.attributes('data-busy')).toBe('true')
    expect(cancel.attributes('disabled')).toBeDefined()

    pending.resolve()
    await flushPromises()

    expect(wrapper.find('[data-testid=confirm-modal-confirm]').attributes('disabled')).toBeUndefined()
    expect(wrapper.find('[data-testid=confirm-modal-cancel]').attributes('disabled')).toBeUndefined()
    wrapper.unmount()
  })

  it('cannot be dismissed while the action is in flight (Escape / backdrop / Hủy)', async () => {
    const pending = deferred()
    const wrapper = mountModal({ onConfirm: () => pending.promise })

    await wrapper.find('[data-testid=confirm-modal-confirm]').trigger('click')

    await wrapper.find('[data-testid=confirm-modal-cancel]').trigger('click')
    await wrapper.find('[data-testid=confirm-modal]').trigger('click')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()

    expect(wrapper.emitted('cancel')).toBeUndefined()

    pending.resolve()
    await flushPromises()
    wrapper.unmount()
  })

  it('never closes itself — the parent owns that (resolve and reject alike)', async () => {
    const wrapper = mountModal({ onConfirm: vi.fn().mockResolvedValue(undefined) })

    await wrapper.find('[data-testid=confirm-modal-confirm]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid=confirm-modal]').exists()).toBe(true)
    wrapper.unmount()

    const failing = mountModal({ onConfirm: vi.fn().mockRejectedValue(new Error('500')) })
    await failing.find('[data-testid=confirm-modal-confirm]').trigger('click')
    await flushPromises()

    expect(failing.find('[data-testid=confirm-modal]').exists()).toBe(true)
    failing.unmount()
  })

  it('emits `error` instead of leaking an unhandled rejection when onConfirm rejects', async () => {
    const failure = { response: { status: 500, data: {} } }
    const wrapper = mountModal({ onConfirm: vi.fn().mockRejectedValue(failure) })

    await wrapper.find('[data-testid=confirm-modal-confirm]').trigger('click')
    await flushPromises()

    expect(wrapper.emitted('error')).toHaveLength(1)
    expect(wrapper.emitted('error')![0]).toEqual([failure])
    // And it is runnable again (the user can retry — A13).
    expect(wrapper.find('[data-testid=confirm-modal-confirm]').attributes('disabled')).toBeUndefined()
    wrapper.unmount()
  })

  it('emits `cancel` from the Hủy button, the backdrop and Escape while idle', async () => {
    const onConfirm = vi.fn()

    const byButton = mountModal({ onConfirm })
    await byButton.find('[data-testid=confirm-modal-cancel]').trigger('click')
    expect(byButton.emitted('cancel')).toHaveLength(1)
    byButton.unmount()

    const byBackdrop = mountModal({ onConfirm })
    await byBackdrop.find('[data-testid=confirm-modal]').trigger('click')
    expect(byBackdrop.emitted('cancel')).toHaveLength(1)
    byBackdrop.unmount()

    const byEscape = mountModal({ onConfirm })
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(byEscape.emitted('cancel')).toHaveLength(1)
    byEscape.unmount()

    expect(onConfirm).not.toHaveBeenCalled()
  })
})
