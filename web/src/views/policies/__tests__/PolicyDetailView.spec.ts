import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { createRouter, createMemoryHistory, type Router } from 'vue-router'
import { setActivePinia, createPinia } from 'pinia'
import PolicyDetailView from '../PolicyDetailView.vue'
import { fetchPolicy, updatePolicy } from '../../../api/policies'
import {
  fetchPolicyGroupAssignments,
  fetchPolicyDeviceAssignments,
  deleteGroupPolicyAssignment,
  deletePolicyDeviceAssignment,
  createPolicyDeviceAssignment,
} from '../../../api/policyAssignments'
import { fetchDeviceList } from '../../../api/devices'
import type { Policy } from '../../../types/policy'
import type { Device, DeviceListResponse } from '../../../types/device'

vi.mock('../../../api/policies', () => ({
  fetchPolicyList: vi.fn(),
  fetchPolicy: vi.fn(),
  createPolicy: vi.fn(),
  updatePolicy: vi.fn(),
}))

vi.mock('../../../api/policyAssignments', () => ({
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

vi.mock('../../../api/groups', () => ({
  fetchGroupList: vi.fn(),
  fetchGroup: vi.fn(),
  createGroup: vi.fn(),
  updateGroup: vi.fn(),
  deleteGroup: vi.fn(),
}))

vi.mock('../../../api/devices', () => ({
  fetchDeviceList: vi.fn(),
  fetchDevice: vi.fn(),
  createDevice: vi.fn(),
  updateDevice: vi.fn(),
}))

function policy(overrides: Partial<Policy> = {}): Policy {
  return {
    id: 5,
    name: 'Security Baseline',
    type: 'wifi',
    configuration: { ssid: 'corp' },
    status: 'active',
    assignments_count: 2,
    created_at: '2026-09-17T08:00:00.000Z',
    updated_at: '2026-09-17T08:00:00.000Z',
    ...overrides,
  }
}

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

function deviceListResponse(devices: Device[]): DeviceListResponse {
  return { devices, meta: { current_page: 1, per_page: 20, total_count: devices.length, total_pages: 1 } }
}

function groupsResponse(groups: { id: number; name: string }[]) {
  return { groups, meta: { current_page: 1, per_page: 20, total_count: groups.length, total_pages: 1 } }
}

function devicesAssignedResponse(devices: Device[]) {
  return { devices, meta: { current_page: 1, per_page: 20, total_count: devices.length, total_pages: 1 } }
}

function buildRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', redirect: '/devices' },
      { path: '/login', name: 'login', component: { template: '<div />' } },
      { path: '/devices', name: 'devices', component: { template: '<div />' } },
      { path: '/policies', name: 'policies', component: { template: '<div />' } },
      { path: '/policies/:id', name: 'policy-detail', component: PolicyDetailView, props: true },
    ],
  })
}

async function mountView(path = '/policies/5'): Promise<{ wrapper: VueWrapper; router: Router }> {
  const router = buildRouter()
  router.push(path)
  await router.isReady()

  const wrapper = mount(PolicyDetailView, { global: { plugins: [router] } })
  await flushPromises()
  return { wrapper, router }
}

function notFoundError() {
  return { response: { status: 404, data: { error: 'Not found' } } }
}

