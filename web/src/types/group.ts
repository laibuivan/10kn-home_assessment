/**
 * Shapes of `GET|POST|PATCH|DELETE /api/v1/groups` — mirrors
 * docs/design/F5-api.md §1/§2.5 exactly (no extra/renamed fields).
 */

import type { PaginationMeta } from './ui'
import type { DevicePlatform, DeviceStatus } from './device'

export interface Group {
  id: number
  name: string
  /** `null` when there is no description — the API never returns `""` (F5-api.md §2.5). */
  description: string | null
  /**
   * NEW at F6 — every Group response (index/show/create/update) carries it,
   * because the API has a single `serialize_group` (F6-api.md §1). Never
   * added to/subtracted from on the client: a mutation refetches and reads
   * the real count back (UI_UX_design.md §0.3).
   */
  devices_count: number
  created_at: string
  updated_at: string
}
// Still no `organization_id` (F5-api.md §2.5) — it is not in the contract,
// so it may not be typed here.

export interface GroupListResponse {
  groups: Group[]
  meta: PaginationMeta
}

/** Envelope shared by create/update — the resource is always wrapped in `group`. */
export interface GroupResponse {
  group: Group
}

/** Query params the list view sends; `per_page` is intentionally absent — the server default (20) applies. */
export interface GroupQueryParams {
  q?: string
  page: number
}

/**
 * Body for `POST /api/v1/groups` — flat, no `{ group: {...} }` wrapper, and
 * never `organization_id` (that always comes from the token — A22).
 * `description` is omitted entirely when the user left it blank.
 */
export interface GroupCreatePayload {
  name: string
  description?: string
}

/**
 * Body for `PATCH /api/v1/groups/:id`. Both fields are optional (PATCH is
 * partial), but the edit form always sends `description` — including `''`,
 * which is the only way to clear an existing description (F5-frontend.md §2).
 */
export interface GroupUpdatePayload {
  name?: string
  description?: string
}

/**
 * Query params for `GET /api/v1/groups/:id/devices` (F6-api.md §2.2) — kept
 * separate from `GroupQueryParams`: a different endpoint with a different
 * field set (device filters, no `q`), so sharing one type would let a caller
 * send `q` to an endpoint that ignores it.
 */
export interface GroupDevicesQueryParams {
  page: number
  platform?: DevicePlatform
  status?: DeviceStatus
}
