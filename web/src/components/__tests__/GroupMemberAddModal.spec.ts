import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import GroupMemberAddModal from '../GroupMemberAddModal.vue'
import { fetchDeviceList } from '../../api/devices'
import { addGroupDevices } from '../../api/group-memberships'
import type { Device, DeviceListResponse } from '../../types/device'

vi.mock('../../api/devices', () => ({
  fetchDeviceList: vi.fn(),
  fetchDevice: vi.fn(),
  createDevice: vi.fn(),
  updateDevice: vi.fn(),
}))

vi.mock('../../api/group-memberships', () => ({
  fetchGroupDevices: vi.fn(),
  addGroupDevices: vi.fn(),
  removeGroupDevice: vi.fn(),
}))

function device(overrides: Partial<Device> = {}): Device {
  return {
    id: 1,
    identifier: 'AND-0021',
    name: 'Sales Tablet 21',
    platform: 'android',
    os_version: '14',
    status: 'active',
    last_seen_at: null,
    created_at: '2026-09-16T08:00:00.000Z',
    updated_at: '2026-09-16T08:00:00.000Z',
    ...overrides,
  }
}

function listResponse(devices: Device[]): DeviceListResponse {
  return {
    devices,
    meta: { current_page: 1, per_page: 20, total_count: devices.length, total_pages: 1 },
  }
}

function mountModal(): VueWrapper {
  return mount(GroupMemberAddModal, { props: { groupId: 7 } })
}

/** Types a term, lets the debounce settle, then clicks the given result rows. */
async function searchAndPick(wrapper: VueWrapper, term: string, indexes: number[]) {
  await wrapper.find('[data-testid=group-member-add-search]').setValue(term)
  await vi.advanceTimersByTimeAsync(300)
  for (const index of indexes) {
    await wrapper.findAll('[data-testid=group-member-add-search-option]')[index].trigger('click')
  }
}

describe('GroupMemberAddModal', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('searches devices by the typed term, on page 1', async () => {
    vi.mocked(fetchDeviceList).mockResolvedValue(listResponse([device()]))
    const wrapper = mountModal()

    await wrapper.find('[data-testid=group-member-add-search]').setValue('and')
    await vi.advanceTimersByTimeAsync(300)

    expect(fetchDeviceList).toHaveBeenCalledWith({ q: 'and', page: 1 })
    expect(wrapper.find('[data-testid=group-member-add-search-option]').text()).toContain('AND-0021')
  })

  it('disables the submit button until something is selected', async () => {
    vi.mocked(fetchDeviceList).mockResolvedValue(listResponse([device()]))
    const wrapper = mountModal()

    expect(wrapper.find('[data-testid=group-member-add-submit]').attributes('disabled')).toBeDefined()

    await searchAndPick(wrapper, 'and', [0])

    expect(wrapper.find('[data-testid=group-member-add-submit]').attributes('disabled')).toBeUndefined()
  })

  it('submits every selected id in one request and emits the counts back', async () => {
    vi.mocked(fetchDeviceList).mockResolvedValue(
      listResponse([device({ id: 1 }), device({ id: 2, identifier: 'AND-0022' })]),
    )
    vi.mocked(addGroupDevices).mockResolvedValueOnce({ added_count: 2, devices_count: 12 })
    const wrapper = mountModal()

    await searchAndPick(wrapper, 'and', [0, 1])
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(addGroupDevices).toHaveBeenCalledWith(7, [1, 2])
    expect(wrapper.emitted('added')).toEqual([[{ addedCount: 2, devicesCount: 12 }]])
  })

  it('keeps the modal and the selection intact on a 422, showing the server message verbatim', async () => {
    vi.mocked(fetchDeviceList).mockResolvedValue(listResponse([device({ id: 9, identifier: 'IOS-0009' })]))
    vi.mocked(addGroupDevices).mockRejectedValueOnce({
      response: {
        status: 422,
        data: { errors: { base: ['Thiết bị đã retired, không thể thay đổi group: IOS-0009'] } },
      },
    })
    const wrapper = mountModal()

    await searchAndPick(wrapper, 'ios', [0])
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(wrapper.find('[data-testid=group-member-add-banner]').text()).toContain(
      'Thiết bị đã retired, không thể thay đổi group: IOS-0009',
    )
    expect(wrapper.emitted('added')).toBeUndefined()
    expect(wrapper.emitted('cancel')).toBeUndefined()
    // The selection survives so the user can drop the blocked device and retry.
    expect(wrapper.findAll('[data-testid=group-member-add-search-selected-chip]')).toHaveLength(1)
  })

  it('renders a field-level device_ids 422 in the same banner', async () => {
    vi.mocked(fetchDeviceList).mockResolvedValue(listResponse([device()]))
    vi.mocked(addGroupDevices).mockRejectedValueOnce({
      response: { status: 422, data: { errors: { device_ids: ['Tối đa 500 thiết bị mỗi lần'] } } },
    })
    const wrapper = mountModal()

    await searchAndPick(wrapper, 'and', [0])
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(wrapper.find('[data-testid=group-member-add-banner]').text()).toContain(
      'Tối đa 500 thiết bị mỗi lần',
    )
  })

  it('shows the generic banner (never the server internals) on a 500, and stays open', async () => {
    vi.mocked(fetchDeviceList).mockResolvedValue(listResponse([device()]))
    vi.mocked(addGroupDevices).mockRejectedValueOnce({
      response: { status: 500, data: { error: 'PG::Error: boom' } },
    })
    const wrapper = mountModal()

    await searchAndPick(wrapper, 'and', [0])
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    const banner = wrapper.find('[data-testid=group-member-add-banner]')
    expect(banner.text()).toContain('Có lỗi xảy ra, vui lòng thử lại.')
    expect(banner.text()).not.toContain('PG::Error')
    expect(wrapper.emitted('added')).toBeUndefined()
  })

  it('emits `cancel` from the Hủy button', async () => {
    vi.mocked(fetchDeviceList).mockResolvedValue(listResponse([device()]))
    const wrapper = mountModal()

    await wrapper.find('[data-testid=group-member-add-cancel]').trigger('click')

    expect(wrapper.emitted('cancel')).toHaveLength(1)
  })
})
