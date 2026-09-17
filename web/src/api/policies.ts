import { apiClient } from './client'
import type {
  PolicyCreatePayload,
  PolicyListResponse,
  PolicyQueryParams,
  PolicyResponse,
  PolicyUpdatePayload,
} from '../types/policy'

/**
 * The `/api/v1/policies` endpoints — docs/design/F7-api.md §1 plus the
 * `show` action F8 reopens (F8-api.md §1, F7 OQ-7). There is still no
 * `destroy` route (SoT OQ-2) — Policy has no delete flow.
 *
 * Goes through the shared `apiClient` (Bearer token + the global 401 ->
 * /login redirect live there); no new axios instance.
 */

/** GET /api/v1/policies — axios drops `undefined` params, so an absent `q`/`status` simply means "all". */
export async function fetchPolicyList(params: PolicyQueryParams): Promise<PolicyListResponse> {
  const response = await apiClient.get<PolicyListResponse>('/api/v1/policies', { params })
  return response.data
}

/**
 * GET /api/v1/policies/:id — new at F8 (F7 OQ-7). Not routed through Pinia:
 * `PolicyDetailView` fetches straight into a local `ref`, the same call
 * `GroupDetailView` makes for `fetchGroup` (1 record needs no global store).
 */
export async function fetchPolicy(id: number | string): Promise<PolicyResponse> {
  const response = await apiClient.get<PolicyResponse>(`/api/v1/policies/${id}`)
  return response.data
}

/** POST /api/v1/policies — body is flat (no `{ policy: {...} }` wrapper), per F7-api.md §0. */
export async function createPolicy(payload: PolicyCreatePayload): Promise<PolicyResponse> {
  const response = await apiClient.post<PolicyResponse>('/api/v1/policies', payload)
  return response.data
}

/**
 * PATCH /api/v1/policies/:id — partial update, same flat body convention.
 * Used both by `PolicyFormModal` (all 4 fields) and by
 * `PolicyListView.toggleStatus` (`status` only).
 */
export async function updatePolicy(id: number, payload: PolicyUpdatePayload): Promise<PolicyResponse> {
  const response = await apiClient.patch<PolicyResponse>(`/api/v1/policies/${id}`, payload)
  return response.data
}
