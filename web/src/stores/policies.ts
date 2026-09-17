import { defineStore } from 'pinia'
import { createPolicy, fetchPolicyList, updatePolicy } from '../api/policies'
import { extractErrorMessage } from '../utils/apiError'
import type { Policy, PolicyCreatePayload, PolicyQueryParams, PolicyUpdatePayload } from '../types/policy'
import type { PaginationMeta } from '../types/ui'

const LOAD_ERROR_MESSAGE = 'Không tải được danh sách policy.'

interface PoliciesState {
  policies: Policy[]
  meta: PaginationMeta | null
  loading: boolean
  error: string | null
  /** Monotonic id of the most recent request; older responses are discarded. */
  lastRequestId: number
}

/**
 * Policy list store — docs/design/F7-frontend.md §3.3, same shape as
 * `stores/groups.ts` minus delete (F7 has no `DELETE /policies/:id` — SoT
 * OQ-2). No `lastListLocation` either: unlike Group, F7 has no detail page
 * to come back from (SoT OQ-7).
 *
 * Holds the *data* only: the search term, status filter and current page
 * live in the URL and are passed in explicitly on every call, so a reload
 * or a back-button can never disagree with what the table shows.
 */
export const usePoliciesStore = defineStore('policies', {
  state: (): PoliciesState => ({
    policies: [],
    meta: null,
    loading: false,
    error: null,
    lastRequestId: 0,
  }),

  actions: {
    async fetchPolicies(params: PolicyQueryParams): Promise<void> {
      const requestId = ++this.lastRequestId
      this.loading = true
      try {
        const response = await fetchPolicyList(params)
        // A slower earlier request must not overwrite a newer result — a
        // debounced search can put two requests in the air within one
        // round-trip.
        if (requestId !== this.lastRequestId) return
        this.policies = response.policies
        this.meta = response.meta
        this.error = null
      } catch (error) {
        if (requestId !== this.lastRequestId) return
        // policies/meta are intentionally left untouched: a failed refetch
        // keeps the last good table instead of blanking it (F7-frontend.md §4).
        this.error = extractErrorMessage(error, LOAD_ERROR_MESSAGE)
      } finally {
        if (requestId === this.lastRequestId) this.loading = false
      }
    },

    /**
     * F7-frontend.md §3.3: the two mutations own no store-level
     * loading/error — a single submission's state belongs to the caller
     * that owns it (`PolicyFormModal` for the form, `PolicyListView` for
     * the quick status toggle). Errors are thrown on untouched so each
     * caller can map a 422 to its own fields, or any status to its own
     * toast.
     */
    async createPolicy(payload: PolicyCreatePayload): Promise<Policy> {
      const response = await createPolicy(payload)
      return response.policy
    },

    /**
     * Used both by `PolicyFormModal` (sends all 4 fields) and
     * `PolicyListView.toggleStatus` (sends only `status`) — one action, two
     * callers, since PATCH is already partial by nature.
     */
    async updatePolicy(id: number, payload: PolicyUpdatePayload): Promise<Policy> {
      const response = await updatePolicy(id, payload)
      return response.policy
    },
  },
})
