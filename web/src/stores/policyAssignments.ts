import { defineStore } from 'pinia'
import {
  createPolicyDeviceAssignment,
  createGroupPolicyAssignment,
  deleteGroupPolicyAssignment,
  deletePolicyDeviceAssignment,
  fetchGroupPolicyAssignments,
  fetchPolicyDeviceAssignments,
  fetchPolicyGroupAssignments,
} from '../api/policyAssignments'
import { extractErrorMessage } from '../utils/apiError'
import type { GroupSummary, PolicySummary } from '../types/policyAssignment'
import type { PolicyAssignmentJob } from '../types/policyAssignmentJob'
import type { Device } from '../types/device'
import type { PaginationMeta } from '../types/ui'

const GROUP_POLICIES_LOAD_ERROR = 'Không tải được danh sách policy đang gán cho group.'
const POLICY_GROUPS_LOAD_ERROR = 'Không tải được danh sách group đang gán policy này.'
const POLICY_DEVICES_LOAD_ERROR = 'Không tải được danh sách device đang gán policy này.'

interface ListSlice<T> {
  items: T[]
  meta: PaginationMeta | null
  loading: boolean
  error: string | null
  /** Monotonic id of the most recent request; older responses are discarded. */
  lastRequestId: number
}

function emptySlice<T>(): ListSlice<T> {
  return { items: [], meta: null, loading: false, error: null, lastRequestId: 0 }
}

interface PolicyAssignmentsState {
  /** GroupDetailView tab Policies — policies currently assigned to 1 group. */
  groupPolicies: ListSlice<PolicySummary>
  /** PolicyDetailView tab Group — groups currently assigned 1 policy. */
  policyGroups: ListSlice<GroupSummary>
  /** PolicyDetailView tab Device — devices directly assigned 1 policy. */
  policyDevices: ListSlice<Device>
}

/**
 * F8's "cross" lists — docs/design/F8-frontend.md §3.6. 3 independent
 * slices, each with its own `loading`/`error`/`meta` (not one shared
 * `loading` for all 3): Policy Detail's 2 tabs can be in 2 different states
 * at once (Group tab already loaded, Device tab loading for the first
 * time), and Group Detail's tab is a third, wholly unrelated screen.
 *
 * `assign*`/`unassign*` mutations own no store-level `loading`/`error` —
 * same principle as every other mutation in this app (F3 onward): a single
 * submission's state belongs to the component that triggered it, and the
 * error is rethrown untouched so the caller can map a 422 to its own field.
 */
export const usePolicyAssignmentsStore = defineStore('policy-assignments', {
  state: (): PolicyAssignmentsState => ({
    groupPolicies: emptySlice<PolicySummary>(),
    policyGroups: emptySlice<GroupSummary>(),
    policyDevices: emptySlice<Device>(),
  }),

  actions: {
    async fetchGroupPolicies(groupId: number, params: { page: number }): Promise<void> {
      const requestId = ++this.groupPolicies.lastRequestId
      this.groupPolicies.loading = true
      try {
        const response = await fetchGroupPolicyAssignments(groupId, params)
        if (requestId !== this.groupPolicies.lastRequestId) return
        this.groupPolicies.items = response.policies
        this.groupPolicies.meta = response.meta
        this.groupPolicies.error = null
      } catch (error) {
        if (requestId !== this.groupPolicies.lastRequestId) return
        this.groupPolicies.error = extractErrorMessage(error, GROUP_POLICIES_LOAD_ERROR)
      } finally {
        if (requestId === this.groupPolicies.lastRequestId) this.groupPolicies.loading = false
      }
    },

    /**
     * Returns the job so the caller (`GroupPolicyAssignModal`/
     * `PolicyGroupAssignModal`) can `jobsStore.track(job)` — this does NOT
     * write into `groupPolicies`: the assignment only really exists once the
     * job reaches `done` (§2.4).
     */
    async assignPolicyToGroup(groupId: number, policyId: number): Promise<PolicyAssignmentJob> {
      const response = await createGroupPolicyAssignment(groupId, policyId)
      return response.policy_assignment_job
    },

    async unassignPolicyFromGroup(groupId: number, policyId: number): Promise<void> {
      await deleteGroupPolicyAssignment(groupId, policyId)
    },

    async fetchPolicyGroups(policyId: number, params: { page: number }): Promise<void> {
      const requestId = ++this.policyGroups.lastRequestId
      this.policyGroups.loading = true
      try {
        const response = await fetchPolicyGroupAssignments(policyId, params)
        if (requestId !== this.policyGroups.lastRequestId) return
        this.policyGroups.items = response.groups
        this.policyGroups.meta = response.meta
        this.policyGroups.error = null
      } catch (error) {
        if (requestId !== this.policyGroups.lastRequestId) return
        this.policyGroups.error = extractErrorMessage(error, POLICY_GROUPS_LOAD_ERROR)
      } finally {
        if (requestId === this.policyGroups.lastRequestId) this.policyGroups.loading = false
      }
    },

    async fetchPolicyDevices(policyId: number, params: { page: number }): Promise<void> {
      const requestId = ++this.policyDevices.lastRequestId
      this.policyDevices.loading = true
      try {
        const response = await fetchPolicyDeviceAssignments(policyId, params)
        if (requestId !== this.policyDevices.lastRequestId) return
        this.policyDevices.items = response.devices
        this.policyDevices.meta = response.meta
        this.policyDevices.error = null
      } catch (error) {
        if (requestId !== this.policyDevices.lastRequestId) return
        this.policyDevices.error = extractErrorMessage(error, POLICY_DEVICES_LOAD_ERROR)
      } finally {
        if (requestId === this.policyDevices.lastRequestId) this.policyDevices.loading = false
      }
    },

    /** Synchronous (201, no job) — the caller refetches `policyDevices` itself on success. */
    async assignDeviceToPolicy(policyId: number, deviceId: number): Promise<Device> {
      const response = await createPolicyDeviceAssignment(policyId, deviceId)
      return response.device
    },

    async unassignDeviceFromPolicy(policyId: number, deviceId: number): Promise<void> {
      await deletePolicyDeviceAssignment(policyId, deviceId)
    },
  },
})
