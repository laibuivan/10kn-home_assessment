import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { createRouter, createMemoryHistory, type Router } from 'vue-router'
import { setActivePinia, createPinia } from 'pinia'
import DeviceListView from '../DeviceListView.vue'
import { fetchDeviceList } from '../../../api/devices'
import type { Device, DeviceListResponse } from '../../../types/device'

vi.mock('../../../api/devices', () => ({
  fetchDeviceList: vi.fn(),
}))

function device(overrides: Partial<Device> = {}): Device {
  return {
    id: 1,
    identifier: 'DEV-00001',
    name: 'Device 1',
    platform: 'ios',
    os_version: '17.4',
    status: 'active',
    last_seen_at: '2026-09-15T08:00:00.000Z',
    created_at: '2026-09-15T08:00:00.000Z',
    updated_at: '2026-09-15T08:00:00.000Z',
    ...overrides,
  }
}

function listResponse(devices: Device[], meta: Partial<DeviceListResponse['meta']> = {}): DeviceListResponse {
  const totalCount = meta.total_count ?? devices.length
  const perPage = meta.per_page ?? 20
  return {
    devices,
    meta: {
      current_page: meta.current_page ?? 1,
      per_page: perPage,
      total_count: totalCount,
      total_pages: meta.total_pages ?? (totalCount === 0 ? 0 : Math.ceil(totalCount / perPage)),
    },
  }
}

function buildRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', redirect: '/devices' },
      { path: '/login', name: 'login', component: { template: '<div />' } },
      { path: '/devices', name: 'devices', component: DeviceListView },
    ],
  })
}

async function mountView(path = '/devices'): Promise<{ wrapper: VueWrapper; router: Router }> {
  const router = buildRouter()
  router.push(path)
  await router.isReady()

  const wrapper = mount(DeviceListView, { global: { plugins: [router] } })
  await flushPromises()
  return { wrapper, router }
}

