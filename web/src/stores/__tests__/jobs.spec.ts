import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useJobsStore } from '../jobs'
import {
  createGroupPolicyAssignment,
  fetchGroupPolicyAssignmentJobs,
  fetchPolicyAssignmentJob,
} from '../../api/policyAssignments'
import type { PolicyAssignmentJob } from '../../types/policyAssignmentJob'

vi.mock('../../api/policyAssignments', () => ({
  fetchGroupPolicyAssignments: vi.fn(),
  createGroupPolicyAssignment: vi.fn(),
  deleteGroupPolicyAssignment: vi.fn(),
  fetchGroupPolicyAssignmentJobs: vi.fn(),
  fetchPolicyAssignmentJob: vi.fn(),
  fetchPolicyDeviceAssignments: vi.fn(),
  createPolicyDeviceAssignment: vi.fn(),
  deletePolicyDeviceAssignment: vi.fn(),
  fetchPolicyGroupAssignments: vi.fn(),
}))

function job(overrides: Partial<PolicyAssignmentJob> = {}): PolicyAssignmentJob {
  return {
    id: 1,
    status: 'pending',
    total_count: 3,
    processed_count: 0,
    error_message: null,
    policy: { id: 5, name: 'Security Baseline' },
    group: { id: 7, name: 'Sales Team' },
    created_at: '2026-09-17T08:00:00.000Z',
    updated_at: '2026-09-17T08:00:00.000Z',
    ...overrides,
  }
}