describe('PolicyDetailView', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(fetchPolicy).mockResolvedValue({ policy: policy() })
    vi.mocked(fetchPolicyGroupAssignments).mockResolvedValue(groupsResponse([]))
    vi.mocked(fetchPolicyDeviceAssignments).mockResolvedValue(devicesAssignedResponse([]))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('header', () => {
    it('loads the policy named in the URL and renders name/type/configuration', async () => {
      const { wrapper } = await mountView('/policies/5')

      expect(fetchPolicy).toHaveBeenCalledWith('5')
      expect(wrapper.find('[data-testid=policy-detail-name]').text()).toBe('Security Baseline')
      expect(wrapper.find('[data-testid=policy-detail-type]').text()).toContain('wifi')
      expect(wrapper.find('[data-testid=policy-detail-configuration]').text()).toContain('"ssid": "corp"')
    })

    it('turns the whole page into "Không tìm thấy Policy" on a 404, with a link back to /policies', async () => {
      vi.mocked(fetchPolicy).mockRejectedValueOnce(notFoundError())

      const { wrapper } = await mountView('/policies/999999')

      expect(wrapper.find('[data-testid=empty-state]').text()).toContain('Không tìm thấy Policy')
      const link = wrapper.find('[data-testid=policy-detail-back-link]')
      expect(link.exists()).toBe(true)
      expect(link.attributes('href')).toBe('/policies')
    })

    it('shows an error banner with retry on a 500, and loads once retried', async () => {
      vi.mocked(fetchPolicy).mockRejectedValueOnce({ response: { status: 500, data: {} } })
      const { wrapper } = await mountView()

      expect(wrapper.find('[data-testid=error-banner]').exists()).toBe(true)

      vi.mocked(fetchPolicy).mockResolvedValueOnce({ policy: policy() })
      await wrapper.find('[data-testid=retry-button]').trigger('click')
      await flushPromises()

      expect(wrapper.find('[data-testid=policy-detail-name]').text()).toBe('Security Baseline')
    })

    it('opens the edit modal and refetches the header on save', async () => {
      vi.mocked(updatePolicy).mockResolvedValueOnce({ policy: policy({ name: 'Renamed' }) })
      const { wrapper } = await mountView()

      await wrapper.find('[data-testid=policy-detail-edit-button]').trigger('click')
      expect((wrapper.find('[data-testid=policy-form-name]').element as HTMLInputElement).value).toBe(
        'Security Baseline',
      )

      vi.mocked(fetchPolicy).mockResolvedValueOnce({ policy: policy({ name: 'Renamed' }) })
      await wrapper.find('[data-testid=policy-form-name]').setValue('Renamed')
      await wrapper.find('form').trigger('submit')
      await flushPromises()

      expect(wrapper.find('[data-testid=policy-form-modal]').exists()).toBe(false)
      expect(wrapper.find('[data-testid=policy-detail-name]').text()).toBe('Renamed')
    })

    it('copies the configuration to the clipboard and toasts', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined)
      Object.assign(navigator, { clipboard: { writeText } })
      const { wrapper } = await mountView()

      await wrapper.find('[data-testid=policy-detail-configuration-copy]').trigger('click')
      await flushPromises()

      expect(writeText).toHaveBeenCalledWith(JSON.stringify({ ssid: 'corp' }, null, 2))
      expect(wrapper.find('[data-testid=toast]').text()).toContain('Đã copy cấu hình')
    })

    it('toasts a friendly error when the clipboard write fails', async () => {
      const writeText = vi.fn().mockRejectedValue(new Error('denied'))
      Object.assign(navigator, { clipboard: { writeText } })
      const { wrapper } = await mountView()

      await wrapper.find('[data-testid=policy-detail-configuration-copy]').trigger('click')
      await flushPromises()

      expect(wrapper.find('[data-testid=toast]').text()).toContain('Không copy được, vui lòng thử lại.')
    })
  })

  describe('tabs', () => {
    it('loads the Group tab immediately, in parallel with the header', async () => {
      await mountView()

      expect(fetchPolicyGroupAssignments).toHaveBeenCalledWith(5, { page: 1 })
    })

    it('does not load the Device tab until it is clicked (lazy load)', async () => {
      await mountView()

      expect(fetchPolicyDeviceAssignments).not.toHaveBeenCalled()
    })

    it('loads the Device tab only on its first click, and only once across repeated visits', async () => {
      vi.mocked(fetchPolicyDeviceAssignments).mockResolvedValue(devicesAssignedResponse([device()]))
      const { wrapper } = await mountView()

      await wrapper.find('[data-testid=policy-detail-tab-device]').trigger('click')
      await flushPromises()
      expect(fetchPolicyDeviceAssignments).toHaveBeenCalledTimes(1)

      await wrapper.find('[data-testid=policy-detail-tab-group]').trigger('click')
      await wrapper.find('[data-testid=policy-detail-tab-device]').trigger('click')
      await flushPromises()

      expect(fetchPolicyDeviceAssignments).toHaveBeenCalledTimes(1)
    })

    it('a Group-tab error does not affect the Device tab, and vice versa', async () => {
      vi.mocked(fetchPolicyGroupAssignments).mockRejectedValueOnce({ response: { status: 500, data: {} } })
      vi.mocked(fetchPolicyDeviceAssignments).mockResolvedValueOnce(devicesAssignedResponse([device()]))
      const { wrapper } = await mountView()

      expect(wrapper.find('[data-testid=error-banner]').exists()).toBe(true)

      await wrapper.find('[data-testid=policy-detail-tab-device]').trigger('click')
      await flushPromises()

      expect(wrapper.find('[data-testid=policy-devices-table]').exists()).toBe(true)
    })

    it('renders EmptyState with the exact A24 literal for each empty tab', async () => {
      const { wrapper } = await mountView()

      expect(wrapper.find('[data-testid=empty-state]').text()).toContain('Chưa gán cho Group nào.')

      await wrapper.find('[data-testid=policy-detail-tab-device]').trigger('click')
      await flushPromises()

      expect(wrapper.find('[data-testid=empty-state]').text()).toContain('Chưa gán trực tiếp cho Device nào.')
    })
  })

  describe('assign buttons disabled when Policy is inactive (A25)', () => {
    it('disables "Gán thêm cho Group" and "Gán thêm cho Device" with a tooltip', async () => {
      vi.mocked(fetchPolicy).mockResolvedValue({ policy: policy({ status: 'inactive' }) })
      const { wrapper } = await mountView()

      const groupButton = wrapper.find('[data-testid=policy-group-assign-button]')
      expect(groupButton.attributes('disabled')).toBeDefined()
      expect(groupButton.attributes('title')).toBe('Policy không active, không thể gán.')

      await wrapper.find('[data-testid=policy-detail-tab-device]').trigger('click')
      await flushPromises()

      const deviceButton = wrapper.find('[data-testid=policy-device-assign-button]')
      expect(deviceButton.attributes('disabled')).toBeDefined()
    })

    it('leaves both buttons enabled for an active Policy', async () => {
      const { wrapper } = await mountView()

      expect(wrapper.find('[data-testid=policy-group-assign-button]').attributes('disabled')).toBeUndefined()
    })
  })

  describe('tab Group: remove', () => {
    it('removes through the shared endpoint (groupId, policyId), toasts, and refetches', async () => {
      vi.mocked(fetchPolicyGroupAssignments).mockResolvedValue(groupsResponse([{ id: 4, name: 'Sales Team' }]))
      vi.mocked(deleteGroupPolicyAssignment).mockResolvedValueOnce(undefined)
      const { wrapper } = await mountView()

      await wrapper.find('[data-testid=policy-group-remove-button]').trigger('click')
      expect(wrapper.find('[data-testid=confirm-modal]').text()).toContain(
        'Gỡ policy "Security Baseline" khỏi group "Sales Team"?',
      )

      vi.mocked(fetchPolicyGroupAssignments).mockResolvedValueOnce(groupsResponse([]))
      await wrapper.find('[data-testid=confirm-modal-confirm]').trigger('click')
      await flushPromises()

      expect(deleteGroupPolicyAssignment).toHaveBeenCalledWith(4, 5)
      expect(wrapper.find('[data-testid=toast]').text()).toContain('Đã gỡ policy')
    })
  })

  describe('tab Device: assign / remove', () => {
    it('assigns a device: opens the modal, toasts on success, and refetches the tab', async () => {
      vi.useFakeTimers()
      vi.mocked(fetchDeviceList).mockResolvedValue(deviceListResponse([device({ id: 9 })]))
      vi.mocked(createPolicyDeviceAssignment).mockResolvedValueOnce({ device: device({ id: 9 }) })
      const { wrapper } = await mountView()

      await wrapper.find('[data-testid=policy-detail-tab-device]').trigger('click')
      await flushPromises()

      await wrapper.find('[data-testid=policy-device-assign-button]').trigger('click')
      await wrapper.find('[data-testid=policy-device-assign-search]').setValue('ios')
      await vi.advanceTimersByTimeAsync(300)
      await wrapper.find('[data-testid=policy-device-assign-search-option]').trigger('click')
      await wrapper.find('form').trigger('submit')
      await flushPromises()

      expect(createPolicyDeviceAssignment).toHaveBeenCalledWith(5, 9)
      expect(wrapper.find('[data-testid=policy-device-assign-modal]').exists()).toBe(false)
      expect(wrapper.find('[data-testid=toast]').text()).toContain('Đã gán policy cho device')
      vi.useRealTimers()
    })

    it('removes a device, toasts "Đã gỡ policy" (same literal as the Group side), and refetches', async () => {
      vi.mocked(fetchPolicyDeviceAssignments).mockResolvedValue(devicesAssignedResponse([device({ id: 9 })]))
      vi.mocked(deletePolicyDeviceAssignment).mockResolvedValueOnce(undefined)
      const { wrapper } = await mountView()

      await wrapper.find('[data-testid=policy-detail-tab-device]').trigger('click')
      await flushPromises()

      await wrapper.find('[data-testid=policy-device-remove-button]').trigger('click')
      expect(wrapper.find('[data-testid=confirm-modal]').text()).toContain(
        'Gỡ policy "Security Baseline" khỏi device "IOS-0001"?',
      )

      vi.mocked(fetchPolicyDeviceAssignments).mockResolvedValueOnce(devicesAssignedResponse([]))
      await wrapper.find('[data-testid=confirm-modal-confirm]').trigger('click')
      await flushPromises()

      expect(deletePolicyDeviceAssignment).toHaveBeenCalledWith(5, 9)
      expect(wrapper.find('[data-testid=toast]').text()).toContain('Đã gỡ policy')
    })
  })
})
