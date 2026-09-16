import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useDevicesStore } from '../devices'
import { fetchDeviceList, createDevice, updateDevice } from '../../api/devices'
import type { Device, DeviceListResponse } from '../../types/device'

vi.mock('../../api/devices', () => ({
  fetchDeviceList: vi.fn(),
  createDevice: vi.fn(),
  updateDevice: vi.fn(),
}))

function device(overrides: Partial<Device> = {}): Device {
  return {
    id: 1,
    identifier: 'DEV-00001',
    name: 'Device 1',
    platform: 'ios',
    os_version: '17.4',
    status: 'active',
    last_seen_at: '2026-09-15T08:00:00.000Z',
    created_at: '2026-09-15T08:00:00.000Z',
    updated_at: '2026-09-15T08:00:00.000Z',
    ...overrides,
  }
}

function response(devices: Device[], total = devices.length): DeviceListResponse {
  return {
    devices,
    meta: {
      current_page: 1,
      per_page: 20,
      total_count: total,
      total_pages: total === 0 ? 0 : Math.ceil(total / 20),
    },
  }
}

describe('useDevicesStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('starts empty, not loading, without an error', () => {
    const store = useDevicesStore()

    expect(store.devices).toEqual([])
    expect(store.meta).toBeNull()
    expect(store.loading).toBe(false)
    expect(store.error).toBeNull()
  })

  it('stores devices and pagination metadata on success', async () => {
    vi.mocked(fetchDeviceList).mockResolvedValueOnce(response([device()], 25))

    const store = useDevicesStore()
    await store.fetchDevices({ page: 1 })

    expect(store.devices).toHaveLength(1)
    expect(store.meta?.total_count).toBe(25)
    expect(store.error).toBeNull()
    expect(store.loading).toBe(false)
  })

  it('passes the filters and page straight through to the API layer', async () => {
    vi.mocked(fetchDeviceList).mockResolvedValueOnce(response([]))

    const store = useDevicesStore()
    await store.fetchDevices({ platform: 'android', status: 'active', page: 3 })

    expect(fetchDeviceList).toHaveBeenCalledWith({ platform: 'android', status: 'active', page: 3 })
  })

  it('is loading while the request is in flight', async () => {
    let resolveFetch!: (value: DeviceListResponse) => void
    vi.mocked(fetchDeviceList).mockReturnValueOnce(
      new Promise<DeviceListResponse>((resolve) => {
        resolveFetch = resolve
      }),
    )

    const store = useDevicesStore()
    const pending = store.fetchDevices({ page: 1 })
    expect(store.loading).toBe(true)

    resolveFetch(response([device()]))
    await pending
    expect(store.loading).toBe(false)
  })

  it('keeps the previously loaded rows when a refetch fails (no blank table)', async () => {
    vi.mocked(fetchDeviceList).mockResolvedValueOnce(response([device({ id: 7 })], 7))

    const store = useDevicesStore()
    await store.fetchDevices({ page: 1 })

    vi.mocked(fetchDeviceList).mockRejectedValueOnce({ response: { status: 500, data: {} } })
    await store.fetchDevices({ page: 2 })

    expect(store.devices).toHaveLength(1)
    expect(store.devices[0].id).toBe(7)
    expect(store.meta?.total_count).toBe(7)
    expect(store.error).toBe('Không tải được danh sách thiết bị.')
    expect(store.loading).toBe(false)
  })

  it('surfaces the API error message when the body carries one', async () => {
    vi.mocked(fetchDeviceList).mockRejectedValueOnce({
      response: { status: 422, data: { errors: { page: ['must be a positive integer'] } } },
    })

    const store = useDevicesStore()
    await store.fetchDevices({ page: 1 })

    expect(store.error).toBe('must be a positive integer')
  })

  it('clears a previous error once a later request succeeds', async () => {
    vi.mocked(fetchDeviceList).mockRejectedValueOnce(new Error('network down'))
    const store = useDevicesStore()
    await store.fetchDevices({ page: 1 })
    expect(store.error).not.toBeNull()

    vi.mocked(fetchDeviceList).mockResolvedValueOnce(response([device()]))
    await store.fetchDevices({ page: 1 })

    expect(store.error).toBeNull()
  })

  it('ignores a slow earlier response that resolves after a newer one', async () => {
    let resolveFirst!: (value: DeviceListResponse) => void
    vi.mocked(fetchDeviceList).mockReturnValueOnce(
      new Promise<DeviceListResponse>((resolve) => {
        resolveFirst = resolve
      }),
    )
    const store = useDevicesStore()
    const first = store.fetchDevices({ page: 1 })

    vi.mocked(fetchDeviceList).mockResolvedValueOnce(response([device({ id: 2, identifier: 'NEW' })]))
    await store.fetchDevices({ platform: 'ios', page: 1 })

    resolveFirst(response([device({ id: 1, identifier: 'STALE' })]))
    await first

    expect(store.devices.map((d) => d.identifier)).toEqual(['NEW'])
  })

  describe('createDevice', () => {
    it('calls the API layer and returns the created device', async () => {
      const created = device({ id: 99, identifier: 'IPHONE-042' })
      vi.mocked(createDevice).mockResolvedValueOnce({ device: created })

      const store = useDevicesStore()
      const payload = { identifier: 'IPHONE-042', name: 'Alice iPhone', platform: 'ios' as const }
      const result = await store.createDevice(payload)

      expect(createDevice).toHaveBeenCalledWith(payload)
      expect(result).toEqual(created)
    })

    it('throws the error unhandled when the API call fails', async () => {
      const error = { response: { status: 422, data: { errors: { identifier: ["can't be blank"] } } } }
      vi.mocked(createDevice).mockRejectedValueOnce(error)

      const store = useDevicesStore()
      await expect(
        store.createDevice({ identifier: '', name: '', platform: 'ios' }),
      ).rejects.toEqual(error)
    })
  })

  describe('updateDevice', () => {
    it('calls the API layer with the id and payload, and returns the updated device', async () => {
      const updated = device({ id: 7, name: 'Updated Name' })
      vi.mocked(updateDevice).mockResolvedValueOnce({ device: updated })

      const store = useDevicesStore()
      const payload = { name: 'Updated Name' }
      const result = await store.updateDevice(7, payload)

      expect(updateDevice).toHaveBeenCalledWith(7, payload)
      expect(result).toEqual(updated)
    })

    it('throws the error unhandled when the API call fails', async () => {
      const error = { response: { status: 422, data: { errors: { base: ['Thiết bị đã retired, không thể sửa'] } } } }
      vi.mocked(updateDevice).mockRejectedValueOnce(error)

      const store = useDevicesStore()
      await expect(store.updateDevice(7, { name: 'x' })).rejects.toEqual(error)
    })
  })
})
