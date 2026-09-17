/**
 * Shapes of `GET|POST|PATCH /api/v1/policies` — mirrors
 * docs/design/F7-api.md §2.7 exactly (no extra/renamed fields).
 */

import type { PaginationMeta } from './ui'

export const POLICY_STATUSES = ['active', 'inactive'] as const
export type PolicyStatus = (typeof POLICY_STATUSES)[number]

export interface Policy {
  id: number
  name: string
  type: string
  /** Always one JSON object (jsonb) — never array/scalar/null (F7-db.md §1). */
  configuration: Record<string, unknown>
  status: PolicyStatus
  created_at: string
  updated_at: string
}
// No `organization_id` (F7-api.md §2.7). No `assignments_count` (SoT
// OQ-6 — carry-over obligation for F8, not to be invented early here).

export interface PolicyListResponse {
  policies: Policy[]
  meta: PaginationMeta
}

/** Envelope shared by create/update — the resource is always wrapped in `policy`. */
export interface PolicyResponse {
  policy: Policy
}

/** Query params the list view sends; `per_page` is intentionally absent — the server default (20) applies. */
export interface PolicyQueryParams {
  q?: string
  status?: PolicyStatus
  page: number
}

/**
 * Body for `POST /api/v1/policies` — flat, no `{ policy: {...} }` wrapper.
 * `status` is optional server-side (defaults to `active` when absent — SoT
 * OQ-10), but the form always has a real selected value (the `<select>`
 * starts on `active`, there is no "not chosen yet" state) so it is required
 * here to match exactly what the FE actually sends.
 */
export interface PolicyCreatePayload {
  name: string
  type: string
  configuration: Record<string, unknown>
  status: PolicyStatus
}

/**
 * Body for `PATCH /api/v1/policies/:id`. The server accepts a partial body,
 * and this type has two different callers that send two different subsets:
 * `PolicyFormModal` (edit form — always sends all 4 fields) and
 * `PolicyListView.toggleStatus` (quick action — sends only `status`) — a
 * union of optionals matches both realities instead of forcing all 4.
 */
export interface PolicyUpdatePayload {
  name?: string
  type?: string
  configuration?: Record<string, unknown>
  status?: PolicyStatus
}

export function isPolicyStatus(value: unknown): value is PolicyStatus {
  return typeof value === 'string' && (POLICY_STATUSES as readonly string[]).includes(value)
}
