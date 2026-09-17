import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import PolicyGroupAssignModal from '../PolicyGroupAssignModal.vue'
import { fetchGroupList } from '../../api/groups'
import { createGroupPolicyAssignment } from '../../api/policyAssignments'
import type { Group, GroupListResponse } from '../../types/group'

vi.mock('../../api/groups', () => ({
  fetchGroupList: vi.fn(),
  fetchGroup: vi.fn(),
  createGroup: vi.fn(),
  updateGroup: vi.fn(),
  deleteGroup: vi.fn(),
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

function group(overrides: Partial<Group> = {}): Group {
  return {
    id: 1,
    name: 'Sales Team',
    description: null,
    devices_count: 3,
    created_at: '2026-09-17T08:00:00.000Z',
    updated_at: '2026-09-17T08:00:00.000Z',
    ...overrides,
  }
}

function listResponse(groups: Group[]): GroupListResponse {
  return { groups, meta: { current_page: 1, per_page: 20, total_count: groups.length, total_pages: 1 } }
}

function mountModal(assignedGroupIds: number[] = []): VueWrapper {
  return mount(PolicyGroupAssignModal, {
    props: { policyId: 5, policyName: 'Security Baseline', assignedGroupIds },
  })
}

async function searchAndPick(wrapper: VueWrapper, term: string) {
  await wrapper.find('[data-testid=policy-group-assign-search]').setValue(term)
  await vi.advanceTimersByTimeAsync(300)
  await wrapper.find('[data-testid=policy-group-assign-search-option]').trigger('click')
}

describe('PolicyGroupAssignModal', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('searches Group with no status filter — Group has no status field', async () => {
    vi.mocked(fetchGroupList).mockResolvedValue(listResponse([group()]))
    const wrapper = mountModal()

    await wrapper.find('[data-testid=policy-group-assign-search]').setValue('sales')
    await vi.advanceTimersByTimeAsync(300)

    expect(fetchGroupList).toHaveBeenCalledWith({ q: 'sales', page: 1 })
  })

  it('shows a non-blocking warning naming the policy when the group is already assigned (5.1)', async () => {
    vi.mocked(fetchGroupList).mockResolvedValue(listResponse([group({ id: 4 })]))
    const wrapper = mountModal([4])

    await searchAndPick(wrapper, 'sales')

    expect(wrapper.find('[data-testid=policy-group-assign-duplicate-warning]').text()).toContain(
      'Group này đã được gán Policy "Security Baseline".',
    )
  })

  it('submits with (groupId, policyId) — arguments swapped vs. GroupPolicyAssignModal', async () => {
    vi.mocked(fetchGroupList).mockResolvedValue(listResponse([group({ id: 4 })]))
    vi.mocked(createGroupPolicyAssignment).mockResolvedValueOnce({
      policy_assignment_job: {
        id: 1,
        status: 'pending',
        total_count: 3,
        processed_count: 0,
        error_message: null,
        policy: { id: 5, name: 'Security Baseline' },
        group: { id: 4, name: 'Sales Team' },
        created_at: '',
        updated_at: '',
      },
    })
    const wrapper = mountModal()

    await searchAndPick(wrapper, 'sales')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(createGroupPolicyAssignment).toHaveBeenCalledWith(4, 5)
    expect(wrapper.emitted('assigned')).toHaveLength(1)
  })

  it('shows the 422 base error in the banner and keeps the modal open', async () => {
    vi.mocked(fetchGroupList).mockResolvedValue(listResponse([group({ id: 4 })]))
    vi.mocked(createGroupPolicyAssignment).mockRejectedValueOnce({
      response: { status: 422, data: { errors: { base: ['Chỉ gán được Policy đang active.'] } } },
    })
    const wrapper = mountModal()

    await searchAndPick(wrapper, 'sales')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(wrapper.find('[data-testid=policy-group-assign-banner]').text()).toContain(
      'Chỉ gán được Policy đang active.',
    )
  })

  it('emits cancel from the Hủy button', async () => {
    vi.mocked(fetchGroupList).mockResolvedValue(listResponse([group()]))
    const wrapper = mountModal()

    await wrapper.find('[data-testid=policy-group-assign-cancel]').trigger('click')

    expect(wrapper.emitted('cancel')).toHaveLength(1)
  })
})
