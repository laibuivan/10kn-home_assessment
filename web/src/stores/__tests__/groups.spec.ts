import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useGroupsStore } from '../groups'
import { fetchGroupList, createGroup, updateGroup, deleteGroup } from '../../api/groups'
import type { Group, GroupListResponse } from '../../types/group'

vi.mock('../../api/groups', () => ({
  fetchGroupList: vi.fn(),
  createGroup: vi.fn(),
  updateGroup: vi.fn(),
  deleteGroup: vi.fn(),
}))

function group(overrides: Partial<Group> = {}): Group {
  return {
    id: 1,
    name: 'Sales Team',
    description: 'Đội kinh doanh',
    created_at: '2026-09-16T08:00:00.000Z',
    updated_at: '2026-09-16T08:00:00.000Z',
    ...overrides,
  }
}

function response(groups: Group[], total = groups.length): GroupListResponse {
  return {
    groups,
    meta: {
      current_page: 1,
      per_page: 20,
      total_count: total,
      total_pages: total === 0 ? 0 : Math.ceil(total / 20),
    },
  }
}

describe('useGroupsStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('starts empty, not loading, without an error', () => {
    const store = useGroupsStore()

    expect(store.groups).toEqual([])
    expect(store.meta).toBeNull()
    expect(store.loading).toBe(false)
    expect(store.error).toBeNull()
  })

  it('stores groups and pagination metadata on success', async () => {
    vi.mocked(fetchGroupList).mockResolvedValueOnce(response([group()], 25))

    const store = useGroupsStore()
    await store.fetchGroups({ page: 1 })

    expect(store.groups).toHaveLength(1)
    expect(store.meta?.total_count).toBe(25)
    expect(store.error).toBeNull()
    expect(store.loading).toBe(false)
  })

  it('passes the search term and page straight through to the API layer', async () => {
    vi.mocked(fetchGroupList).mockResolvedValueOnce(response([]))

    const store = useGroupsStore()
    await store.fetchGroups({ q: 'sales', page: 3 })

    expect(fetchGroupList).toHaveBeenCalledWith({ q: 'sales', page: 3 })
  })

  it('is loading while the request is in flight', async () => {
    let resolveFetch!: (value: GroupListResponse) => void
    vi.mocked(fetchGroupList).mockReturnValueOnce(
      new Promise<GroupListResponse>((resolve) => {
        resolveFetch = resolve
      }),
    )

    const store = useGroupsStore()
    const pending = store.fetchGroups({ page: 1 })
    expect(store.loading).toBe(true)

    resolveFetch(response([group()]))
    await pending
    expect(store.loading).toBe(false)
  })

  it('keeps the previously loaded rows when a refetch fails (no blank table)', async () => {
    vi.mocked(fetchGroupList).mockResolvedValueOnce(response([group({ id: 7 })], 7))

    const store = useGroupsStore()
    await store.fetchGroups({ page: 1 })

    vi.mocked(fetchGroupList).mockRejectedValueOnce({ response: { status: 500, data: {} } })
    await store.fetchGroups({ page: 2 })

    expect(store.groups).toHaveLength(1)
    expect(store.groups[0].id).toBe(7)
    expect(store.meta?.total_count).toBe(7)
    expect(store.error).toBe('Không tải được danh sách group.')
    expect(store.loading).toBe(false)
  })

  it('falls back to the group-specific load message when there is no usable body', async () => {
    vi.mocked(fetchGroupList).mockRejectedValueOnce(new Error('network down'))

    const store = useGroupsStore()
    await store.fetchGroups({ page: 1 })

    expect(store.error).toBe('Không tải được danh sách group.')
  })

  it('surfaces the API error message when the body carries one', async () => {
    vi.mocked(fetchGroupList).mockRejectedValueOnce({
      response: { status: 422, data: { errors: { page: ['must be a positive integer'] } } },
    })

    const store = useGroupsStore()
    await store.fetchGroups({ page: 1 })

    expect(store.error).toBe('must be a positive integer')
  })

  it('clears a previous error once a later request succeeds', async () => {
    vi.mocked(fetchGroupList).mockRejectedValueOnce(new Error('network down'))
    const store = useGroupsStore()
    await store.fetchGroups({ page: 1 })
    expect(store.error).not.toBeNull()

    vi.mocked(fetchGroupList).mockResolvedValueOnce(response([group()]))
    await store.fetchGroups({ page: 1 })

    expect(store.error).toBeNull()
  })

  it('ignores a slow earlier response that resolves after a newer one (debounced search)', async () => {
    let resolveFirst!: (value: GroupListResponse) => void
    vi.mocked(fetchGroupList).mockReturnValueOnce(
      new Promise<GroupListResponse>((resolve) => {
        resolveFirst = resolve
      }),
    )
    const store = useGroupsStore()
    const first = store.fetchGroups({ page: 1 })

    vi.mocked(fetchGroupList).mockResolvedValueOnce(response([group({ id: 2, name: 'NEW' })]))
    await store.fetchGroups({ q: 'sales', page: 1 })

    resolveFirst(response([group({ id: 1, name: 'STALE' })]))
    await first

    expect(store.groups.map((g) => g.name)).toEqual(['NEW'])
    expect(store.loading).toBe(false)
  })

  it('does not let a stale failure overwrite a newer successful result', async () => {
    let rejectFirst!: (reason: unknown) => void
    vi.mocked(fetchGroupList).mockReturnValueOnce(
      new Promise<GroupListResponse>((_resolve, reject) => {
        rejectFirst = reject
      }),
    )
    const store = useGroupsStore()
    const first = store.fetchGroups({ page: 1 })

    vi.mocked(fetchGroupList).mockResolvedValueOnce(response([group({ id: 2, name: 'NEW' })]))
    await store.fetchGroups({ q: 'sales', page: 1 })

    rejectFirst({ response: { status: 500, data: {} } })
    await first

    expect(store.error).toBeNull()
    expect(store.groups.map((g) => g.name)).toEqual(['NEW'])
  })

  describe('createGroup', () => {
    it('calls the API layer and returns the created group', async () => {
      const created = group({ id: 99, name: 'Sales Team' })
      vi.mocked(createGroup).mockResolvedValueOnce({ group: created })

      const store = useGroupsStore()
      const payload = { name: 'Sales Team', description: 'Đội kinh doanh' }
      const result = await store.createGroup(payload)

      expect(createGroup).toHaveBeenCalledWith(payload)
      expect(result).toEqual(created)
    })

    it('throws the error unhandled and leaves list state alone', async () => {
      const error = {
        response: {
          status: 422,
          data: { errors: { name: ['Tên group này đã tồn tại trong tổ chức của bạn.'] } },
        },
      }
      vi.mocked(createGroup).mockRejectedValueOnce(error)
      vi.mocked(fetchGroupList).mockResolvedValueOnce(response([group()]))

      const store = useGroupsStore()
      await store.fetchGroups({ page: 1 })

      await expect(store.createGroup({ name: 'Sales Team' })).rejects.toEqual(error)
      expect(store.error).toBeNull()
      expect(store.loading).toBe(false)
      expect(store.groups).toHaveLength(1)
    })
  })

  describe('updateGroup', () => {
    it('calls the API layer with the id and payload, and returns the updated group', async () => {
      const updated = group({ id: 7, name: 'Sales APAC' })
      vi.mocked(updateGroup).mockResolvedValueOnce({ group: updated })

      const store = useGroupsStore()
      const payload = { name: 'Sales APAC', description: '' }
      const result = await store.updateGroup(7, payload)

      expect(updateGroup).toHaveBeenCalledWith(7, payload)
      expect(result).toEqual(updated)
    })

    it('throws the error unhandled and leaves list state alone', async () => {
      const error = { response: { status: 404, data: { error: 'Not found' } } }
      vi.mocked(updateGroup).mockRejectedValueOnce(error)

      const store = useGroupsStore()
      await expect(store.updateGroup(7, { name: 'x' })).rejects.toEqual(error)
      expect(store.error).toBeNull()
      expect(store.loading).toBe(false)
    })
  })

  describe('deleteGroup', () => {
    it('calls the API layer with the id', async () => {
      vi.mocked(deleteGroup).mockResolvedValueOnce(undefined)

      const store = useGroupsStore()
      await store.deleteGroup(7)

      expect(deleteGroup).toHaveBeenCalledWith(7)
    })

    it('does not remove the row from the store (no optimistic delete)', async () => {
      vi.mocked(fetchGroupList).mockResolvedValueOnce(response([group({ id: 7 })], 1))
      vi.mocked(deleteGroup).mockResolvedValueOnce(undefined)

      const store = useGroupsStore()
      await store.fetchGroups({ page: 1 })
      await store.deleteGroup(7)

      // The row only disappears when the refetch the view fires comes back.
      expect(store.groups).toHaveLength(1)
      expect(store.groups[0].id).toBe(7)
    })

    it('throws the error unhandled and leaves list state alone', async () => {
      const error = { response: { status: 500, data: {} } }
      vi.mocked(deleteGroup).mockRejectedValueOnce(error)
      vi.mocked(fetchGroupList).mockResolvedValueOnce(response([group({ id: 7 })], 1))

      const store = useGroupsStore()
      await store.fetchGroups({ page: 1 })

      await expect(store.deleteGroup(7)).rejects.toEqual(error)
      expect(store.error).toBeNull()
      expect(store.loading).toBe(false)
      expect(store.groups).toHaveLength(1)
    })
  })
})
