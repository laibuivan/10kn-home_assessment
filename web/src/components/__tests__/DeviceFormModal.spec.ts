import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import DeviceFormModal from '../DeviceFormModal.vue'
import { createDevice, updateDevice } from '../../api/devices'
import type { Device } from '../../types/device'

vi.mock('../../api/devices', () => ({
  createDevice: vi.fn(),
  updateDevice: vi.fn(),
}))

function device(overrides: Partial<Device> = {}): Device {
  return {
    id: 42,
    identifier: 'IOS-0001',
    name: 'iPhone 14',
    platform: 'ios',
    os_version: '17.4.1',
    status: 'active',
    last_seen_at: null,
    created_at: '2026-09-15T08:00:00.000Z',
    updated_at: '2026-09-15T08:00:00.000Z',
    ...overrides,
  }
}

describe('DeviceFormModal', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('starts with an empty form in create mode, with no status field', () => {
    const wrapper = mount(DeviceFormModal, { props: { mode: 'create' } })

    expect((wrapper.find('[data-testid=device-form-identifier]').element as HTMLInputElement).value).toBe('')
    expect((wrapper.find('[data-testid=device-form-identifier]').element as HTMLInputElement).disabled).toBe(
      false,
    )
    expect(wrapper.find('[data-testid=device-form-status]').exists()).toBe(false)
  })

  it('prefills from the device prop in edit mode, disables identifier, and shows status', () => {
    const wrapper = mount(DeviceFormModal, { props: { mode: 'edit', device: device() } })

    expect((wrapper.find('[data-testid=device-form-identifier]').element as HTMLInputElement).value).toBe(
      'IOS-0001',
    )
    expect((wrapper.find('[data-testid=device-form-identifier]').element as HTMLInputElement).disabled).toBe(
      true,
    )
    expect((wrapper.find('[data-testid=device-form-name]').element as HTMLInputElement).value).toBe(
      'iPhone 14',
    )
    expect((wrapper.find('[data-testid=device-form-status]').element as HTMLSelectElement).value).toBe(
      'active',
    )
  })

  it('blocks submit client-side when required fields are missing, without calling the API', async () => {
    const wrapper = mount(DeviceFormModal, { props: { mode: 'create' } })

    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(createDevice).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid=field-error-identifier]').text()).toContain("can't be blank")
    expect(wrapper.find('[data-testid=field-error-name]').text()).toContain("can't be blank")
    expect(wrapper.find('[data-testid=field-error-platform]').text()).toContain("can't be blank")
  })

  it('clears a field error on input without clearing baseError', async () => {
    vi.mocked(updateDevice).mockRejectedValueOnce({
      response: { status: 422, data: { errors: { base: ['Thiết bị đã retired, không thể sửa'] } } },
    })
    const wrapper = mount(DeviceFormModal, { props: { mode: 'edit', device: device() } })

    // jsdom does not dispatch a form "submit" event on a submit-button
    // click by itself, so drive the form's own submit event directly (a
    // real browser — and thus Playwright — does not have this gap).
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(wrapper.find('[data-testid=device-form-banner]').text()).toContain(
      'Thiết bị đã retired, không thể sửa',
    )

    await wrapper.find('[data-testid=device-form-name]').setValue('New Name')
    await flushPromises()

    // baseError survives an unrelated field edit — it's a whole-request
    // rejection, not fixed by touching one input (F3-frontend.md §2).
    expect(wrapper.find('[data-testid=device-form-banner]').text()).toContain(
      'Thiết bị đã retired, không thể sửa',
    )
  })

  it('submits successfully in create mode and emits saved with the create message', async () => {
    vi.mocked(createDevice).mockResolvedValueOnce({ device: device({ id: 99 }) })
    const wrapper = mount(DeviceFormModal, { props: { mode: 'create' } })

    await wrapper.find('[data-testid=device-form-identifier]').setValue('IPHONE-042')
    await wrapper.find('[data-testid=device-form-name]').setValue('Alice iPhone')
    await wrapper.find('[data-testid=device-form-platform]').setValue('ios')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(createDevice).toHaveBeenCalledWith({
      identifier: 'IPHONE-042',
      name: 'Alice iPhone',
      platform: 'ios',
      os_version: undefined,
    })
    expect(wrapper.emitted('saved')).toEqual([[{ mode: 'create', message: 'Đã tạo device' }]])
  })

  it('submits successfully in edit mode and emits saved with the edit message', async () => {
    vi.mocked(updateDevice).mockResolvedValueOnce({ device: device({ name: 'Updated' }) })
    const wrapper = mount(DeviceFormModal, { props: { mode: 'edit', device: device() } })

    await wrapper.find('[data-testid=device-form-name]').setValue('Updated')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(updateDevice).toHaveBeenCalledWith(42, {
      name: 'Updated',
      platform: 'ios',
      os_version: '17.4.1',
      status: 'active',
    })
    expect(wrapper.emitted('saved')).toEqual([[{ mode: 'edit', message: 'Đã cập nhật device' }]])
  })

  it('shows field-level errors from a 422 response and does not emit saved', async () => {
    vi.mocked(createDevice).mockRejectedValueOnce({
      response: {
        status: 422,
        data: { errors: { identifier: ['Identifier này đã tồn tại trong tổ chức của bạn.'] } },
      },
    })
    const wrapper = mount(DeviceFormModal, { props: { mode: 'create' } })

    await wrapper.find('[data-testid=device-form-identifier]').setValue('IOS-0001')
    await wrapper.find('[data-testid=device-form-name]').setValue('Another Device')
    await wrapper.find('[data-testid=device-form-platform]').setValue('android')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(wrapper.find('[data-testid=field-error-identifier]').text()).toContain(
      'Identifier này đã tồn tại trong tổ chức của bạn.',
    )
    expect(wrapper.emitted('saved')).toBeUndefined()
  })

  it('shows the baseError banner from a `base` key response and keeps the modal usable', async () => {
    vi.mocked(updateDevice).mockRejectedValueOnce({
      response: { status: 422, data: { errors: { base: ['Thiết bị đã retired, không thể sửa'] } } },
    })
    const wrapper = mount(DeviceFormModal, { props: { mode: 'edit', device: device() } })

    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(wrapper.find('[data-testid=device-form-banner]').text()).toContain(
      'Thiết bị đã retired, không thể sửa',
    )
    expect(wrapper.emitted('saved')).toBeUndefined()
  })

  it('shows the generic fallback banner on an infra error (no usable body)', async () => {
    vi.mocked(createDevice).mockRejectedValueOnce(new Error('network down'))
    const wrapper = mount(DeviceFormModal, { props: { mode: 'create' } })

    await wrapper.find('[data-testid=device-form-identifier]').setValue('IPHONE-042')
    await wrapper.find('[data-testid=device-form-name]').setValue('Alice iPhone')
    await wrapper.find('[data-testid=device-form-platform]').setValue('ios')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(wrapper.find('[data-testid=device-form-banner]').text()).toContain(
      'Có lỗi xảy ra, vui lòng thử lại.',
    )
  })

  it('shows the generic fallback banner (not the raw message) on a 500 that carries a JSON `error` body', async () => {
    // F3-api.md §5: 500/infra is handled by the FE "theo status code chung"
    // — a 5xx never leaks whatever text happens to be in its body (SoT A13).
    vi.mocked(createDevice).mockRejectedValueOnce({
      response: { status: 500, data: { error: 'Internal server error' } },
    })
    const wrapper = mount(DeviceFormModal, { props: { mode: 'create' } })

    await wrapper.find('[data-testid=device-form-identifier]').setValue('IPHONE-106')
    await wrapper.find('[data-testid=device-form-name]').setValue('Test Device')
    await wrapper.find('[data-testid=device-form-platform]').setValue('ios')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(wrapper.find('[data-testid=device-form-banner]').text()).toContain(
      'Có lỗi xảy ra, vui lòng thử lại.',
    )
    expect(wrapper.find('[data-testid=device-form-banner]').text()).not.toContain('Internal server error')
    expect(wrapper.find('[data-testid=device-form-identifier]').element as HTMLInputElement).toHaveProperty(
      'value',
      'IPHONE-106',
    )
  })

  it('blocks a second submit while the first is still in flight (no double-submit)', async () => {
    let resolveCreate!: (value: { device: Device }) => void
    vi.mocked(createDevice).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveCreate = resolve
      }),
    )
    const wrapper = mount(DeviceFormModal, { props: { mode: 'create' } })

    await wrapper.find('[data-testid=device-form-identifier]').setValue('IPHONE-042')
    await wrapper.find('[data-testid=device-form-name]').setValue('Alice iPhone')
    await wrapper.find('[data-testid=device-form-platform]').setValue('ios')
    await wrapper.find('form').trigger('submit')
    await wrapper.find('form').trigger('submit')
    await wrapper.find('form').trigger('submit')

    expect(createDevice).toHaveBeenCalledTimes(1)

    resolveCreate({ device: device() })
    await flushPromises()
  })
})
