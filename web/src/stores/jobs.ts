import { defineStore } from 'pinia'
import {
  createGroupPolicyAssignment,
  fetchGroupPolicyAssignmentJobs,
  fetchPolicyAssignmentJob,
} from '../api/policyAssignments'
import type { PolicyAssignmentJob } from '../types/policyAssignmentJob'

const POLL_INTERVAL_MS = 2000

interface JobsState {
  /** Newest first — a new banner always appears on top. */
  jobs: PolicyAssignmentJob[]
  timers: Record<number, ReturnType<typeof setInterval>>
}

/**
 * Tracks every `policy_assignment_job` currently worth showing a banner for
 * — docs/design/F8-frontend.md §2.3.1. Deliberately session-lifetime, not
 * component-lifetime: mounted once at `AppShell.vue` because a job can be
 * started from either Group Detail or Policy Detail and must keep being
 * polled/shown across a route change between the two (§2.3).
 *
 * Polling lives HERE, not inside `AsyncJobBanner.vue` — a component unmounts
 * on every route change, which would kill a `setInterval` living there; the
 * store's own lifetime is the whole session.
 */
export const useJobsStore = defineStore('jobs', {
  state: (): JobsState => ({ jobs: [], timers: {} }),

  actions: {
    /** Add/replace a job in the tracked list, starting its poll if it is still in flight. */
    track(job: PolicyAssignmentJob) {
      const idx = this.jobs.findIndex((j) => j.id === job.id)
      if (idx === -1) this.jobs = [job, ...this.jobs]
      else this.jobs = this.jobs.map((j) => (j.id === job.id ? job : j))
      this.ensurePolling(job.id)
    },

    ensurePolling(jobId: number) {
      if (this.timers[jobId]) return // a timer is already running — never double it up
      const job = this.jobs.find((j) => j.id === jobId)
      if (!job || job.status === 'done' || job.status === 'failed') return
      this.timers[jobId] = setInterval(async () => {
        try {
          const response = await fetchPolicyAssignmentJob(jobId)
          const updated = response.policy_assignment_job
          this.jobs = this.jobs.map((j) => (j.id === jobId ? updated : j))
          if (updated.status === 'done' || updated.status === 'failed') this.stopPolling(jobId)
        } catch {
          // A transient poll failure (network) is retried silently next tick
          // — it neither stops the timer nor toasts (UI_UX_design.md §9: an
          // infra hiccup in one small area must not sink the whole
          // experience; the job keeps running server-side, only this FE's
          // visibility into it is briefly stale).
        }
      }, POLL_INTERVAL_MS)
    },

    stopPolling(jobId: number) {
      clearInterval(this.timers[jobId])
      delete this.timers[jobId]
    },

    /** Re-attach on mounting Group Detail — SoT A17/§4-A step 7. */
    async reattachForGroup(groupId: number): Promise<void> {
      const response = await fetchGroupPolicyAssignmentJobs(groupId, { status: ['pending', 'running'] })
      response.policy_assignment_jobs.forEach((job) => this.track(job))
    },

    /** OQ-9 (F8-db/SoT) — always re-enqueues from scratch, never resumes. */
    async retry(job: PolicyAssignmentJob): Promise<void> {
      if (!job.group) return // Group is gone — nothing left to call (§2.3.3)
      const response = await createGroupPolicyAssignment(job.group.id, job.policy.id)
      this.dismiss(job.id)
      this.track(response.policy_assignment_job)
    },

    dismiss(jobId: number) {
      this.stopPolling(jobId)
      this.jobs = this.jobs.filter((j) => j.id !== jobId)
    },
  },
})
