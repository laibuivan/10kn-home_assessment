import { defineStore } from 'pinia'
import { fetchDeviceList } from '../api/devices'
import { extractErrorMessage } from '../utils/apiError'
import type { Device, DeviceListMeta, DeviceQueryParams } from '../types/device'

const LOAD_ERROR_MESSAGE = 'Không tải được danh sách thiết bị.'

interface DevicesState {
  devices: Device[]
  meta: DeviceListMeta | null
  loading: boolean
  error: string | null
  /** Monotonic id of the most recent request; older responses are discarded. */
  lastRequestId: number
}

/**
 * Device list store — docs/design/F2-frontend.md §3.
 *
 * Holds the *data* only. Filters and the current page deliberately live in
 * the URL (`route.query`) and are passed in explicitly on every call, so
 * there is exactly one source of truth for "what is being shown" and a
 * reload/back-button can never disagree with the store.
 */
export const useDevicesStore = defineStore('devices', {
  state: (): DevicesState => ({
    devices: [],
    meta: null,
    loading: false,
    error: null,
    lastRequestId: 0,
  }),

  actions: {
    async fetchDevices(params: DeviceQueryParams): Promise<void> {
      const requestId = ++this.lastRequestId
      this.loading = true
      try {
        const response = await fetchDeviceList(params)
        // A slower earlier request must not overwrite a newer result (the
        // user can change two filters faster than one round-trip).
        if (requestId !== this.lastRequestId) return
        this.devices = response.devices
        this.meta = response.meta
        this.error = null
      } catch (error) {
        if (requestId !== this.lastRequestId) return
        // devices/meta are intentionally left untouched: a failed refetch
        // keeps the last good table instead of blanking it (SoT F2 §7).
        this.error = extractErrorMessage(error, LOAD_ERROR_MESSAGE)
      } finally {
        if (requestId === this.lastRequestId) this.loading = false
      }
    },
  },
})
