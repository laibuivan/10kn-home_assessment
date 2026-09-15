import { apiClient } from './client'
import type { DeviceListResponse, DeviceQueryParams } from '../types/device'

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
