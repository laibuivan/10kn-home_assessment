import { apiClient } from './client'
import type {
  GroupCreatePayload,
  GroupListResponse,
  GroupQueryParams,
  GroupResponse,
  GroupUpdatePayload,
} from '../types/group'

/**
 * The `/api/v1/groups` endpoints — docs/design/F5-api.md §1 plus the `show`
 * action F6 added (F6-api.md §2.1). F5 deliberately had no `fetchGroup(id)`
 * because there was no group detail page yet (SoT F5 OQ-5); F6 introduces
 * `/groups/:id`, which needs the header straight from the API rather than
 * from a list row that may not be in the store at all (deep link, reload).
 *
 * Everything goes through the shared `apiClient` (Bearer token + the global
 * 401 -> /login redirect live there); no new axios instance.
 */

/** GET /api/v1/groups — axios drops `undefined` params, so an absent `q` simply means "all". */
export async function fetchGroupList(params: GroupQueryParams): Promise<GroupListResponse> {
  const response = await apiClient.get<GroupListResponse>('/api/v1/groups', { params })
  return response.data
}

/** GET /api/v1/groups/:id — new at F6. Same `{ group }` envelope as create/update, so `GroupResponse` is reused as-is. */
export async function fetchGroup(id: number | string): Promise<GroupResponse> {
  const response = await apiClient.get<GroupResponse>(`/api/v1/groups/${id}`)
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
