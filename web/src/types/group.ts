/**
 * Shapes of `GET|POST|PATCH|DELETE /api/v1/groups` — mirrors
 * docs/design/F5-api.md §1/§2.5 exactly (no extra/renamed fields).
 */

import type { PaginationMeta } from './ui'

export interface Group {
  id: number
  name: string
  /** `null` when there is no description — the API never returns `""` (F5-api.md §2.5). */
  description: string | null
  created_at: string
  updated_at: string
}
// No `devices_count` (SoT F5 OQ-4) and no `organization_id` (F5-api.md
// §2.5) — neither is in the contract, so neither may be typed here.

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
