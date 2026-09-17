import { apiClient } from './client'
import type { PaginationMeta } from '../types/ui'
import type { GroupSummary, PolicySummary } from '../types/policyAssignment'
import type {
  PolicyAssignmentJobListResponse,
  PolicyAssignmentJobResponse,
  PolicyAssignmentJobStatus,
} from '../types/policyAssignmentJob'
import type { Device } from '../types/device'

/**
 * F8's 5 new controllers — docs/design/F8-api.md §1. Goes through the shared
 * `apiClient` (Bearer token + the global 401 -> /login redirect live there);
 * no new axios instance, and every body is sent flat (project-wide
 * convention, F0-api.md §0).
 */

// ---------- Group -> Policy (Group Detail tab Policies; Policy Detail tab Group calls the reverse) ----------

/** GET /api/v1/groups/:id/policy_assignments */
export async function fetchGroupPolicyAssignments(
  groupId: number,
  params: { page: number },
): Promise<{ policies: PolicySummary[]; meta: PaginationMeta }> {
  const response = await apiClient.get<{ policies: PolicySummary[]; meta: PaginationMeta }>(
    `/api/v1/groups/${groupId}/policy_assignments`,
    { params },
  )
  return response.data
}

/** POST /api/v1/groups/:id/policy_assignments — 202, always (new job or deduped existing one). */
export async function createGroupPolicyAssignment(
  groupId: number,
  policyId: number,
): Promise<PolicyAssignmentJobResponse> {
  const response = await apiClient.post<PolicyAssignmentJobResponse>(
    `/api/v1/groups/${groupId}/policy_assignments`,
    { policy_id: policyId },
  )
  return response.data
}

/**
 * DELETE /api/v1/groups/:id/policy_assignments/:policy_id — 204. Shared by
 * both entry points that gỡ Group<->Policy (Group Detail tab Policies, and
 * Policy Detail tab Group calling with the arguments swapped) — F8-api.md
 * has no symmetric `/policies/:id/group_assignments/:group_id` DELETE
 * (docs/design/F8-frontend.md §2.2).
 */
export async function deleteGroupPolicyAssignment(groupId: number, policyId: number): Promise<void> {
  await apiClient.delete(`/api/v1/groups/${groupId}/policy_assignments/${policyId}`)
}

// ---------- Job re-attach / poll ----------

/**
 * GET /api/v1/groups/:id/policy_assignment_jobs — `status` (when present) is
 * joined with `,` (F8-api.md §2.7/§6), not sent as `status[]=`.
 */
export async function fetchGroupPolicyAssignmentJobs(
  groupId: number,
  params: { status?: PolicyAssignmentJobStatus[]; page?: number },
): Promise<PolicyAssignmentJobListResponse> {
  const response = await apiClient.get<PolicyAssignmentJobListResponse>(
    `/api/v1/groups/${groupId}/policy_assignment_jobs`,
    { params: { status: params.status?.join(','), page: params.page } },
  )
  return response.data
}

/** GET /api/v1/policy_assignment_jobs/:id — polled every ~2s by `stores/jobs.ts`. */
export async function fetchPolicyAssignmentJob(jobId: number): Promise<PolicyAssignmentJobResponse> {
  const response = await apiClient.get<PolicyAssignmentJobResponse>(
    `/api/v1/policy_assignment_jobs/${jobId}`,
  )
  return response.data
}

// ---------- Policy -> Device (synchronous, bounded) ----------

/** GET /api/v1/policies/:id/device_assignments */
export async function fetchPolicyDeviceAssignments(
  policyId: number,
  params: { page: number },
): Promise<{ devices: Device[]; meta: PaginationMeta }> {
  const response = await apiClient.get<{ devices: Device[]; meta: PaginationMeta }>(
    `/api/v1/policies/${policyId}/device_assignments`,
    { params },
  )
  return response.data
}

/** POST /api/v1/policies/:id/device_assignments — 201, synchronous (no job). */
export async function createPolicyDeviceAssignment(
  policyId: number,
  deviceId: number,
): Promise<{ device: Device }> {
  const response = await apiClient.post<{ device: Device }>(
    `/api/v1/policies/${policyId}/device_assignments`,
    { device_id: deviceId },
  )
  return response.data
}

/** DELETE /api/v1/policies/:id/device_assignments/:device_id — 204. */
export async function deletePolicyDeviceAssignment(policyId: number, deviceId: number): Promise<void> {
  await apiClient.delete(`/api/v1/policies/${policyId}/device_assignments/${deviceId}`)
}

// ---------- Policy -> Group (read only — Policy Detail tab Group) ----------

/** GET /api/v1/policies/:id/group_assignments */
export async function fetchPolicyGroupAssignments(
  policyId: number,
  params: { page: number },
): Promise<{ groups: GroupSummary[]; meta: PaginationMeta }> {
  const response = await apiClient.get<{ groups: GroupSummary[]; meta: PaginationMeta }>(
    `/api/v1/policies/${policyId}/group_assignments`,
    { params },
  )
  return response.data
}
