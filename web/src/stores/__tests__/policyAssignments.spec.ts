import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { usePolicyAssignmentsStore } from '../policyAssignments'
import {
  fetchGroupPolicyAssignments,
  createGroupPolicyAssignment,
  deleteGroupPolicyAssignment,
  fetchPolicyGroupAssignments,
  fetchPolicyDeviceAssignments,
  createPolicyDeviceAssignment,
  deletePolicyDeviceAssignment,
} from '../../api/policyAssignments'
import type { PolicySummary, GroupSummary } from '../../types/policyAssignment'
import type { Device } from '../../types/device'

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

function policySummary(overrides: Partial<PolicySummary> = {}): PolicySummary {
  return { id: 1, name: 'Security Baseline', type: 'wifi', status: 'active', ...overrides }
}

function groupSummary(overrides: Partial<GroupSummary> = {}): GroupSummary {
  return { id: 1, name: 'Sales Team', ...overrides }
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

describe('usePolicyAssignmentsStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('starts with 3 independent, empty slices', () => {
    const store = usePolicyAssignmentsStore()

    for (const slice of [store.groupPolicies, store.policyGroups, store.policyDevices]) {
      expect(slice.items).toEqual([])
      expect(slice.meta).toBeNull()
      expect(slice.loading).toBe(false)
      expect(slice.error).toBeNull()
    }
  })

  describe('slice independence', () => {
    it('loading one slice does not touch the other two', async () => {
      let resolveFetch!: (value: { policies: PolicySummary[]; meta: never }) => void
      vi.mocked(fetchGroupPolicyAssignments).mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFetch = resolve as never
        }),
      )
      const store = usePolicyAssignmentsStore()

      const pending = store.fetchGroupPolicies(7, { page: 1 })
      expect(store.groupPolicies.loading).toBe(true)
      expect(store.policyGroups.loading).toBe(false)
      expect(store.policyDevices.loading).toBe(false)

      resolveFetch({
        policies: [],
        meta: { current_page: 1, per_page: 20, total_count: 0, total_pages: 0 } as never,
      })
      await pending
    })
  })

  describe('fetchGroupPolicies', () => {
    it('stores the policies and meta on success', async () => {
      vi.mocked(fetchGroupPolicyAssignments).mockResolvedValueOnce({
        policies: [policySummary()],
        meta: { current_page: 1, per_page: 20, total_count: 1, total_pages: 1 },
      })
      const store = usePolicyAssignmentsStore()

      await store.fetchGroupPolicies(7, { page: 1 })

      expect(fetchGroupPolicyAssignments).toHaveBeenCalledWith(7, { page: 1 })
      expect(store.groupPolicies.items).toHaveLength(1)
      expect(store.groupPolicies.meta?.total_count).toBe(1)
      expect(store.groupPolicies.loading).toBe(false)
    })

    it('keeps stale rows and sets an error on failure (no blank table)', async () => {
      vi.mocked(fetchGroupPolicyAssignments).mockResolvedValueOnce({
        policies: [policySummary({ id: 9 })],
        meta: { current_page: 1, per_page: 20, total_count: 1, total_pages: 1 },
      })
      const store = usePolicyAssignmentsStore()
      await store.fetchGroupPolicies(7, { page: 1 })

      vi.mocked(fetchGroupPolicyAssignments).mockRejectedValueOnce({ response: { status: 500, data: {} } })
      await store.fetchGroupPolicies(7, { page: 2 })

      expect(store.groupPolicies.items).toHaveLength(1)
      expect(store.groupPolicies.items[0].id).toBe(9)
      expect(store.groupPolicies.error).toBe('Không tải được danh sách policy đang gán cho group.')
    })
  })

  describe('assignPolicyToGroup / unassignPolicyFromGroup', () => {
    it('assign returns the job and does NOT write into groupPolicies (§2.4 — only real after done)', async () => {
      vi.mocked(createGroupPolicyAssignment).mockResolvedValueOnce({
        policy_assignment_job: {
          id: 1,
          status: 'pending',
          total_count: 3,
          processed_count: 0,
          error_message: null,
          policy: { id: 1, name: 'Security Baseline' },
          group: { id: 7, name: 'Sales Team' },
          created_at: '',
          updated_at: '',
        },
      })
      const store = usePolicyAssignmentsStore()

      const job = await store.assignPolicyToGroup(7, 1)

      expect(createGroupPolicyAssignment).toHaveBeenCalledWith(7, 1)
      expect(job.id).toBe(1)
      expect(store.groupPolicies.items).toEqual([])
    })

    it('assign rethrows the error unmodified, without touching store loading/error', async () => {
      const error = { response: { status: 422, data: { errors: { base: ['Chỉ gán được Policy đang active.'] } } } }
      vi.mocked(createGroupPolicyAssignment).mockRejectedValueOnce(error)
      const store = usePolicyAssignmentsStore()

      await expect(store.assignPolicyToGroup(7, 1)).rejects.toEqual(error)
      expect(store.groupPolicies.loading).toBe(false)
      expect(store.groupPolicies.error).toBeNull()
    })

    it('unassign calls the API with (groupId, policyId) and does not touch groupPolicies itself', async () => {
      vi.mocked(deleteGroupPolicyAssignment).mockResolvedValueOnce(undefined)
      const store = usePolicyAssignmentsStore()

      await store.unassignPolicyFromGroup(7, 1)

      expect(deleteGroupPolicyAssignment).toHaveBeenCalledWith(7, 1)
    })
  })

  describe('fetchPolicyGroups', () => {
    it('stores groups and meta on success', async () => {
      vi.mocked(fetchPolicyGroupAssignments).mockResolvedValueOnce({
        groups: [groupSummary()],
        meta: { current_page: 1, per_page: 20, total_count: 1, total_pages: 1 },
      })
      const store = usePolicyAssignmentsStore()

      await store.fetchPolicyGroups(1, { page: 1 })

      expect(fetchPolicyGroupAssignments).toHaveBeenCalledWith(1, { page: 1 })
      expect(store.policyGroups.items).toHaveLength(1)
    })
  })

  describe('fetchPolicyDevices', () => {
    it('stores devices and meta on success', async () => {
      vi.mocked(fetchPolicyDeviceAssignments).mockResolvedValueOnce({
        devices: [device()],
        meta: { current_page: 1, per_page: 20, total_count: 1, total_pages: 1 },
      })
      const store = usePolicyAssignmentsStore()

      await store.fetchPolicyDevices(1, { page: 1 })

      expect(fetchPolicyDeviceAssignments).toHaveBeenCalledWith(1, { page: 1 })
      expect(store.policyDevices.items).toHaveLength(1)
    })
  })

  describe('assignDeviceToPolicy / unassignDeviceFromPolicy', () => {
    it('assign returns the device (synchronous, no job)', async () => {
      vi.mocked(createPolicyDeviceAssignment).mockResolvedValueOnce({ device: device({ id: 42 }) })
      const store = usePolicyAssignmentsStore()

      const result = await store.assignDeviceToPolicy(1, 42)

      expect(createPolicyDeviceAssignment).toHaveBeenCalledWith(1, 42)
      expect(result.id).toBe(42)
    })

    it('assign rethrows the error unmodified', async () => {
      const error = { response: { status: 422, data: { errors: { base: ['Thiết bị đã retired, không thể gán policy trực tiếp.'] } } } }
      vi.mocked(createPolicyDeviceAssignment).mockRejectedValueOnce(error)
      const store = usePolicyAssignmentsStore()

      await expect(store.assignDeviceToPolicy(1, 42)).rejects.toEqual(error)
      expect(store.policyDevices.error).toBeNull()
    })

    it('unassign calls the API with (policyId, deviceId)', async () => {
      vi.mocked(deletePolicyDeviceAssignment).mockResolvedValueOnce(undefined)
      const store = usePolicyAssignmentsStore()

      await store.unassignDeviceFromPolicy(1, 42)

      expect(deletePolicyDeviceAssignment).toHaveBeenCalledWith(1, 42)
    })
  })
})
