import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { createRouter, createMemoryHistory, type Router } from 'vue-router'
import { setActivePinia, createPinia } from 'pinia'
import GroupDetailView from '../GroupDetailView.vue'
import { fetchGroup, updateGroup, deleteGroup } from '../../../api/groups'
import { fetchGroupDevices, addGroupDevices, removeGroupDevice } from '../../../api/group-memberships'
import { fetchDeviceList } from '../../../api/devices'
import { fetchPolicyList } from '../../../api/policies'
import {
  fetchGroupPolicyAssignments,
  createGroupPolicyAssignment,
  deleteGroupPolicyAssignment,
  fetchGroupPolicyAssignmentJobs,
  fetchPolicyAssignmentJob,
} from '../../../api/policyAssignments'
import { useGroupsStore } from '../../../stores/groups'
import type { Group } from '../../../types/group'
import type { Device, DeviceListResponse } from '../../../types/device'
import type { PolicySummary } from '../../../types/policyAssignment'
import type { PolicyAssignmentJob } from '../../../types/policyAssignmentJob'

vi.mock('../../../api/groups', () => ({
  fetchGroup: vi.fn(),
  fetchGroupList: vi.fn(),
  createGroup: vi.fn(),
  updateGroup: vi.fn(),
  deleteGroup: vi.fn(),
}))

vi.mock('../../../api/group-memberships', () => ({
  fetchGroupDevices: vi.fn(),
  addGroupDevices: vi.fn(),
  removeGroupDevice: vi.fn(),
}))

vi.mock('../../../api/devices', () => ({
  fetchDeviceList: vi.fn(),
  fetchDevice: vi.fn(),
  createDevice: vi.fn(),
  updateDevice: vi.fn(),
}))

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

function policySummary(overrides: Partial<PolicySummary> = {}): PolicySummary {
  return { id: 1, name: 'Security Baseline', type: 'wifi', status: 'active', ...overrides }
}

function policyAssignmentsResponse(
  policies: PolicySummary[],
  total = policies.length,
): { policies: PolicySummary[]; meta: { current_page: number; per_page: number; total_count: number; total_pages: number } } {
  return {
    policies,
    meta: { current_page: 1, per_page: 20, total_count: total, total_pages: total === 0 ? 0 : Math.ceil(total / 20) },
  }
}

function job(overrides: Partial<PolicyAssignmentJob> = {}): PolicyAssignmentJob {
  return {
    id: 1,
    status: 'pending',
    total_count: 3,
    processed_count: 0,
    error_message: null,
    policy: { id: 1, name: 'Security Baseline' },
    group: { id: 7, name: 'Sales Team' },
    created_at: '2026-09-17T08:00:00.000Z',
    updated_at: '2026-09-17T08:00:00.000Z',
    ...overrides,
  }
}

function group(overrides: Partial<Group> = {}): Group {
  return {
    id: 7,
    name: 'Sales Team',
    description: 'Đội kinh doanh',
    devices_count: 3,
    created_at: '2026-09-16T08:00:00.000Z',
    updated_at: '2026-09-16T08:00:00.000Z',
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
    created_at: '2026-09-16T08:00:00.000Z',
    updated_at: '2026-09-16T08:00:00.000Z',
    ...overrides,
  }
}

function membersResponse(
  devices: Device[],
  meta: Partial<DeviceListResponse['meta']> = {},
): DeviceListResponse {
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
      { path: '/devices', name: 'devices', component: { template: '<div />' } },
      { path: '/devices/:id', name: 'device-detail', component: { template: '<div />' } },
      { path: '/groups', name: 'groups', component: { template: '<div />' } },
      { path: '/groups/:id', name: 'group-detail', component: GroupDetailView, props: true },
    ],
  })
}

async function mountView(path = '/groups/7'): Promise<{ wrapper: VueWrapper; router: Router }> {
  const router = buildRouter()
  router.push(path)
  await router.isReady()

  const wrapper = mount(GroupDetailView, { global: { plugins: [router] } })
  await flushPromises()
  return { wrapper, router }
}

function notFoundError() {
  return { response: { status: 404, data: { error: 'Not found' } } }
}

