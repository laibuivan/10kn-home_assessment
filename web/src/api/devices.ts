import { apiClient } from './client'
import type {
  Device,
  DeviceCreatePayload,
  DeviceDetail,
  DeviceListResponse,
  DeviceQueryParams,
  DeviceUpdatePayload,
} from '../types/device'
import type { AppliedPoliciesResponse } from '../types/appliedPolicy'

/**
 * GET /api/v1/devices — docs/design/F2-api.md §1.
 *
 * Reuses the shared `apiClient` (auth header + 401 handling live there); no
 * `per_page` is ever sent, F2 has no page-size control so the server default
 * (20) applies (F2-frontend.md §5 OQ-FE-3). Axios drops `undefined` params,
 * so an absent filter simply means "all".
 */
export async function fetchDeviceList(params: DeviceQueryParams): Promise<DeviceListResponse> {
  const response = await apiClient.get<DeviceListResponse>('/api/v1/devices', { params })
  return response.data
}

/** Response envelope shared by show/create/update — F3-api.md §0/F4-api.md §0: resource always wrapped in `device`. */
export interface DeviceResponse {
  device: Device
}

/**
 * The detail endpoint's own envelope — same `device` key, but the payload
 * carries `groups` (F6-api.md §2.6), which `index`/`create`/`update` do not.
 */
export interface DeviceDetailResponse {
  device: DeviceDetail
}

/** GET /api/v1/devices/:id — docs/design/F4-api.md §1 + F6-api.md §2.6. `id` is passed through as-is (route params are always strings). */
export async function fetchDevice(id: number | string): Promise<DeviceDetailResponse> {
  const response = await apiClient.get<DeviceDetailResponse>(`/api/v1/devices/${id}`)
  return response.data
}

/**
 * POST /api/v1/devices — docs/design/F3-api.md §1. Body is sent flat (no
 * `{ device: {...} }` wrapper), matching the project-wide convention.
 */
export async function createDevice(payload: DeviceCreatePayload): Promise<DeviceResponse> {
  const response = await apiClient.post<DeviceResponse>('/api/v1/devices', payload)
  return response.data
}

/** PATCH /api/v1/devices/:id — docs/design/F3-api.md §1. */
export async function updateDevice(id: number, payload: DeviceUpdatePayload): Promise<DeviceResponse> {
  const response = await apiClient.patch<DeviceResponse>(`/api/v1/devices/${id}`, payload)
  return response.data
}

/**
 * GET /api/v1/devices/:id/applied_policies — docs/design/F9-api.md §1.
 * Tách khỏi `fetchDevice` có chủ đích (OQ-2) — endpoint riêng cho khối
 * "Policy đang áp dụng" có loading/error độc lập (F9-frontend.md §3.1).
 */
export async function fetchAppliedPolicies(deviceId: number | string): Promise<AppliedPoliciesResponse> {
  const response = await apiClient.get<AppliedPoliciesResponse>(`/api/v1/devices/${deviceId}/applied_policies`)
  return response.data
}
