import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useGroupMembershipsStore } from '../group-memberships'
import { fetchGroupDevices, addGroupDevices, removeGroupDevice } from '../../api/group-memberships'
import type { Device, DeviceListResponse } from '../../types/device'

vi.mock('../../api/group-memberships', () => ({
  fetchGroupDevices: vi.fn(),
  addGroupDevices: vi.fn(),
  removeGroupDevice: vi.fn(),
}))

function device(overrides: Partial<Device> = {}): Device {
  return {
    id: 1,
    identifier: 'IOS-0001',
    name: 'iPhone 14',
    platform: 'ios',
    os_version: '17.4.1',
    status: 'active',
    last_seen_at: null,
    created_at: '2026-09-16T08:00:00.000Z',
    updated_at: '2026-09-16T08:00:00.000Z',
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

describe('useGroupMembershipsStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('starts empty, not loading, without an error', () => {
    const store = useGroupMembershipsStore()

    expect(store.members).toEqual([])
    expect(store.meta).toBeNull()
    expect(store.loading).toBe(false)
    expect(store.error).toBeNull()
  })

  it('stores the members and pagination metadata on success', async () => {
    vi.mocked(fetchGroupDevices).mockResolvedValueOnce(response([device()], 10000))

    const store = useGroupMembershipsStore()
    await store.fetchMembers(7, { page: 1 })

    expect(fetchGroupDevices).toHaveBeenCalledWith(7, { page: 1 })
    expect(store.members).toHaveLength(1)
    expect(store.meta?.total_count).toBe(10000)
    expect(store.error).toBeNull()
    expect(store.loading).toBe(false)
  })

  it('passes the page and both filters straight through to the API layer', async () => {
    vi.mocked(fetchGroupDevices).mockResolvedValueOnce(response([]))

    const store = useGroupMembershipsStore()
    await store.fetchMembers(7, { page: 3, platform: 'ios', status: 'active' })

    expect(fetchGroupDevices).toHaveBeenCalledWith(7, { page: 3, platform: 'ios', status: 'active' })
  })

  it('is loading while the request is in flight', async () => {
    let resolveFetch!: (value: DeviceListResponse) => void
    vi.mocked(fetchGroupDevices).mockReturnValueOnce(
      new Promise<DeviceListResponse>((resolve) => {
        resolveFetch = resolve
      }),
    )

    const store = useGroupMembershipsStore()
    const pending = store.fetchMembers(7, { page: 1 })
    expect(store.loading).toBe(true)

    resolveFetch(response([device()]))
    await pending
    expect(store.loading).toBe(false)
  })

  it('keeps the previously loaded rows when a refetch fails (no blank table)', async () => {
    vi.mocked(fetchGroupDevices).mockResolvedValueOnce(response([device({ id: 7 })], 7))

    const store = useGroupMembershipsStore()
    await store.fetchMembers(7, { page: 1 })

    vi.mocked(fetchGroupDevices).mockRejectedValueOnce({ response: { status: 500, data: {} } })
    await store.fetchMembers(7, { page: 2 })

    expect(store.members).toHaveLength(1)
    expect(store.members[0].id).toBe(7)
    expect(store.meta?.total_count).toBe(7)
    expect(store.error).toBe('Không tải được danh sách thành viên của group.')
    expect(store.loading).toBe(false)
  })

  it('falls back to the membership-specific load message when there is no usable body', async () => {
    vi.mocked(fetchGroupDevices).mockRejectedValueOnce(new Error('network down'))

    const store = useGroupMembershipsStore()
    await store.fetchMembers(7, { page: 1 })

    expect(store.error).toBe('Không tải được danh sách thành viên của group.')
  })

  it('clears a previous error once a later request succeeds', async () => {
    vi.mocked(fetchGroupDevices).mockRejectedValueOnce(new Error('network down'))
    const store = useGroupMembershipsStore()
    await store.fetchMembers(7, { page: 1 })
    expect(store.error).not.toBeNull()

    vi.mocked(fetchGroupDevices).mockResolvedValueOnce(response([device()]))
    await store.fetchMembers(7, { page: 1 })

    expect(store.error).toBeNull()
  })

  it('ignores a slow earlier response that resolves after a newer one', async () => {
    let resolveFirst!: (value: DeviceListResponse) => void
    vi.mocked(fetchGroupDevices).mockReturnValueOnce(
      new Promise<DeviceListResponse>((resolve) => {
        resolveFirst = resolve
      }),
    )
    const store = useGroupMembershipsStore()
    const first = store.fetchMembers(7, { page: 1 })

    vi.mocked(fetchGroupDevices).mockResolvedValueOnce(response([device({ id: 2, name: 'NEW' })]))
    await store.fetchMembers(7, { page: 1, platform: 'ios' })

    resolveFirst(response([device({ id: 1, name: 'STALE' })]))
    await first

    expect(store.members.map((d) => d.name)).toEqual(['NEW'])
    expect(store.loading).toBe(false)
  })

  it('does not let a stale failure overwrite a newer successful result', async () => {
    let rejectFirst!: (reason: unknown) => void
    vi.mocked(fetchGroupDevices).mockReturnValueOnce(
      new Promise<DeviceListResponse>((_resolve, reject) => {
        rejectFirst = reject
      }),
    )
    const store = useGroupMembershipsStore()
    const first = store.fetchMembers(7, { page: 1 })

    vi.mocked(fetchGroupDevices).mockResolvedValueOnce(response([device({ id: 2, name: 'NEW' })]))
    await store.fetchMembers(7, { page: 1, platform: 'ios' })

    rejectFirst({ response: { status: 500, data: {} } })
    await first

    expect(store.error).toBeNull()
    expect(store.members.map((d) => d.name)).toEqual(['NEW'])
  })

  describe('addMembers', () => {
    it('calls the API layer and returns the flat counts', async () => {
      vi.mocked(addGroupDevices).mockResolvedValueOnce({ added_count: 2, devices_count: 12 })

      const store = useGroupMembershipsStore()
      const result = await store.addMembers(7, [1, 2])

      expect(addGroupDevices).toHaveBeenCalledWith(7, [1, 2])
      expect(result).toEqual({ added_count: 2, devices_count: 12 })
    })

    it('throws the error unhandled and leaves list state alone', async () => {
      const error = {
        response: {
          status: 422,
          data: { errors: { base: ['Thiết bị đã retired, không thể thay đổi group: IOS-0009'] } },
        },
      }
      vi.mocked(fetchGroupDevices).mockResolvedValueOnce(response([device()], 1))
      vi.mocked(addGroupDevices).mockRejectedValueOnce(error)

      const store = useGroupMembershipsStore()
      await store.fetchMembers(7, { page: 1 })

      await expect(store.addMembers(7, [9])).rejects.toEqual(error)
      expect(store.error).toBeNull()
      expect(store.loading).toBe(false)
      expect(store.members).toHaveLength(1)
    })
  })

  describe('removeMember', () => {
    it('calls the API layer with the group and device ids', async () => {
      vi.mocked(removeGroupDevice).mockResolvedValueOnce(undefined)

      const store = useGroupMembershipsStore()
      await store.removeMember(7, 42)

      expect(removeGroupDevice).toHaveBeenCalledWith(7, 42)
    })

    it('does not remove the row from the store (no optimistic removal)', async () => {
      vi.mocked(fetchGroupDevices).mockResolvedValueOnce(response([device({ id: 42 })], 1))
      vi.mocked(removeGroupDevice).mockResolvedValueOnce(undefined)

      const store = useGroupMembershipsStore()
      await store.fetchMembers(7, { page: 1 })
      await store.removeMember(7, 42)

      // The row only disappears when the refetch the view fires comes back.
      expect(store.members).toHaveLength(1)
    })

    it('throws the error unhandled and leaves list state alone', async () => {
      const error = { response: { status: 422, data: { errors: { base: ['retired'] } } } }
      vi.mocked(fetchGroupDevices).mockResolvedValueOnce(response([device({ id: 42 })], 1))
      vi.mocked(removeGroupDevice).mockRejectedValueOnce(error)

      const store = useGroupMembershipsStore()
      await store.fetchMembers(7, { page: 1 })

      await expect(store.removeMember(7, 42)).rejects.toEqual(error)
      expect(store.error).toBeNull()
      expect(store.loading).toBe(false)
      expect(store.members).toHaveLength(1)
    })
  })
})
