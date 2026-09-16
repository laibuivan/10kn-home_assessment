import { defineStore } from 'pinia'
import { createGroup, deleteGroup, fetchGroupList, updateGroup } from '../api/groups'
import { extractErrorMessage } from '../utils/apiError'
import type {
  Group,
  GroupCreatePayload,
  GroupQueryParams,
  GroupUpdatePayload,
} from '../types/group'
import type { PaginationMeta } from '../types/ui'

const LOAD_ERROR_MESSAGE = 'Không tải được danh sách group.'

interface GroupsState {
  groups: Group[]
  meta: PaginationMeta | null
  loading: boolean
  error: string | null
  /** Monotonic id of the most recent request; older responses are discarded. */
  lastRequestId: number
}

/**
 * Group list store — docs/design/F5-frontend.md §3.3, same shape as
 * `stores/devices.ts`.
 *
 * Holds the *data* only: the search term and the current page live in the
 * URL and are passed in explicitly on every call, so a reload or a
 * back-button can never disagree with what the table shows.
 *
 * There is no `lastListLocation` twin here — F5 has no group detail page to
 * come back from (SoT F5 OQ-5).
 */
export const useGroupsStore = defineStore('groups', {
  state: (): GroupsState => ({
    groups: [],
    meta: null,
    loading: false,
    error: null,
    lastRequestId: 0,
  }),

  actions: {
    async fetchGroups(params: GroupQueryParams): Promise<void> {
      const requestId = ++this.lastRequestId
      this.loading = true
      try {
        const response = await fetchGroupList(params)
        // A slower earlier request must not overwrite a newer result. This
        // matters more here than on Devices: a debounced search can put two
        // requests in the air within one round-trip.
        if (requestId !== this.lastRequestId) return
        this.groups = response.groups
        this.meta = response.meta
        this.error = null
      } catch (error) {
        if (requestId !== this.lastRequestId) return
        // groups/meta are intentionally left untouched: a failed refetch
        // keeps the last good table instead of blanking it (SoT F5 §7).
        this.error = extractErrorMessage(error, LOAD_ERROR_MESSAGE)
      } finally {
        if (requestId === this.lastRequestId) this.loading = false
      }
    },

    /**
     * F5-frontend.md §3.3: the three mutations own no store-level
     * loading/error — a single submission's state belongs to the component
     * that owns the form/dialog. Errors are thrown on untouched so the
     * caller can map a 422 to its fields, or a 404 vs 500 to its own copy.
     */
    async createGroup(payload: GroupCreatePayload): Promise<Group> {
      const response = await createGroup(payload)
      return response.group
    },

    async updateGroup(id: number, payload: GroupUpdatePayload): Promise<Group> {
      const response = await updateGroup(id, payload)
      return response.group
    },

    /**
     * Deliberately does NOT splice the row out of `state.groups`: no
     * optimistic delete (SoT F5 §4 bước 5). The row disappears only when the
     * refetch that the view fires afterwards comes back — so a delete that
     * actually failed can never leave the table lying about what exists.
     */
    async deleteGroup(id: number): Promise<void> {
      await deleteGroup(id)
    },
  },
})
