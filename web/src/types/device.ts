/**
 * Shapes returned by `GET /api/v1/devices` — mirrors
 * docs/design/F2-api.md §1 exactly (no extra/renamed fields).
 */

export const DEVICE_PLATFORMS = ['ios', 'android', 'macos'] as const
export const DEVICE_STATUSES = ['active', 'inactive', 'retired'] as const

export type DevicePlatform = (typeof DEVICE_PLATFORMS)[number]
export type DeviceStatus = (typeof DEVICE_STATUSES)[number]

export interface Device {
  id: number
  identifier: string
  name: string
  platform: DevicePlatform
  os_version: string | null
  status: DeviceStatus
  last_seen_at: string | null
  created_at: string
  updated_at: string
}

export interface DeviceListMeta {
  current_page: number
  per_page: number
  total_count: number
  total_pages: number
}

export interface DeviceListResponse {
  devices: Device[]
  meta: DeviceListMeta
}

/** Query params the list view sends; `per_page` is intentionally absent (F2-frontend.md §5 OQ-FE-3). */
export interface DeviceQueryParams {
  platform?: DevicePlatform
  status?: DeviceStatus
  page: number
}

export function isDevicePlatform(value: unknown): value is DevicePlatform {
  return typeof value === 'string' && (DEVICE_PLATFORMS as readonly string[]).includes(value)
}

export function isDeviceStatus(value: unknown): value is DeviceStatus {
  return typeof value === 'string' && (DEVICE_STATUSES as readonly string[]).includes(value)
}
