import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import PolicyDeviceAssignModal from '../PolicyDeviceAssignModal.vue'
import { fetchDeviceList } from '../../api/devices'
import { createPolicyDeviceAssignment } from '../../api/policyAssignments'
import type { Device, DeviceListResponse } from '../../types/device'

vi.mock('../../api/devices', () => ({
  fetchDeviceList: vi.fn(),
  fetchDevice: vi.fn(),
  createDevice: vi.fn(),
  updateDevice: vi.fn(),
}))

vi.mock('../../api/policyAssignments', () => ({
  fetchGroupPolicyAssignments: vi.fn(),
  createGroupPolicyAssignment: vi.fn(),
  deleteGroupPolicyAssignment: vi.fn(),
  fetchGroupPolicyAssignmentJobs: vi.fn(),
  fetchPolicyAssignmentJob: vi.fn(),
  fetchPolicyDeviceAssignments: vi.fn(),
  createPolicyDeviceAssignment: vi.fn(),
  deletePolicyDeviceAssignment: vi.fn(),
  fetchPolicyGroupAssignments: vi.fn(),
}))

function device(overrides: Partial<Device> = {}): Device {
  return {
    id: 1,
    identifier: 'IOS-0001',
    name: 'iPhone 14',
    platform: 'ios',
    os_version: '17.4.1',
    status: 'active',
    last_seen_at: null,
    created_at: '2026-09-17T08:00:00.000Z',
    updated_at: '2026-09-17T08:00:00.000Z',
    ...overrides,
  }
}

function listResponse(devices: Device[]): DeviceListResponse {
  return { devices, meta: { current_page: 1, per_page: 20, total_count: devices.length, total_pages: 1 } }
}

function mountModal(): VueWrapper {
  return mount(PolicyDeviceAssignModal, { props: { policyId: 5 } })
}

async function search(wrapper: VueWrapper, term: string) {
  await wrapper.find('[data-testid=policy-device-assign-search]').setValue(term)
  await vi.advanceTimersByTimeAsync(300)
}

describe('PolicyDeviceAssignModal', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('includes retired devices in results, labelled "· retired" (5.1 — not hidden, just blocked at selection)', async () => {
    vi.mocked(fetchDeviceList).mockResolvedValue(
      listResponse([device({ id: 9, identifier: 'IOS-0009', status: 'retired' })]),
    )
    const wrapper = mountModal()

    await search(wrapper, 'ios')

    expect(wrapper.find('[data-testid=policy-device-assign-search-option]').text()).toContain('· retired')
  })

  it('selecting a retired device disables submit and shows the retired-block message without an API call', async () => {
    vi.mocked(fetchDeviceList).mockResolvedValue(
      listResponse([device({ id: 9, identifier: 'IOS-0009', status: 'retired' })]),
    )
    const wrapper = mountModal()

    await search(wrapper, 'ios')
    await wrapper.find('[data-testid=policy-device-assign-search-option]').trigger('click')

    expect(wrapper.find('[data-testid=policy-device-assign-submit]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('[data-testid=policy-device-assign-retired-warning]').text()).toContain(
      'Thiết bị đã retired, không thể gán policy trực tiếp.',
    )
    expect(createPolicyDeviceAssignment).not.toHaveBeenCalled()
  })

  it('selecting an active device enables submit, no retired warning', async () => {
    vi.mocked(fetchDeviceList).mockResolvedValue(listResponse([device({ id: 1, status: 'active' })]))
    const wrapper = mountModal()

    await search(wrapper, 'ios')
    await wrapper.find('[data-testid=policy-device-assign-search-option]').trigger('click')

    expect(wrapper.find('[data-testid=policy-device-assign-submit]').attributes('disabled')).toBeUndefined()
    expect(wrapper.find('[data-testid=policy-device-assign-retired-warning]').exists()).toBe(false)
  })

  it('submits (201, synchronous) and emits the assigned device', async () => {
    vi.mocked(fetchDeviceList).mockResolvedValue(listResponse([device({ id: 1 })]))
    vi.mocked(createPolicyDeviceAssignment).mockResolvedValueOnce({ device: device({ id: 1 }) })
    const wrapper = mountModal()

    await search(wrapper, 'ios')
    await wrapper.find('[data-testid=policy-device-assign-search-option]').trigger('click')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(createPolicyDeviceAssignment).toHaveBeenCalledWith(5, 1)
    expect(wrapper.emitted('assigned')).toEqual([[device({ id: 1 })]])
  })

  it('still handles a 422 base error from the server (race: retired between search and submit) — not just the FE block', async () => {
    vi.mocked(fetchDeviceList).mockResolvedValue(listResponse([device({ id: 1 })]))
    vi.mocked(createPolicyDeviceAssignment).mockRejectedValueOnce({
      response: {
        status: 422,
        data: { errors: { base: ['Thiết bị đã retired, không thể gán policy trực tiếp.'] } },
      },
    })
    const wrapper = mountModal()

    await search(wrapper, 'ios')
    await wrapper.find('[data-testid=policy-device-assign-search-option]').trigger('click')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(wrapper.find('[data-testid=policy-device-assign-banner]').text()).toContain(
      'Thiết bị đã retired, không thể gán policy trực tiếp.',
    )
    expect(wrapper.emitted('assigned')).toBeUndefined()
  })

  it('emits cancel from the Hủy button', async () => {
    vi.mocked(fetchDeviceList).mockResolvedValue(listResponse([device()]))
    const wrapper = mountModal()

    await wrapper.find('[data-testid=policy-device-assign-cancel]').trigger('click')

    expect(wrapper.emitted('cancel')).toHaveLength(1)
  })
})