describe('DeviceListView', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('loads the first page with no filter when the URL is bare', async () => {
    vi.mocked(fetchDeviceList).mockResolvedValue(listResponse([device(), device({ id: 2 })], { total_count: 2 }))

    const { wrapper } = await mountView('/devices')

    expect(fetchDeviceList).toHaveBeenCalledWith({ platform: undefined, status: undefined, page: 1 })
    expect(wrapper.findAll('[data-testid=device-row]')).toHaveLength(2)
  })

  it('hydrates filter and page straight from the URL on first load (share link / F5)', async () => {
    vi.mocked(fetchDeviceList).mockResolvedValue(
      listResponse([device()], { current_page: 2, total_count: 25 }),
    )

    const { wrapper } = await mountView('/devices?platform=ios&page=2')

    expect(fetchDeviceList).toHaveBeenCalledWith({ platform: 'ios', status: undefined, page: 2 })
    expect((wrapper.find('[data-testid=filter-platform]').element as HTMLSelectElement).value).toBe('ios')
    expect(wrapper.find('[data-testid=pagination-page-indicator]').text()).toContain('Trang 2')
  })

  it('ignores platform/status/page values that are not valid (hand-edited URL)', async () => {
    vi.mocked(fetchDeviceList).mockResolvedValue(listResponse([device()]))

    await mountView('/devices?platform=windows&status=deleted&page=abc')

    expect(fetchDeviceList).toHaveBeenCalledWith({ platform: undefined, status: undefined, page: 1 })
  })

  it('shows the plain empty state (no CTA) when the org has no devices at all', async () => {
    vi.mocked(fetchDeviceList).mockResolvedValue(listResponse([]))

    const { wrapper } = await mountView('/devices')

    expect(wrapper.find('[data-testid=empty-state]').text()).toContain('Không có thiết bị nào')
    expect(wrapper.find('[data-testid=empty-state-clear-button]').exists()).toBe(false)
    expect(wrapper.find('[data-testid=filter-clear-button]').exists()).toBe(false)
  })

  it('shows the filtered empty state with a "Xóa lọc" button when a filter matches nothing', async () => {
    vi.mocked(fetchDeviceList).mockResolvedValue(listResponse([]))

    const { wrapper, router } = await mountView('/devices?platform=macos')

    expect(wrapper.find('[data-testid=empty-state-clear-button]').text()).toBe('Xóa lọc')

    await wrapper.find('[data-testid=empty-state-clear-button]').trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.query).toEqual({})
  })

  it('shows an error banner with a retry button and refetches on retry', async () => {
    vi.mocked(fetchDeviceList).mockRejectedValueOnce({ response: { status: 500, data: {} } })

    const { wrapper } = await mountView('/devices')

    expect(wrapper.find('[data-testid=error-banner]').text()).toContain(
      'Không tải được danh sách thiết bị.',
    )
    expect(wrapper.find('[data-testid=devices-table]').exists()).toBe(false)
    // Filter bar stays usable while the table is in error (SoT F2 §5.2 A11).
    expect(wrapper.find('[data-testid=filter-platform]').attributes('disabled')).toBeUndefined()

    vi.mocked(fetchDeviceList).mockResolvedValueOnce(listResponse([device()]))
    await wrapper.find('[data-testid=retry-button]').trigger('click')
    await flushPromises()

    expect(fetchDeviceList).toHaveBeenCalledTimes(2)
    expect(wrapper.find('[data-testid=error-banner]').exists()).toBe(false)
    expect(wrapper.findAll('[data-testid=device-row]')).toHaveLength(1)
  })

  it('writes the chosen filter into the URL and drops the page (back to page 1)', async () => {
    vi.mocked(fetchDeviceList).mockResolvedValue(listResponse([device()], { current_page: 2, total_count: 25 }))

    const { wrapper, router } = await mountView('/devices?page=2')

    await wrapper.find('[data-testid=filter-platform]').setValue('ios')
    await flushPromises()

    expect(router.currentRoute.value.query).toEqual({ platform: 'ios' })
    expect(fetchDeviceList).toHaveBeenLastCalledWith({ platform: 'ios', status: undefined, page: 1 })
  })

  it('keeps both filters when they are changed one after the other', async () => {
    vi.mocked(fetchDeviceList).mockResolvedValue(listResponse([device({ platform: 'android' })]))

    const { wrapper, router } = await mountView('/devices')

    await wrapper.find('[data-testid=filter-platform]').setValue('android')
    await wrapper.find('[data-testid=filter-status]').setValue('active')
    await flushPromises()

    expect(router.currentRoute.value.query).toEqual({ platform: 'android', status: 'active' })
    expect(fetchDeviceList).toHaveBeenLastCalledWith({
      platform: 'android',
      status: 'active',
      page: 1,
    })
  })

  it('keeps the active filter when the page changes', async () => {
    vi.mocked(fetchDeviceList).mockResolvedValue(
      listResponse([device()], { current_page: 1, total_count: 45 }),
    )

    const { wrapper, router } = await mountView('/devices?platform=ios')

    await wrapper.find('[data-testid=pagination-next]').trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.query).toEqual({ platform: 'ios', page: '2' })
    expect(fetchDeviceList).toHaveBeenLastCalledWith({ platform: 'ios', status: undefined, page: 2 })
  })

  it('redirects to the last real page when the URL asks for a page past the end', async () => {
    vi.mocked(fetchDeviceList).mockResolvedValue(
      listResponse([device()], { current_page: 999, total_count: 25, total_pages: 2 }),
    )

    const { router } = await mountView('/devices?page=999')
    await flushPromises()

    expect(router.currentRoute.value.query).toEqual({ page: '2' })
    expect(fetchDeviceList).toHaveBeenLastCalledWith({ platform: undefined, status: undefined, page: 2 })
  })

  it('renders an em-dash for a device that has never been seen', async () => {
    vi.mocked(fetchDeviceList).mockResolvedValue(
      listResponse([device({ last_seen_at: null, os_version: null })]),
    )

    const { wrapper } = await mountView('/devices')

    expect(wrapper.find('[data-field=last_seen_at]').text()).toBe('—')
    expect(wrapper.find('[data-field=os_version]').text()).toBe('—')
  })

  it('renders the status as a badge', async () => {
    vi.mocked(fetchDeviceList).mockResolvedValue(listResponse([device({ status: 'retired' })]))

    const { wrapper } = await mountView('/devices')

    const statusCell = wrapper.find('[data-field=status]')
    expect(statusCell.text()).toBe('retired')
    expect(statusCell.find('.badge.retired').exists()).toBe(true)
  })

  it('shows skeleton rows (not an empty state) during the very first load', async () => {
    let resolveFetch!: (value: DeviceListResponse) => void
    vi.mocked(fetchDeviceList).mockReturnValueOnce(
      new Promise<DeviceListResponse>((resolve) => {
        resolveFetch = resolve
      }),
    )

    const router = buildRouter()
    router.push('/devices')
    await router.isReady()
    const wrapper = mount(DeviceListView, { global: { plugins: [router] } })
    await flushPromises()

    expect(wrapper.findAll('[data-testid=skeleton-row]').length).toBeGreaterThan(0)
    expect(wrapper.find('[data-testid=empty-state]').exists()).toBe(false)
    // The "devices table" hook only appears once there is real data behind it.
    expect(wrapper.find('[data-testid=devices-table]').exists()).toBe(false)

    resolveFetch(listResponse([device()]))
    await flushPromises()

    expect(wrapper.find('[data-testid=devices-table]').exists()).toBe(true)
    expect(wrapper.findAll('[data-testid=skeleton-row]')).toHaveLength(0)
  })

  it('keeps the old rows visible under a loading overlay while refetching', async () => {
    vi.mocked(fetchDeviceList).mockResolvedValueOnce(
      listResponse([device({ identifier: 'OLD-1' })], { total_count: 45 }),
    )
    const { wrapper } = await mountView('/devices')

    let resolveSecond!: (value: DeviceListResponse) => void
    vi.mocked(fetchDeviceList).mockReturnValueOnce(
      new Promise<DeviceListResponse>((resolve) => {
        resolveSecond = resolve
      }),
    )
    await wrapper.find('[data-testid=pagination-next]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid=table-loading-overlay]').exists()).toBe(true)
    expect(wrapper.find('[data-field=identifier]').text()).toBe('OLD-1')

    resolveSecond(listResponse([device({ identifier: 'NEW-1' })], { current_page: 2, total_count: 45 }))
    await flushPromises()

    expect(wrapper.find('[data-field=identifier]').text()).toBe('NEW-1')
  })
})
