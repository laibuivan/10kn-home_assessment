/**
 * Shapes returned by `GET /api/v1/devices` — mirrors
 * docs/design/F2-api.md §1 exactly (no extra/renamed fields).
 */

import type { PaginationMeta } from './ui'

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

/**
 * The device list's `meta` is the project-wide pagination envelope — kept
 * under its original name so every existing import keeps working, while
 * there is only one definition of the shape (F5-frontend.md §5 OQ-FE-2).
 */
export type DeviceListMeta = PaginationMeta

export interface DeviceListResponse {
  devices: Device[]
  meta: DeviceListMeta
}

/** Query params the list view sends; `per_page` is intentionally absent (F2-frontend.md §5 OQ-FE-3). */
export interface DeviceQueryParams {
  platform?: DevicePlatform
  status?: DeviceStatus
  /**
   * NEW at F6 — free-text search over identifier/name (F6-api.md §2.5).
   * Only `AsyncSearchSelect`'s device fetcher sends it; `DeviceListView` is
   * deliberately unchanged and grows no search box (SoT F6 OQ-7).
   */
  q?: string
  page: number
}

/** One Group in a device's "Groups đang thuộc" block — `{ id, name }` only (F6-api.md §2.6). */
export interface DeviceGroupRef {
  id: number
  name: string
}

/**
 * The real shape of `GET /api/v1/devices/:id` (F6-api.md §2.6): a Device
 * plus the groups it belongs to, embedded in the same response. Only the
 * detail endpoint returns `groups` — list/create/update keep returning a
 * bare `Device`, so they must not be typed with this.
 */
export interface DeviceDetail extends Device {
  groups: DeviceGroupRef[]
}

/**
 * Body for `POST /api/v1/devices` — mirrors the `create_params` strong
 * params exactly (F3-api.md §1/§2.1): no `status`, no `organization_id`, the
 * server always ignores/defaults those regardless of what is sent.
 */
export interface DeviceCreatePayload {
  identifier: string
  name: string
  platform: DevicePlatform
  os_version?: string
}

/**
 * Body for `PATCH /api/v1/devices/:id` — mirrors `update_params` exactly
 * (F3-api.md §1/§2.2): no `identifier`, no `organization_id` — both are
 * immutable from the client's perspective.
 */
export interface DeviceUpdatePayload {
  name?: string
  platform?: DevicePlatform
  os_version?: string
  status?: DeviceStatus
}

export function isDevicePlatform(value: unknown): value is DevicePlatform {
  return typeof value === 'string' && (DEVICE_PLATFORMS as readonly string[]).includes(value)
}

export function isDeviceStatus(value: unknown): value is DeviceStatus {
  return typeof value === 'string' && (DEVICE_STATUSES as readonly string[]).includes(value)
}
