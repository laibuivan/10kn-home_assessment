/**
 * Shape of `policy_assignment_job` — mirrors docs/design/F8-api.md §2.9
 * exactly (no extra/renamed fields).
 */

import type { PaginationMeta } from './ui'

/** SoT F8 OQ-1 — the 4 real enum values, not `UI_UX_design.md`'s illustrative UX labels (`queued`/`completed`). */
export const POLICY_ASSIGNMENT_JOB_STATUSES = ['pending', 'running', 'done', 'failed'] as const
export type PolicyAssignmentJobStatus = (typeof POLICY_ASSIGNMENT_JOB_STATUSES)[number]

export interface PolicyAssignmentJob {
  id: number
  status: PolicyAssignmentJobStatus
  total_count: number
  /**
   * Cosmetic (F8-db.md OQ-DB-1/F8-api.md §4.1) — stays `0` through
   * `pending`/`running`, jumps to `total_count` when `done`. Never used to
   * draw a real-time %/x-of-y progress bar — Phương án A has no "batch N/M"
   * concept to report mid-flight.
   */
  processed_count: number
  error_message: string | null
  policy: { id: number; name: string }
  /** `null` after the Group has been deleted (F8-db.md §1c) — the job row itself still exists. */
  group: { id: number; name: string } | null
  created_at: string
  updated_at: string
}

export interface PolicyAssignmentJobResponse {
  policy_assignment_job: PolicyAssignmentJob
}

export interface PolicyAssignmentJobListResponse {
  policy_assignment_jobs: PolicyAssignmentJob[]
  meta: PaginationMeta
}