describe('GroupDetailView', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(fetchGroup).mockResolvedValue({ group: group() })
    vi.mocked(fetchGroupDevices).mockResolvedValue(membersResponse([device()]))
    // Reattach (A17) always fires on mount, regardless of which tab is active.
    vi.mocked(fetchGroupPolicyAssignmentJobs).mockResolvedValue({
      policy_assignment_jobs: [],
      meta: { current_page: 1, per_page: 20, total_count: 0, total_pages: 0 },
    })
    vi.mocked(fetchGroupPolicyAssignments).mockResolvedValue(policyAssignmentsResponse([]))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('header', () => {
    it('loads the group named in the URL and renders its name/description', async () => {
      const { wrapper } = await mountView('/groups/7')

      expect(fetchGroup).toHaveBeenCalledWith('7')
      expect(wrapper.find('[data-testid=group-detail-name]').text()).toBe('Sales Team')
      expect(wrapper.find('[data-testid=group-detail-description]').text()).toBe('Đội kinh doanh')
    })

    it('spells out "Không có mô tả" rather than a dash when there is none', async () => {
      vi.mocked(fetchGroup).mockResolvedValue({ group: group({ description: null }) })

      const { wrapper } = await mountView()

      expect(wrapper.find('[data-testid=group-detail-description]').text()).toBe('Không có mô tả')
      expect(wrapper.text()).not.toContain('null')
    })

    it('shows the member count from the header, in the tab label', async () => {
      vi.mocked(fetchGroup).mockResolvedValue({ group: group({ devices_count: 128 }) })

      const { wrapper } = await mountView()

      expect(wrapper.find('[data-testid=group-detail-members-tab]').text()).toContain(
        'Thành viên (128)',
      )
    })

    it('turns the whole page into "Không tìm thấy Group" on a 404, and does not load the tab', async () => {
      vi.mocked(fetchGroup).mockRejectedValue(notFoundError())

      const { wrapper } = await mountView('/groups/999999')

      expect(wrapper.find('[data-testid=empty-state]').text()).toContain('Không tìm thấy Group')
      expect(wrapper.find('[data-testid=group-detail-back-link]').exists()).toBe(true)
      expect(wrapper.find('[data-testid=group-members-table]').exists()).toBe(false)
    })

    it('keeps the members tab alive when only the header fails (A28)', async () => {
      vi.mocked(fetchGroup).mockRejectedValueOnce({ response: { status: 500, data: {} } })

      const { wrapper } = await mountView()

      expect(wrapper.find('[data-testid=error-banner]').text()).toContain(
        'Không tải được thông tin group.',
      )
      expect(wrapper.find('[data-testid=group-members-table]').exists()).toBe(true)

      vi.mocked(fetchGroup).mockResolvedValueOnce({ group: group() })
      await wrapper.find('[data-testid=retry-button]').trigger('click')
      await flushPromises()

      expect(wrapper.find('[data-testid=group-detail-name]').text()).toBe('Sales Team')
    })

    it('returns to the exact list location the user came from', async () => {
      const { wrapper, router } = await mountView()
      const store = useGroupsStore()
      store.lastListLocation = '/groups?q=sales&page=2'
      await wrapper.vm.$nextTick()

      await wrapper.find('[data-testid=group-detail-back-link]').trigger('click')
      await flushPromises()

      expect(router.currentRoute.value.fullPath).toBe('/groups?q=sales&page=2')
    })

    it('falls back to a bare /groups when there is no remembered list location', async () => {
      const { wrapper, router } = await mountView()

      await wrapper.find('[data-testid=group-detail-back-link]').trigger('click')
      await flushPromises()

      expect(router.currentRoute.value.path).toBe('/groups')
    })
  })

  describe('header: edit and delete', () => {
    it('edits through the shared form modal and refetches only the header', async () => {
      vi.mocked(updateGroup).mockResolvedValueOnce({ group: group({ name: 'Sales APAC' }) })
      const { wrapper } = await mountView()
      const memberCallsBefore = vi.mocked(fetchGroupDevices).mock.calls.length

      await wrapper.find('[data-testid=group-detail-edit-button]').trigger('click')
      expect((wrapper.find('[data-testid=group-form-name]').element as HTMLInputElement).value).toBe(
        'Sales Team',
      )

      vi.mocked(fetchGroup).mockResolvedValueOnce({ group: group({ name: 'Sales APAC' }) })
      await wrapper.find('[data-testid=group-form-name]').setValue('Sales APAC')
      await wrapper.find('form').trigger('submit')
      await flushPromises()

      expect(wrapper.find('[data-testid=group-form-modal]').exists()).toBe(false)
      expect(wrapper.find('[data-testid=toast]').text()).toContain('Đã cập nhật group')
      expect(wrapper.find('[data-testid=group-detail-name]').text()).toBe('Sales APAC')
      expect(vi.mocked(fetchGroupDevices).mock.calls.length).toBe(memberCallsBefore)
    })

    it('switches to the not-found page when the edit 404s (deleted elsewhere)', async () => {
      vi.mocked(updateGroup).mockRejectedValueOnce(notFoundError())
      const { wrapper } = await mountView()

      await wrapper.find('[data-testid=group-detail-edit-button]').trigger('click')
      await wrapper.find('[data-testid=group-form-name]').setValue('Sales APAC')
      await wrapper.find('form').trigger('submit')
      await flushPromises()

      expect(wrapper.find('[data-testid=group-form-modal]').exists()).toBe(false)
      expect(wrapper.find('[data-testid=toast]').text()).toContain('Group không tồn tại hoặc đã bị xóa')
      expect(wrapper.find('[data-testid=empty-state]').text()).toContain('Không tìm thấy Group')
    })

    it('puts the real device count in the delete confirmation and leaves on success', async () => {
      vi.mocked(fetchGroup).mockResolvedValue({ group: group({ devices_count: 128 }) })
      vi.mocked(deleteGroup).mockResolvedValueOnce(undefined)
      const { wrapper, router } = await mountView()

      await wrapper.find('[data-testid=group-detail-delete-button]').trigger('click')
      expect(wrapper.find('[data-testid=confirm-modal]').text()).toContain(
        'sẽ gỡ toàn bộ liên kết với 128 device',
      )
      expect(deleteGroup).not.toHaveBeenCalled()

      await wrapper.find('[data-testid=confirm-modal-confirm]').trigger('click')
      await flushPromises()

      expect(deleteGroup).toHaveBeenCalledWith(7)
      expect(wrapper.find('[data-testid=toast]').text()).toContain('Đã xóa group')
      expect(router.currentRoute.value.path).toBe('/groups')
    })

    it('keeps the delete dialog open on a 500 so the user can retry', async () => {
      vi.mocked(deleteGroup).mockRejectedValueOnce({ response: { status: 500, data: {} } })
      const { wrapper, router } = await mountView()

      await wrapper.find('[data-testid=group-detail-delete-button]').trigger('click')
      await wrapper.find('[data-testid=confirm-modal-confirm]').trigger('click')
      await flushPromises()

      expect(wrapper.find('[data-testid=confirm-modal]').exists()).toBe(true)
      expect(wrapper.find('[data-testid=toast]').text()).toContain(
        'Không xóa được group, vui lòng thử lại.',
      )
      expect(router.currentRoute.value.path).toBe('/groups/7')
    })
  })

  describe('members tab', () => {
    it('fetches page 1 with no filter for a bare URL', async () => {
      await mountView('/groups/7')

      expect(fetchGroupDevices).toHaveBeenCalledWith(7, {
        page: 1,
        platform: undefined,
        status: undefined,
      })
    })

    it('hydrates page and filters straight from the URL (shared link)', async () => {
      vi.mocked(fetchGroupDevices).mockResolvedValue(
        membersResponse([device()], { current_page: 3, total_count: 10000 }),
      )

      const { wrapper } = await mountView('/groups/7?tab=members&page=3&platform=ios')

      expect(fetchGroupDevices).toHaveBeenCalledWith(7, {
        page: 3,
        platform: 'ios',
        status: undefined,
      })
      expect(wrapper.find('[data-testid=pagination-page-indicator]').text()).toContain('Trang 3')
      expect(wrapper.find('[data-testid=pagination-info]').text()).toContain('10000')
    })

    it('shows exactly the four member columns — no OS Version / Last seen', async () => {
      const { wrapper } = await mountView()

      const headers = wrapper.findAll('[data-testid=group-members-table] th').map((th) => th.text())
      expect(headers).toEqual(['Identifier', 'Name', 'Platform', 'Status', ''])
    })

    it('opens the device detail page when a member row is clicked', async () => {
      vi.mocked(fetchGroupDevices).mockResolvedValue(membersResponse([device({ id: 42 })]))
      const { wrapper, router } = await mountView()

      await wrapper.find('[data-field=identifier]').trigger('click')
      await flushPromises()

      expect(router.currentRoute.value.path).toBe('/devices/42')
    })

    it('resets to page 1 when a filter changes, and keeps filters when the page changes', async () => {
      // `current_page: 1` in every stubbed response: after the filter reset
      // the bar genuinely sits on page 1, so "Sau ›" must ask for page 2.
      vi.mocked(fetchGroupDevices).mockResolvedValue(
        membersResponse([device()], { current_page: 1, total_count: 45 }),
      )
      const { wrapper, router } = await mountView('/groups/7?page=2')

      await wrapper.find('[data-testid=filter-platform]').setValue('ios')
      await flushPromises()

      expect(router.currentRoute.value.query).toEqual({ platform: 'ios' })
      expect(fetchGroupDevices).toHaveBeenLastCalledWith(7, {
        page: 1,
        platform: 'ios',
        status: undefined,
      })

      await wrapper.find('[data-testid=pagination-next]').trigger('click')
      await flushPromises()

      expect(router.currentRoute.value.query).toEqual({ platform: 'ios', page: '2' })
      expect(fetchGroupDevices).toHaveBeenLastCalledWith(7, {
        page: 2,
        platform: 'ios',
        status: undefined,
      })
    })

    it('tells "the group is empty" (A19, with a CTA) apart from "the filter matched nothing" (A18)', async () => {
      vi.mocked(fetchGroupDevices).mockResolvedValue(membersResponse([]))

      const { wrapper } = await mountView('/groups/7')
      expect(wrapper.find('[data-testid=empty-state]').text()).toContain('Group chưa có thiết bị nào')
      // A19's own CTA is the only one on screen — the list-head button hides.
      expect(wrapper.findAll('[data-testid=add-devices-button]')).toHaveLength(1)
      expect(wrapper.find('[data-testid=empty-state-clear-button]').exists()).toBe(false)

      const filtered = await mountView('/groups/7?status=retired')
      expect(filtered.wrapper.find('[data-testid=empty-state]').text()).toContain(
        'Không tìm thấy thiết bị',
      )
      expect(filtered.wrapper.find('[data-testid=empty-state-clear-button]').exists()).toBe(true)
      // No "add" CTA here — it would read as if the group itself were empty.
      expect(
        filtered.wrapper.find('[data-testid=empty-state]').findAll('[data-testid=add-devices-button]'),
      ).toHaveLength(0)
    })

    it('shows the tab error inside the tab, leaving the header readable (A28)', async () => {
      vi.mocked(fetchGroupDevices).mockRejectedValueOnce({ response: { status: 500, data: {} } })

      const { wrapper } = await mountView()

      expect(wrapper.find('[data-testid=error-banner]').text()).toContain(
        'Không tải được danh sách thành viên của group.',
      )
      expect(wrapper.find('[data-testid=group-detail-name]').text()).toBe('Sales Team')
      expect(wrapper.find('[data-testid=group-members-table]').exists()).toBe(false)

      vi.mocked(fetchGroupDevices).mockResolvedValueOnce(membersResponse([device()]))
      await wrapper.find('[data-testid=retry-button]').trigger('click')
      await flushPromises()

      expect(wrapper.find('[data-testid=group-members-table]').exists()).toBe(true)
    })
  })

  describe('members tab: inline remove', () => {
    it('asks inline (never a full modal) and sends nothing until confirmed', async () => {
      const { wrapper } = await mountView()

      await wrapper.find('[data-testid=group-member-remove-button]').trigger('click')

      expect(wrapper.find('[data-testid=group-member-remove-confirm]').exists()).toBe(true)
      expect(wrapper.find('[data-testid=group-member-remove-cancel]').exists()).toBe(true)
      expect(wrapper.find('[data-testid=confirm-modal]').exists()).toBe(false)
      expect(removeGroupDevice).not.toHaveBeenCalled()
    })

    it('sends nothing when the inline confirm is cancelled', async () => {
      const { wrapper } = await mountView()

      await wrapper.find('[data-testid=group-member-remove-button]').trigger('click')
      await wrapper.find('[data-testid=group-member-remove-cancel]').trigger('click')

      expect(wrapper.find('[data-testid=group-member-remove-confirm]').exists()).toBe(false)
      expect(removeGroupDevice).not.toHaveBeenCalled()
      expect(wrapper.findAll('[data-testid=group-member-row]')).toHaveLength(1)
    })

    it('on 204: toasts and refetches BOTH the header count and the tab', async () => {
      vi.mocked(fetchGroupDevices).mockResolvedValue(membersResponse([device({ id: 42 })], { total_count: 3 }))
      vi.mocked(removeGroupDevice).mockResolvedValueOnce(undefined)
      const { wrapper } = await mountView()
      const headerCalls = vi.mocked(fetchGroup).mock.calls.length
      const memberCalls = vi.mocked(fetchGroupDevices).mock.calls.length

      vi.mocked(fetchGroup).mockResolvedValue({ group: group({ devices_count: 2 }) })
      vi.mocked(fetchGroupDevices).mockResolvedValue(membersResponse([], { total_count: 0 }))
      await wrapper.find('[data-testid=group-member-remove-button]').trigger('click')
      await wrapper.find('[data-testid=group-member-remove-confirm]').trigger('click')
      await flushPromises()

      expect(removeGroupDevice).toHaveBeenCalledWith(7, 42)
      expect(wrapper.find('[data-testid=toast]').text()).toContain('Đã gỡ thiết bị khỏi group')
      expect(vi.mocked(fetchGroup).mock.calls.length).toBe(headerCalls + 1)
      expect(vi.mocked(fetchGroupDevices).mock.calls.length).toBe(memberCalls + 1)
      expect(wrapper.find('[data-testid=group-detail-members-tab]').text()).toContain('Thành viên (2)')
    })

    it('on 422 (retired device, A9): toasts the server message and leaves the row untouched', async () => {
      vi.mocked(removeGroupDevice).mockRejectedValueOnce({
        response: {
          status: 422,
          data: { errors: { base: ['Thiết bị đã retired, không thể thay đổi group'] } },
        },
      })
      const { wrapper } = await mountView()
      const memberCalls = vi.mocked(fetchGroupDevices).mock.calls.length

      await wrapper.find('[data-testid=group-member-remove-button]').trigger('click')
      await wrapper.find('[data-testid=group-member-remove-confirm]').trigger('click')
      await flushPromises()

      expect(wrapper.find('[data-testid=toast]').text()).toContain(
        'Thiết bị đã retired, không thể thay đổi group',
      )
      expect(vi.mocked(fetchGroupDevices).mock.calls.length).toBe(memberCalls)
      expect(wrapper.findAll('[data-testid=group-member-row]')).toHaveLength(1)
    })

    it('on 404: toasts and refetches both blocks, so a group deleted meanwhile surfaces', async () => {
      vi.mocked(removeGroupDevice).mockRejectedValueOnce(notFoundError())
      const { wrapper } = await mountView()

      vi.mocked(fetchGroup).mockRejectedValueOnce(notFoundError())
      await wrapper.find('[data-testid=group-member-remove-button]').trigger('click')
      await wrapper.find('[data-testid=group-member-remove-confirm]').trigger('click')
      await flushPromises()

      expect(wrapper.find('[data-testid=toast]').text()).toContain(
        'Thiết bị không còn là thành viên của group này.',
      )
      // The header's own 404 chains into the whole-page not-found state.
      expect(wrapper.find('[data-testid=empty-state]').text()).toContain('Không tìm thấy Group')
    })

    it('on 500: toasts the generic message and does not refetch', async () => {
      vi.mocked(removeGroupDevice).mockRejectedValueOnce({
        response: { status: 500, data: { error: 'PG::Error: boom' } },
      })
      const { wrapper } = await mountView()
      const memberCalls = vi.mocked(fetchGroupDevices).mock.calls.length

      await wrapper.find('[data-testid=group-member-remove-button]').trigger('click')
      await wrapper.find('[data-testid=group-member-remove-confirm]').trigger('click')
      await flushPromises()

      const toast = wrapper.find('[data-testid=toast]')
      expect(toast.text()).toContain('Không gỡ được thiết bị, vui lòng thử lại.')
      expect(toast.text()).not.toContain('PG::Error')
      expect(vi.mocked(fetchGroupDevices).mock.calls.length).toBe(memberCalls)
    })

    it('sends one request only when "Có, gỡ" is clicked twice', async () => {
      let resolveRemove!: () => void
      vi.mocked(removeGroupDevice).mockReturnValueOnce(
        new Promise<void>((resolve) => {
          resolveRemove = resolve
        }),
      )
      const { wrapper } = await mountView()

      await wrapper.find('[data-testid=group-member-remove-button]').trigger('click')
      const confirm = wrapper.find('[data-testid=group-member-remove-confirm]')
      await confirm.trigger('click')
      await confirm.trigger('click')

      expect(removeGroupDevice).toHaveBeenCalledTimes(1)

      resolveRemove()
      await flushPromises()
    })
  })

  describe('members tab: add', () => {
    it('adds through the modal, then returns to page 1 and refreshes both blocks', async () => {
      vi.useFakeTimers()
      vi.mocked(fetchGroupDevices).mockResolvedValue(
        membersResponse([device()], { current_page: 2, total_count: 45 }),
      )
      vi.mocked(fetchDeviceList).mockResolvedValue({
        devices: [device({ id: 21, identifier: 'AND-0021' })],
        meta: { current_page: 1, per_page: 20, total_count: 1, total_pages: 1 },
      })
      vi.mocked(addGroupDevices).mockResolvedValueOnce({ added_count: 1, devices_count: 46 })

      const router = buildRouter()
      router.push('/groups/7?page=2')
      await router.isReady()
      const wrapper = mount(GroupDetailView, { global: { plugins: [router] } })
      await flushPromises()

      await wrapper.find('[data-testid=add-devices-button]').trigger('click')
      expect(wrapper.find('[data-testid=group-member-add-modal]').exists()).toBe(true)

      await wrapper.find('[data-testid=group-member-add-search]').setValue('and')
      await vi.advanceTimersByTimeAsync(300)
      await wrapper.find('[data-testid=group-member-add-search-option]').trigger('click')

      const headerCalls = vi.mocked(fetchGroup).mock.calls.length
      await wrapper.find('form').trigger('submit')
      await flushPromises()

      expect(addGroupDevices).toHaveBeenCalledWith(7, [21])
      expect(wrapper.find('[data-testid=group-member-add-modal]').exists()).toBe(false)
      expect(wrapper.find('[data-testid=toast]').text()).toContain('Đã thêm 1 thiết bị vào group')
      expect(router.currentRoute.value.query).toEqual({})
      expect(fetchGroupDevices).toHaveBeenLastCalledWith(7, {
        page: 1,
        platform: undefined,
        status: undefined,
      })
      expect(vi.mocked(fetchGroup).mock.calls.length).toBe(headerCalls + 1)
      vi.useRealTimers()
    })

    it('refetches exactly once when adding from page 1 (no watcher to piggyback on)', async () => {
      vi.useFakeTimers()
      vi.mocked(fetchDeviceList).mockResolvedValue({
        devices: [device({ id: 21 })],
        meta: { current_page: 1, per_page: 20, total_count: 1, total_pages: 1 },
      })
      vi.mocked(addGroupDevices).mockResolvedValueOnce({ added_count: 1, devices_count: 4 })

      const router = buildRouter()
      router.push('/groups/7')
      await router.isReady()
      const wrapper = mount(GroupDetailView, { global: { plugins: [router] } })
      await flushPromises()
      const memberCalls = vi.mocked(fetchGroupDevices).mock.calls.length

      await wrapper.find('[data-testid=add-devices-button]').trigger('click')
      await wrapper.find('[data-testid=group-member-add-search]').setValue('ios')
      await vi.advanceTimersByTimeAsync(300)
      await wrapper.find('[data-testid=group-member-add-search-option]').trigger('click')
      await wrapper.find('form').trigger('submit')
      await flushPromises()

      expect(vi.mocked(fetchGroupDevices).mock.calls.length).toBe(memberCalls + 1)
      vi.useRealTimers()
    })
  })

  describe('tab Policies (F8, §2.4)', () => {
    it('switches between the two real tabs (no more dead <span>)', async () => {
      const { wrapper } = await mountView()

      expect(wrapper.find('[data-testid=group-detail-members-tab]').element.tagName).toBe('BUTTON')
      expect(wrapper.find('[data-testid=group-detail-policies-tab]').element.tagName).toBe('BUTTON')
      expect(wrapper.find('[data-testid=group-members-table]').exists()).toBe(true)

      await wrapper.find('[data-testid=group-detail-policies-tab]').trigger('click')
      await flushPromises()

      expect(wrapper.find('[data-testid=group-members-table]').exists()).toBe(false)
      expect(fetchGroupPolicyAssignments).toHaveBeenCalledWith(7, { page: 1 })
    })

    it('lazy-loads the Policies tab only on its first click, not on mount', async () => {
      await mountView()

      expect(fetchGroupPolicyAssignments).not.toHaveBeenCalled()
    })

    it('reattaches pending/running jobs on mount, regardless of which tab is active', async () => {
      vi.mocked(fetchGroupPolicyAssignmentJobs).mockResolvedValueOnce({
        policy_assignment_jobs: [job()],
        meta: { current_page: 1, per_page: 20, total_count: 1, total_pages: 1 },
      })

      const { wrapper } = await mountView()

      expect(fetchGroupPolicyAssignmentJobs).toHaveBeenCalledWith(7, { status: ['pending', 'running'] })
      // Still on "Thành viên", yet the banner (mounted globally, rendered
      // here because AppShell is part of this component tree) shows up.
      expect(wrapper.find('[data-testid=async-job-banner]').exists()).toBe(true)
    })

    it('renders the Policies list with Name/Type/Status columns and a "Gỡ" button per row', async () => {
      vi.mocked(fetchGroupPolicyAssignments).mockResolvedValue(
        policyAssignmentsResponse([policySummary({ id: 3, name: 'Security Baseline' })]),
      )
      const { wrapper } = await mountView()

      await wrapper.find('[data-testid=group-detail-policies-tab]').trigger('click')
      await flushPromises()

      expect(wrapper.findAll('[data-testid=group-policy-row]')).toHaveLength(1)
      expect(wrapper.find('[data-field=name]').text()).toBe('Security Baseline')
      expect(wrapper.find('[data-testid=group-policy-remove-button]').exists()).toBe(true)
    })

    it('shows "Group chưa được gán Policy nào." with a "+ Gán policy" CTA when empty', async () => {
      vi.mocked(fetchGroupPolicyAssignments).mockResolvedValue(policyAssignmentsResponse([]))
      const { wrapper } = await mountView()

      await wrapper.find('[data-testid=group-detail-policies-tab]').trigger('click')
      await flushPromises()

      expect(wrapper.find('[data-testid=empty-state]').text()).toContain('Group chưa được gán Policy nào.')
      expect(wrapper.findAll('[data-testid=group-policy-assign-button]')).toHaveLength(1)
    })

    it('shows the tab error independently, leaving the header/members tab unaffected', async () => {
      vi.mocked(fetchGroupPolicyAssignments).mockRejectedValueOnce({ response: { status: 500, data: {} } })
      const { wrapper } = await mountView()

      await wrapper.find('[data-testid=group-detail-policies-tab]').trigger('click')
      await flushPromises()

      expect(wrapper.find('[data-testid=error-banner]').exists()).toBe(true)
      expect(wrapper.find('[data-testid=group-detail-name]').text()).toBe('Sales Team')
    })

    it('assigns a policy: opens the modal, tracks the returned job, shows no toast (banner is the feedback)', async () => {
      vi.useFakeTimers()
      vi.mocked(fetchPolicyList).mockResolvedValue({
        policies: [{ id: 1, name: 'Security Baseline', type: 'wifi', configuration: {}, status: 'active', assignments_count: 0, created_at: '', updated_at: '' }],
        meta: { current_page: 1, per_page: 20, total_count: 1, total_pages: 1 },
      })
      vi.mocked(createGroupPolicyAssignment).mockResolvedValueOnce({ policy_assignment_job: job() })

      const { wrapper } = await mountView()
      await wrapper.find('[data-testid=group-detail-policies-tab]').trigger('click')
      await flushPromises()

      await wrapper.find('[data-testid=group-policy-assign-button]').trigger('click')
      await wrapper.find('[data-testid=group-policy-assign-search]').setValue('security')
      await vi.advanceTimersByTimeAsync(300)
      await wrapper.find('[data-testid=group-policy-assign-search-option]').trigger('click')
      await wrapper.find('form').trigger('submit')
      await flushPromises()

      expect(createGroupPolicyAssignment).toHaveBeenCalledWith(7, 1)
      expect(wrapper.find('[data-testid=group-policy-assign-modal]').exists()).toBe(false)
      expect(wrapper.find('[data-testid=async-job-banner]').exists()).toBe(true)
      expect(wrapper.find('[data-testid=toast]').exists()).toBe(false)
      vi.useRealTimers()
    })

    it('removes a policy through the confirm modal, toasts, and refetches the tab', async () => {
      vi.mocked(fetchGroupPolicyAssignments).mockResolvedValue(
        policyAssignmentsResponse([policySummary({ id: 3, name: 'Security Baseline' })]),
      )
      vi.mocked(deleteGroupPolicyAssignment).mockResolvedValueOnce(undefined)
      const { wrapper } = await mountView()
      await wrapper.find('[data-testid=group-detail-policies-tab]').trigger('click')
      await flushPromises()

      await wrapper.find('[data-testid=group-policy-remove-button]').trigger('click')
      expect(wrapper.find('[data-testid=confirm-modal]').text()).toContain(
        'Gỡ policy "Security Baseline" khỏi group "Sales Team"?',
      )

      vi.mocked(fetchGroupPolicyAssignments).mockResolvedValueOnce(policyAssignmentsResponse([]))
      await wrapper.find('[data-testid=confirm-modal-confirm]').trigger('click')
      await flushPromises()

      expect(deleteGroupPolicyAssignment).toHaveBeenCalledWith(7, 3)
      expect(wrapper.find('[data-testid=toast]').text()).toContain('Đã gỡ policy')
    })

    it('refetches the Policies tab as soon as a job for this group turns done, while the tab is active', async () => {
      vi.mocked(fetchGroupPolicyAssignmentJobs).mockResolvedValueOnce({
        policy_assignment_jobs: [job({ id: 11, status: 'running' })],
        meta: { current_page: 1, per_page: 20, total_count: 1, total_pages: 1 },
      })
      const { wrapper } = await mountView()
      await wrapper.find('[data-testid=group-detail-policies-tab]').trigger('click')
      await flushPromises()
      const callsBefore = vi.mocked(fetchGroupPolicyAssignments).mock.calls.length

      vi.mocked(fetchPolicyAssignmentJob).mockResolvedValueOnce({
        policy_assignment_job: job({ id: 11, status: 'done' }),
      })
      // Simulate the store's own poll tick landing — same store instance the
      // component reads from.
      const { useJobsStore } = await import('../../../stores/jobs')
      const jobsStore = useJobsStore()
      jobsStore.jobs = jobsStore.jobs.map((j) => (j.id === 11 ? job({ id: 11, status: 'done' }) : j))
      await flushPromises()
      await wrapper.vm.$nextTick()

      expect(vi.mocked(fetchGroupPolicyAssignments).mock.calls.length).toBe(callsBefore + 1)
    })

    it('does not refetch immediately when the Policies tab is not active, but forces a reload on the next visit', async () => {
      vi.mocked(fetchGroupPolicyAssignmentJobs).mockResolvedValueOnce({
        policy_assignment_jobs: [job({ id: 12, status: 'running' })],
        meta: { current_page: 1, per_page: 20, total_count: 1, total_pages: 1 },
      })
      const { wrapper } = await mountView()
      await wrapper.find('[data-testid=group-detail-policies-tab]').trigger('click')
      await flushPromises()
      // Leave the tab before the job finishes.
      await wrapper.find('[data-testid=group-detail-members-tab]').trigger('click')
      const callsBefore = vi.mocked(fetchGroupPolicyAssignments).mock.calls.length

      const { useJobsStore } = await import('../../../stores/jobs')
      const jobsStore = useJobsStore()
      jobsStore.jobs = jobsStore.jobs.map((j) => (j.id === 12 ? job({ id: 12, status: 'done' }) : j))
      await flushPromises()

      // Not fetched again right away (tab not active)...
      expect(vi.mocked(fetchGroupPolicyAssignments).mock.calls.length).toBe(callsBefore)

      // ...but re-selecting the tab loads fresh data instead of the cache.
      await wrapper.find('[data-testid=group-detail-policies-tab]').trigger('click')
      await flushPromises()
      expect(vi.mocked(fetchGroupPolicyAssignments).mock.calls.length).toBe(callsBefore + 1)
    })
  })
})