describe('useJobsStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('track', () => {
    it('adds a new job to the front of the list', () => {
      const store = useJobsStore()

      store.track(job({ id: 1 }))
      store.track(job({ id: 2 }))

      expect(store.jobs.map((j) => j.id)).toEqual([2, 1])
    })

    it('dedupes by id — tracking the same id again replaces it in place, no duplicate banner', () => {
      const store = useJobsStore()

      store.track(job({ id: 1, status: 'pending' }))
      store.track(job({ id: 1, status: 'running' }))

      expect(store.jobs).toHaveLength(1)
      expect(store.jobs[0].status).toBe('running')
    })

    it('starts polling a still-in-flight job', () => {
      const store = useJobsStore()

      store.track(job({ id: 1, status: 'pending' }))

      expect(store.timers[1]).toBeDefined()
    })

    it('does not start polling a job that already finished', () => {
      const store = useJobsStore()

      store.track(job({ id: 1, status: 'done' }))

      expect(store.timers[1]).toBeUndefined()
    })
  })

  describe('polling', () => {
    it('polls every 2s and updates the tracked job in place', async () => {
      vi.mocked(fetchPolicyAssignmentJob).mockResolvedValueOnce({
        policy_assignment_job: job({ id: 1, status: 'running' }),
      })
      const store = useJobsStore()
      store.track(job({ id: 1, status: 'pending' }))

      await vi.advanceTimersByTimeAsync(2000)

      expect(fetchPolicyAssignmentJob).toHaveBeenCalledWith(1)
      expect(store.jobs[0].status).toBe('running')
    })

    it('stops polling once the job reaches done', async () => {
      vi.mocked(fetchPolicyAssignmentJob).mockResolvedValueOnce({
        policy_assignment_job: job({ id: 1, status: 'done' }),
      })
      const store = useJobsStore()
      store.track(job({ id: 1, status: 'running' }))

      await vi.advanceTimersByTimeAsync(2000)

      expect(store.timers[1]).toBeUndefined()
      expect(fetchPolicyAssignmentJob).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(4000)
      expect(fetchPolicyAssignmentJob).toHaveBeenCalledTimes(1)
    })

    it('stops polling once the job reaches failed', async () => {
      vi.mocked(fetchPolicyAssignmentJob).mockResolvedValueOnce({
        policy_assignment_job: job({ id: 1, status: 'failed', error_message: 'Group đã bị xóa' }),
      })
      const store = useJobsStore()
      store.track(job({ id: 1, status: 'running' }))

      await vi.advanceTimersByTimeAsync(2000)

      expect(store.timers[1]).toBeUndefined()
      expect(store.jobs[0].status).toBe('failed')
    })

    it('a transient poll failure keeps the job tracked and keeps retrying, without throwing', async () => {
      vi.mocked(fetchPolicyAssignmentJob).mockRejectedValueOnce(new Error('network down'))
      vi.mocked(fetchPolicyAssignmentJob).mockResolvedValueOnce({
        policy_assignment_job: job({ id: 1, status: 'running' }),
      })
      const store = useJobsStore()
      store.track(job({ id: 1, status: 'pending' }))

      await vi.advanceTimersByTimeAsync(2000)
      expect(store.jobs[0].status).toBe('pending') // untouched by the failed tick
      expect(store.timers[1]).toBeDefined() // still polling

      await vi.advanceTimersByTimeAsync(2000)
      expect(store.jobs[0].status).toBe('running')
    })

    it('ensurePolling never creates a second timer for the same job', () => {
      const store = useJobsStore()
      store.track(job({ id: 1, status: 'pending' }))
      const firstTimer = store.timers[1]

      store.ensurePolling(1)

      expect(store.timers[1]).toBe(firstTimer)
    })
  })

  describe('reattachForGroup', () => {
    it('fetches pending/running jobs for the group and tracks each one', async () => {
      vi.mocked(fetchGroupPolicyAssignmentJobs).mockResolvedValueOnce({
        policy_assignment_jobs: [job({ id: 1 }), job({ id: 2 })],
        meta: { current_page: 1, per_page: 20, total_count: 2, total_pages: 1 },
      })
      const store = useJobsStore()

      await store.reattachForGroup(7)

      expect(fetchGroupPolicyAssignmentJobs).toHaveBeenCalledWith(7, { status: ['pending', 'running'] })
      expect(store.jobs.map((j) => j.id).sort()).toEqual([1, 2])
    })

    it('tracks nothing when the group has no in-flight job (A17)', async () => {
      vi.mocked(fetchGroupPolicyAssignmentJobs).mockResolvedValueOnce({
        policy_assignment_jobs: [],
        meta: { current_page: 1, per_page: 20, total_count: 0, total_pages: 0 },
      })
      const store = useJobsStore()

      await store.reattachForGroup(7)

      expect(store.jobs).toEqual([])
    })
  })

  describe('retry (OQ-9 — always re-enqueues, never resumes)', () => {
    it('calls createGroupPolicyAssignment again with the job\'s group/policy, dismisses the old job, tracks the new one', async () => {
      vi.mocked(createGroupPolicyAssignment).mockResolvedValueOnce({
        policy_assignment_job: job({ id: 99, status: 'pending' }),
      })
      const store = useJobsStore()
      store.track(job({ id: 1, status: 'failed' }))

      await store.retry(job({ id: 1, status: 'failed' }))

      expect(createGroupPolicyAssignment).toHaveBeenCalledWith(7, 5)
      expect(store.jobs.find((j) => j.id === 1)).toBeUndefined()
      expect(store.jobs.find((j) => j.id === 99)).toBeDefined()
    })

    it('does nothing when the job\'s group is null (deleted) — no call, nothing to retry', async () => {
      const store = useJobsStore()
      store.track(job({ id: 1, status: 'failed', group: null }))

      await store.retry(job({ id: 1, status: 'failed', group: null }))

      expect(createGroupPolicyAssignment).not.toHaveBeenCalled()
      expect(store.jobs.find((j) => j.id === 1)).toBeDefined()
    })
  })

  describe('dismiss', () => {
    it('stops the timer and removes the job from the list', () => {
      const store = useJobsStore()
      store.track(job({ id: 1, status: 'pending' }))

      store.dismiss(1)

      expect(store.jobs).toEqual([])
      expect(store.timers[1]).toBeUndefined()
    })
  })
})
