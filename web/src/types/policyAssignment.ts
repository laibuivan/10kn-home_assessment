/**
 * Minimal field sets returned by the "cross" list endpoints of F8 — the tab
 * content shown from the *other* resource's detail page (docs/design/
 * F8-frontend.md §3.2, mirrors F8-api.md §2.4/§2.13 exactly). Deliberately
 * NOT the full `Policy`/`Group` shape: these lists render only a name/type/
 * status line, never a full row's worth of fields the caller does not need.
 */

import type { PolicyStatus } from './policy'

/** Field returned by `GET /api/v1/groups/:id/policy_assignments` — F8-api.md §1. */
export interface PolicySummary {
  id: number
  name: string
  type: string
  status: PolicyStatus
}

/** Field returned by `GET /api/v1/policies/:id/group_assignments` — F8-api.md §2.13. */
export interface GroupSummary {
  id: number
  name: string
}
