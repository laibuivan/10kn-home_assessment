import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import GroupPolicyAssignModal from '../GroupPolicyAssignModal.vue'
import { fetchPolicyList } from '../../api/policies'
import { createGroupPolicyAssignment } from '../../api/policyAssignments'
import type { Policy, PolicyListResponse } from '../../types/policy'

vi.mock('../../api/policies', () => ({
  fetchPolicyList: vi.fn(),
  fetchPolicy: vi.fn(),
  createPolicy: vi.fn(),
  updatePolicy: vi.fn(),
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

function policy(overrides: Partial<Policy> = {}): Policy {
  return {
    id: 1,
    name: 'Security Baseline',
    type: 'wifi',
    configuration: {},
    status: 'active',
    assignments_count: 0,
    created_at: '2026-09-17T08:00:00.000Z',
    updated_at: '2026-09-17T08:00:00.000Z',
    ...overrides,
  }
}

function listResponse(policies: Policy[]): PolicyListResponse {
  return { policies, meta: { current_page: 1, per_page: 20, total_count: policies.length, total_pages: 1 } }
}

function mountModal(assignedPolicyIds: number[] = []): VueWrapper {
  return mount(GroupPolicyAssignModal, { props: { groupId: 7, assignedPolicyIds } })
}

async function searchAndPick(wrapper: VueWrapper, term: string) {
  await wrapper.find('[data-testid=group-policy-assign-search]').setValue(term)
  await vi.advanceTimersByTimeAsync(300)
  await wrapper.find('[data-testid=group-policy-assign-search-option]').trigger('click')
}

describe('GroupPolicyAssignModal', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('searches with status=active only (5.1) — inactive policies never appear in results', async () => {
    vi.mocked(fetchPolicyList).mockResolvedValue(listResponse([policy()]))
    const wrapper = mountModal()

    await wrapper.find('[data-testid=group-policy-assign-search]').setValue('security')
    await vi.advanceTimersByTimeAsync(300)

    expect(fetchPolicyList).toHaveBeenCalledWith({ q: 'security', status: 'active', page: 1 })
  })

  it('disables submit until a policy is selected', async () => {
    vi.mocked(fetchPolicyList).mockResolvedValue(listResponse([policy()]))
    const wrapper = mountModal()

    expect(wrapper.find('[data-testid=group-policy-assign-submit]').attributes('disabled')).toBeDefined()

    await searchAndPick(wrapper, 'security')

    expect(wrapper.find('[data-testid=group-policy-assign-submit]').attributes('disabled')).toBeUndefined()
  })

  it('shows a non-blocking warning when the selected policy is already assigned (5.1)', async () => {
    vi.mocked(fetchPolicyList).mockResolvedValue(listResponse([policy({ id: 3 })]))
    const wrapper = mountModal([3])

    await searchAndPick(wrapper, 'security')

    expect(wrapper.find('[data-testid=group-policy-assign-duplicate-warning]').text()).toContain(
      'Policy này đã được gán cho group.',
    )
    expect(wrapper.find('[data-testid=group-policy-assign-submit]').attributes('disabled')).toBeUndefined()
  })

  it('submits and emits the job, without closing itself (parent decides)', async () => {
    vi.mocked(fetchPolicyList).mockResolvedValue(listResponse([policy({ id: 3 })]))
    vi.mocked(createGroupPolicyAssignment).mockResolvedValueOnce({
      policy_assignment_job: {
        id: 1,
        status: 'pending',
        total_count: 3,
        processed_count: 0,
        error_message: null,
        policy: { id: 3, name: 'Security Baseline' },
        group: { id: 7, name: 'Sales Team' },
        created_at: '',
        updated_at: '',
      },
    })
    const wrapper = mountModal()

    await searchAndPick(wrapper, 'security')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(createGroupPolicyAssignment).toHaveBeenCalledWith(7, 3)
    expect(wrapper.emitted('assigned')).toHaveLength(1)
  })

  it('shows the 422 base error (e.g. inactive) in the banner and keeps the modal open', async () => {
    vi.mocked(fetchPolicyList).mockResolvedValue(listResponse([policy({ id: 3 })]))
    vi.mocked(createGroupPolicyAssignment).mockRejectedValueOnce({
      response: { status: 422, data: { errors: { base: ['Chỉ gán được Policy đang active.'] } } },
    })
    const wrapper = mountModal()

    await searchAndPick(wrapper, 'security')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(wrapper.find('[data-testid=group-policy-assign-banner]').text()).toContain(
      'Chỉ gán được Policy đang active.',
    )
    expect(wrapper.emitted('assigned')).toBeUndefined()
  })

  it('emits cancel from the Hủy button', async () => {
    vi.mocked(fetchPolicyList).mockResolvedValue(listResponse([policy()]))
    const wrapper = mountModal()

    await wrapper.find('[data-testid=group-policy-assign-cancel]').trigger('click')

    expect(wrapper.emitted('cancel')).toHaveLength(1)
  })
})
