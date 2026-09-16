import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { createRouter, createMemoryHistory, type Router } from 'vue-router'
import { setActivePinia, createPinia } from 'pinia'
import DeviceListView from '../DeviceListView.vue'
import { useDevicesStore } from '../../../stores/devices'
import { fetchDeviceList, createDevice, updateDevice } from '../../../api/devices'
import type { Device, DeviceListResponse } from '../../../types/device'

vi.mock('../../../api/devices', () => ({
  fetchDeviceList: vi.fn(),
  createDevice: vi.fn(),
  updateDevice: vi.fn(),
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
      { path: '/devices/:id', name: 'device-detail', component: { template: '<div />' } },
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

  it('shows the empty state with a "+ Thêm Device" CTA (and no filter-clear button) when the org has no devices at all', async () => {
    vi.mocked(fetchDeviceList).mockResolvedValue(listResponse([]))

    const { wrapper } = await mountView('/devices')

    expect(wrapper.find('[data-testid=empty-state]').text()).toContain('Không có thiết bị nào')
    expect(wrapper.find('[data-testid=empty-state-clear-button]').exists()).toBe(false)
    expect(wrapper.find('[data-testid=filter-clear-button]').exists()).toBe(false)
    // Exactly one "+ Thêm Device" on the page — the list-head one is hidden
    // while this variant's own CTA is showing (F3-frontend.md §2).
    expect(wrapper.findAll('[data-testid=add-device-button]')).toHaveLength(1)
  })

  it('does not show a "+ Thêm Device" CTA on the filtered empty state (A2 stays "Xóa lọc" only)', async () => {
    vi.mocked(fetchDeviceList).mockResolvedValue(listResponse([]))

    const { wrapper } = await mountView('/devices?platform=macos')

    expect(wrapper.find('[data-testid=empty-state]').findAll('[data-testid=add-device-button]')).toHaveLength(
      0,
    )
    // The list-head button is still there in this variant.
    expect(wrapper.findAll('[data-testid=add-device-button]')).toHaveLength(1)
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

  describe('navigation to Device Detail (F4)', () => {
    it('navigates to the detail page when clicking a row outside the actions cell', async () => {
      vi.mocked(fetchDeviceList).mockResolvedValue(listResponse([device({ id: 7, identifier: 'IOS-0007' })]))
      const { wrapper, router } = await mountView('/devices')

      await wrapper.find('[data-field=identifier]').trigger('click')
      await flushPromises()

      expect(router.currentRoute.value.path).toBe('/devices/7')
    })

    it('navigates to the detail page via the "Xem chi tiết" row action, without also triggering the row click', async () => {
      vi.mocked(fetchDeviceList).mockResolvedValue(listResponse([device({ id: 8, identifier: 'IOS-0008' })]))
      const { wrapper, router } = await mountView('/devices')

      await wrapper.find('[data-testid=actions-menu-trigger]').trigger('click')
      await wrapper.find('[data-testid=device-action-view]').trigger('click')
      await flushPromises()

      expect(router.currentRoute.value.path).toBe('/devices/8')
    })

    it('records the current URL as the last list location whenever the filter/page changes', async () => {
      vi.mocked(fetchDeviceList).mockResolvedValue(listResponse([device()]))
      const { router } = await mountView('/devices?platform=ios&page=2')
      const store = useDevicesStore()

      expect(store.lastListLocation).toBe(router.currentRoute.value.fullPath)
      expect(store.lastListLocation).toContain('platform=ios')
    })
  })

  describe('create/edit modal (F3)', () => {
    it('opens the create modal from the list-head "+ Thêm Device" button', async () => {
      vi.mocked(fetchDeviceList).mockResolvedValue(listResponse([device()]))
      const { wrapper } = await mountView('/devices')

      expect(wrapper.find('[data-testid=device-form-modal]').exists()).toBe(false)

      await wrapper.find('[data-testid=add-device-button]').trigger('click')

      expect(wrapper.find('[data-testid=device-form-modal]').exists()).toBe(true)
      expect(wrapper.findAll('h3').map((h) => h.text())).toContain('Thêm Device')
      expect(wrapper.find('[data-testid=device-form-identifier]').exists()).toBe(true)
      expect((wrapper.find('[data-testid=device-form-identifier]').element as HTMLInputElement).value).toBe(
        '',
      )
    })

    it('opens the edit modal from a row\'s "Sửa" button, prefilled from that row, without an extra API call', async () => {
      vi.mocked(fetchDeviceList).mockResolvedValue(
        listResponse([device({ id: 5, identifier: 'IOS-0001', name: 'iPhone 14' })]),
      )
      const { wrapper } = await mountView('/devices')
      const callsBeforeEdit = vi.mocked(fetchDeviceList).mock.calls.length

      await wrapper.find('[data-testid=actions-menu-trigger]').trigger('click')
      await wrapper.find('[data-testid=device-action-edit]').trigger('click')

      expect(wrapper.find('[data-testid=device-form-modal]').exists()).toBe(true)
      expect((wrapper.find('[data-testid=device-form-identifier]').element as HTMLInputElement).value).toBe(
        'IOS-0001',
      )
      expect((wrapper.find('[data-testid=device-form-name]').element as HTMLInputElement).value).toBe(
        'iPhone 14',
      )
      expect(fetchDeviceList).toHaveBeenCalledTimes(callsBeforeEdit)
    })

    it('disables the "Sửa" button and shows the tooltip on a retired row', async () => {
      vi.mocked(fetchDeviceList).mockResolvedValue(
        listResponse([device({ identifier: 'IOS-0004', status: 'retired' })]),
      )
      const { wrapper } = await mountView('/devices')
      await wrapper.find('[data-testid=actions-menu-trigger]').trigger('click')

      const editItem = wrapper.find('[data-testid=device-action-edit]')
      expect(editItem.attributes('disabled')).toBeDefined()

      const tooltip = wrapper.find('[data-testid=device-action-edit-tooltip]')
      expect(tooltip.attributes('title')).toBe('Thiết bị đã retired, không thể sửa')
    })

    it('does not open a modal when clicking the disabled "Sửa" item on a retired row', async () => {
      vi.mocked(fetchDeviceList).mockResolvedValue(
        listResponse([device({ identifier: 'IOS-0004', status: 'retired' })]),
      )
      const { wrapper } = await mountView('/devices')

      await wrapper.find('[data-testid=actions-menu-trigger]').trigger('click')
      await wrapper.find('[data-testid=device-action-edit]').trigger('click')

      expect(wrapper.find('[data-testid=device-form-modal]').exists()).toBe(false)
    })

    it('closes the modal, toasts, and reloads at the current filter/page on @saved (create)', async () => {
      vi.mocked(fetchDeviceList).mockResolvedValue(listResponse([device()], { total_count: 1 }))
      vi.mocked(createDevice).mockResolvedValueOnce({ device: device({ id: 99, identifier: 'IPHONE-042' }) })
      const { wrapper, router } = await mountView('/devices?platform=ios')

      await wrapper.find('[data-testid=add-device-button]').trigger('click')
      await wrapper.find('[data-testid=device-form-identifier]').setValue('IPHONE-042')
      await wrapper.find('[data-testid=device-form-name]').setValue('Alice iPhone')
      await wrapper.find('[data-testid=device-form-platform]').setValue('ios')
      const callsBeforeSave = vi.mocked(fetchDeviceList).mock.calls.length

      await wrapper.find('form').trigger('submit')
      await flushPromises()

      expect(wrapper.find('[data-testid=device-form-modal]').exists()).toBe(false)
      expect(wrapper.find('[data-testid=toast]').text()).toContain('Đã tạo device')
      // Refetch happens at the same filter/page still in the URL — no query change.
      expect(router.currentRoute.value.query).toEqual({ platform: 'ios' })
      expect(fetchDeviceList).toHaveBeenCalledTimes(callsBeforeSave + 1)
      expect(fetchDeviceList).toHaveBeenLastCalledWith({ platform: 'ios', status: undefined, page: 1 })
    })

    it('closes the modal, toasts, and reloads on @saved (edit)', async () => {
      vi.mocked(fetchDeviceList).mockResolvedValue(
        listResponse([device({ identifier: 'IOS-0001', name: 'iPhone 14' })]),
      )
      vi.mocked(updateDevice).mockResolvedValueOnce({
        device: device({ identifier: 'IOS-0001', name: 'Updated Name' }),
      })
      const { wrapper } = await mountView('/devices')

      await wrapper.find('[data-testid=actions-menu-trigger]').trigger('click')
      await wrapper.find('[data-testid=device-action-edit]').trigger('click')
      await wrapper.find('[data-testid=device-form-name]').setValue('Updated Name')
      await wrapper.find('form').trigger('submit')
      await flushPromises()

      expect(wrapper.find('[data-testid=device-form-modal]').exists()).toBe(false)
      expect(wrapper.find('[data-testid=toast]').text()).toContain('Đã cập nhật device')
    })

    it('closes the modal without saving or refetching when Cancel is clicked', async () => {
      vi.mocked(fetchDeviceList).mockResolvedValue(listResponse([device()]))
      const { wrapper } = await mountView('/devices')
      const callsBeforeCancel = vi.mocked(fetchDeviceList).mock.calls.length

      await wrapper.find('[data-testid=add-device-button]').trigger('click')
      await wrapper.find('[data-testid=device-form-cancel]').trigger('click')

      expect(wrapper.find('[data-testid=device-form-modal]').exists()).toBe(false)
      expect(createDevice).not.toHaveBeenCalled()
      expect(fetchDeviceList).toHaveBeenCalledTimes(callsBeforeCancel)
    })

    it('opens the create modal from the empty state\'s "+ Thêm Device" CTA', async () => {
      vi.mocked(fetchDeviceList).mockResolvedValue(listResponse([]))
      const { wrapper } = await mountView('/devices')

      await wrapper.find('[data-testid=add-device-button]').trigger('click')

      expect(wrapper.find('[data-testid=device-form-modal]').exists()).toBe(true)
    })
  })
})
