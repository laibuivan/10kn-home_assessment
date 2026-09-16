import { apiClient } from './client'
import type {
  Device,
  DeviceCreatePayload,
  DeviceListResponse,
  DeviceQueryParams,
  DeviceUpdatePayload,
} from '../types/device'

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

/** Response envelope shared by create/update — F3-api.md §0: resource always wrapped in `device`. */
interface DeviceResponse {
  device: Device
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
