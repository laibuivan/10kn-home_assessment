import { apiClient } from './client'
import type { DeviceListResponse } from '../types/device'
import type { GroupDevicesQueryParams } from '../types/group'

/**
 * The `groups/:id/devices` sub-resource — docs/design/F6-api.md §2.2–§2.4.
 *
 * Its own file rather than a few more functions in `api/groups.ts` /
 * `api/devices.ts`: the backend serves it from a dedicated controller
 * (`GroupDevicesController`), and this project keeps one FE api module per
 * BE controller (F6-frontend.md §3.4). Everything still goes through the
 * shared `apiClient`, so the Bearer token and the global 401 -> /login
 * redirect apply unchanged.
 */

/** Flat (unwrapped) response of `POST /api/v1/groups/:id/devices` — F6-api.md §0. */
export interface AddGroupDevicesResponse {
  added_count: number
  devices_count: number
}

/** GET /api/v1/groups/:id/devices — same `{ devices, meta }` envelope as the devices list. */
export async function fetchGroupDevices(
  groupId: number | string,
  params: GroupDevicesQueryParams,
): Promise<DeviceListResponse> {
  const response = await apiClient.get<DeviceListResponse>(`/api/v1/groups/${groupId}/devices`, {
    params,
  })
  return response.data
}

/**
 * POST /api/v1/groups/:id/devices — flat body `{ device_ids }`.
 *
 * Idempotent server-side (`upsert_all ... on_duplicate: :skip`), so re-sending
 * a device that is already a member is a 200 that simply does not move
 * `added_count` (F6-api.md §2.3, A6/A7). No client-side cap on the array:
 * the 500-id limit is the server's contract and must be allowed to answer
 * with a real 422 (F6-frontend.md §2.4 point 8).
 */
export async function addGroupDevices(
  groupId: number | string,
  deviceIds: number[],
): Promise<AddGroupDevicesResponse> {
  const response = await apiClient.post<AddGroupDevicesResponse>(
    `/api/v1/groups/${groupId}/devices`,
    { device_ids: deviceIds },
  )
  return response.data
}

/** DELETE /api/v1/groups/:id/devices/:device_id — answers `204 No Content`, so there is nothing to read off `response.data`. */
export async function removeGroupDevice(
  groupId: number | string,
  deviceId: number,
): Promise<void> {
  await apiClient.delete(`/api/v1/groups/${groupId}/devices/${deviceId}`)
}
