/**
 * Shapes returned by `GET /api/v1/devices/:id/applied_policies` — mirrors
 * docs/design/F9-api.md §2.3 exactly (no extra/renamed fields).
 */
import type { PolicyStatus } from './policy'

export interface AppliedPolicySource {
  kind: 'direct' | 'group'
  group: { id: number; name: string } | null
}

/** The winning policy at top level — `status` is always "active" (R1), kept typed rather than hardcoded (F9-api.md §2.3). */
export interface AppliedPolicySummary {
  id: number
  name: string
  type: string
  configuration: Record<string, unknown>
  status: PolicyStatus
}

export interface AppliedPolicyCandidate {
  policy_id: number
  name: string
  configuration: Record<string, unknown>
  status: PolicyStatus
  source: AppliedPolicySource
  included: boolean
  /** Exactly one of the 2 fixed strings from F9-api.md §3 when `included` is false; `null` when true. Rendered verbatim, never mapped. */
  excluded_reason: string | null
}

export interface AppliedPolicyEntry {
  type: string
  policy: AppliedPolicySummary
  source: AppliedPolicySource
  conflict: boolean
  candidates: AppliedPolicyCandidate[]
}

export interface AppliedPoliciesResponse {
  applied_policies: AppliedPolicyEntry[]
}
