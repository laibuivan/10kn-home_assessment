import { apiClient } from './client'
import type {
  GroupCreatePayload,
  GroupListResponse,
  GroupQueryParams,
  GroupResponse,
  GroupUpdatePayload,
} from '../types/group'

/**
 * The four `/api/v1/groups` endpoints — docs/design/F5-api.md §1, and no
 * more than four. There is deliberately **no** `fetchGroup(id)`: the API has
 * no `show` action (SoT F5 OQ-5), and the edit form prefills from the row
 * already in the store.
 *
 * Everything goes through the shared `apiClient` (Bearer token + the global
 * 401 -> /login redirect live there); no new axios instance.
 */

/** GET /api/v1/groups — axios drops `undefined` params, so an absent `q` simply means "all". */
export async function fetchGroupList(params: GroupQueryParams): Promise<GroupListResponse> {
  const response = await apiClient.get<GroupListResponse>('/api/v1/groups', { params })
  return response.data
}

/** POST /api/v1/groups — body is flat (no `{ group: {...} }` wrapper), per F5-api.md §0. */
export async function createGroup(payload: GroupCreatePayload): Promise<GroupResponse> {
  const response = await apiClient.post<GroupResponse>('/api/v1/groups', payload)
  return response.data
}

/** PATCH /api/v1/groups/:id — partial update, same flat body convention. */
export async function updateGroup(id: number, payload: GroupUpdatePayload): Promise<GroupResponse> {
  const response = await apiClient.patch<GroupResponse>(`/api/v1/groups/${id}`, payload)
  return response.data
}

/**
 * DELETE /api/v1/groups/:id — the API answers `204 No Content` with an empty
 * body (F5-api.md §2.4), so there is nothing to read off `response.data`.
 */
export async function deleteGroup(id: number): Promise<void> {
  await apiClient.delete(`/api/v1/groups/${id}`)
}
