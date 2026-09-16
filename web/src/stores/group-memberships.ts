import { defineStore } from 'pinia'
import {
  addGroupDevices,
  fetchGroupDevices,
  removeGroupDevice,
  type AddGroupDevicesResponse,
} from '../api/group-memberships'
import { extractErrorMessage } from '../utils/apiError'
import type { Device } from '../types/device'
import type { GroupDevicesQueryParams } from '../types/group'
import type { PaginationMeta } from '../types/ui'

const LOAD_ERROR_MESSAGE = 'Không tải được danh sách thành viên của group.'

interface GroupMembershipsState {
  members: Device[]
  meta: PaginationMeta | null
  loading: boolean
  error: string | null
  /** Monotonic id of the most recent request; older responses are discarded. */
  lastRequestId: number
}

/**
 * Members of ONE group — docs/design/F6-frontend.md §3.5.
 *
 * A store of its own rather than a few more fields on `stores/devices.ts`:
 * `devices` there is the whole organization's device list, while this one is
 * scoped to a single group and paginated independently. Sharing one store
 * would mean two unrelated lists sitting in the same state, which is exactly
 * how a screen ends up rendering the other screen's rows.
 *
 * Like the other list stores it holds the *data* only — the group id, the
 * page and the filters live in the URL of `GroupDetailView` and are passed
 * in explicitly on every call.
 */
export const useGroupMembershipsStore = defineStore('group-memberships', {
  state: (): GroupMembershipsState => ({
    members: [],
    meta: null,
    loading: false,
    error: null,
    lastRequestId: 0,
  }),

  actions: {
    async fetchMembers(groupId: number, params: GroupDevicesQueryParams): Promise<void> {
      const requestId = ++this.lastRequestId
      this.loading = true
      try {
        const response = await fetchGroupDevices(groupId, params)
        // A slower earlier request must not overwrite a newer result — two
        // filter changes can easily be faster than one round-trip.
        if (requestId !== this.lastRequestId) return
        this.members = response.devices
        this.meta = response.meta
        this.error = null
      } catch (error) {
        if (requestId !== this.lastRequestId) return
        // members/meta are intentionally left untouched: a failed refetch
        // keeps the last good table instead of blanking it (SoT F6 §7, A28).
        this.error = extractErrorMessage(error, LOAD_ERROR_MESSAGE)
      } finally {
        if (requestId === this.lastRequestId) this.loading = false
      }
    },

    /**
     * The two mutations own no store-level loading/error — a single
     * submission's state belongs to the component that triggered it (the
     * modal, or the row's inline confirm), same principle as
     * `groupsStore.createGroup`. Errors are rethrown untouched so the caller
     * can tell a 422 (retired in batch) from a 404 (already removed) from a
     * 500, each of which has its own copy on screen.
     */
    async addMembers(groupId: number, deviceIds: number[]): Promise<AddGroupDevicesResponse> {
      return addGroupDevices(groupId, deviceIds)
    },

    async removeMember(groupId: number, deviceId: number): Promise<void> {
      await removeGroupDevice(groupId, deviceId)
    },
  },
})
