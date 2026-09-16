import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { createRouter, createMemoryHistory, type Router } from 'vue-router'
import { setActivePinia, createPinia } from 'pinia'
import DeviceDetailView from '../DeviceDetailView.vue'
import { useDevicesStore } from '../../../stores/devices'
import { fetchDevice, updateDevice } from '../../../api/devices'
import type { Device } from '../../../types/device'

vi.mock('../../../api/devices', () => ({
  fetchDevice: vi.fn(),
  updateDevice: vi.fn(),
  createDevice: vi.fn(),
  fetchDeviceList: vi.fn(),
}))

function device(overrides: Partial<Device> = {}): Device {
  return {
    id: 42,
    identifier: 'IOS-0001',
    name: 'iPhone 14',
    platform: 'ios',
    os_version: '17.4.1',
    status: 'active',
    last_seen_at: '2026-09-15T08:00:00.000Z',
    created_at: '2026-09-15T08:00:00.000Z',
    updated_at: '2026-09-15T08:00:00.000Z',
    ...overrides,
  }
}

function buildRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', redirect: '/devices' },
      { path: '/login', name: 'login', component: { template: '<div />' } },
      { path: '/devices', name: 'devices', component: { template: '<div />' } },
      { path: '/devices/:id', name: 'device-detail', component: DeviceDetailView, props: true },
    ],
  })
}

async function mountView(path: string): Promise<{ wrapper: VueWrapper; router: Router }> {
  const router = buildRouter()
  router.push(path)
  await router.isReady()

  const wrapper = mount(DeviceDetailView, { global: { plugins: [router] } })
  await flushPromises()
  return { wrapper, router }
}

function notFoundError() {
  return { response: { status: 404, data: { error: 'Not found' } } }
}

describe('DeviceDetailView', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it("shows the device's full information and the two static empty blocks on success", async () => {
    vi.mocked(fetchDevice).mockResolvedValue({ device: device() })

    const { wrapper } = await mountView('/devices/42')

    expect(fetchDevice).toHaveBeenCalledWith('42')
    expect(wrapper.find('[data-testid=device-detail-identifier]').text()).toBe('IOS-0001')
    expect(wrapper.find('[data-testid=device-detail-name]').text()).toBe('iPhone 14')
    expect(wrapper.find('[data-testid=device-detail-status]').exists()).toBe(true)
    expect(wrapper.find('[data-testid=device-detail-groups-empty]').text()).toContain('Chưa thuộc group nào.')
    expect(wrapper.find('[data-testid=device-detail-policies-empty]').text()).toContain(
      'Chưa có policy nào áp dụng.',
    )
  })

  it('hides the Edit button and shows the neutral banner for a retired device', async () => {
    vi.mocked(fetchDevice).mockResolvedValue({ device: device({ status: 'retired' }) })

    const { wrapper } = await mountView('/devices/42')

    expect(wrapper.find('[data-testid=device-detail-edit-button]').exists()).toBe(false)
    expect(wrapper.find('[data-testid=device-detail-retired-banner]').text()).toContain(
      'Thiết bị đã retired — không thể chỉnh sửa.',
    )
  })

  it('shows a working Edit button for a non-retired device that opens the prefilled form', async () => {
    vi.mocked(fetchDevice).mockResolvedValue({ device: device() })

    const { wrapper } = await mountView('/devices/42')
    expect(wrapper.find('[data-testid=device-detail-retired-banner]').exists()).toBe(false)

    await wrapper.find('[data-testid=device-detail-edit-button]').trigger('click')

    expect(wrapper.find('[data-testid=device-form-modal]').exists()).toBe(true)
    expect((wrapper.find('[data-testid=device-form-identifier]').element as HTMLInputElement).value).toBe(
      'IOS-0001',
    )
  })

  it('refetches and updates the header immediately after a successful edit (no page reload)', async () => {
    vi.mocked(fetchDevice)
      .mockResolvedValueOnce({ device: device({ status: 'active' }) })
      .mockResolvedValueOnce({ device: device({ status: 'retired' }) })
    vi.mocked(updateDevice).mockResolvedValueOnce({ device: device({ status: 'retired' }) })

    const { wrapper } = await mountView('/devices/42')

    await wrapper.find('[data-testid=device-detail-edit-button]').trigger('click')
    await wrapper.find('[data-testid=device-form-status]').setValue('retired')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(wrapper.find('[data-testid=device-form-modal]').exists()).toBe(false)
    expect(wrapper.find('[data-testid=toast]').text()).toContain('Đã cập nhật device')
    expect(fetchDevice).toHaveBeenCalledTimes(2)
    expect(wrapper.find('[data-testid=device-detail-retired-banner]').exists()).toBe(true)
  })

  it('shows the not-found empty state (with a back link) for a 404', async () => {
    vi.mocked(fetchDevice).mockRejectedValue(notFoundError())

    const { wrapper } = await mountView('/devices/999999999')

    expect(wrapper.find('[data-testid=empty-state]').text()).toContain('Không tìm thấy thiết bị')
    expect(wrapper.find('[data-testid=device-detail-back-link]').exists()).toBe(true)
  })

  it('shows an error banner with retry for a non-404 failure, and retry reloads', async () => {
    vi.mocked(fetchDevice).mockRejectedValueOnce({ response: { status: 500, data: {} } })

    const { wrapper } = await mountView('/devices/42')

    expect(wrapper.find('[data-testid=error-banner]').exists()).toBe(true)
    expect(wrapper.find('[data-testid=empty-state]').exists()).toBe(false)

    vi.mocked(fetchDevice).mockResolvedValueOnce({ device: device() })
    await wrapper.find('[data-testid=retry-button]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid=error-banner]').exists()).toBe(false)
    expect(wrapper.find('[data-testid=device-detail-identifier]').exists()).toBe(true)
  })

  it('uses the last list location for "back to list" when available', async () => {
    vi.mocked(fetchDevice).mockResolvedValue({ device: device() })
    const { wrapper, router } = await mountView('/devices/42')
    const store = useDevicesStore()
    store.lastListLocation = '/devices?platform=ios&page=2'
    await wrapper.vm.$nextTick()

    const backLink = wrapper.find('[data-testid=device-detail-back-link]')
    await backLink.trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.fullPath).toBe('/devices?platform=ios&page=2')
  })

  it('falls back to a plain /devices when there is no last list location', async () => {
    vi.mocked(fetchDevice).mockResolvedValue({ device: device() })
    const { wrapper, router } = await mountView('/devices/42')

    const backLink = wrapper.find('[data-testid=device-detail-back-link]')
    await backLink.trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.path).toBe('/devices')
  })
})
