import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { usePoliciesStore } from '../policies'
import { fetchPolicyList, createPolicy, updatePolicy } from '../../api/policies'
import type { Policy, PolicyListResponse } from '../../types/policy'

vi.mock('../../api/policies', () => ({
  fetchPolicyList: vi.fn(),
  createPolicy: vi.fn(),
  updatePolicy: vi.fn(),
}))

function policy(overrides: Partial<Policy> = {}): Policy {
  return {
    id: 1,
    name: 'Wifi mặc định',
    type: 'wifi',
    configuration: { ssid: 'corp' },
    status: 'active',
    created_at: '2026-09-17T08:00:00.000Z',
    updated_at: '2026-09-17T08:00:00.000Z',
    ...overrides,
  }
}

function response(policies: Policy[], total = policies.length): PolicyListResponse {
  return {
    policies,
    meta: {
      current_page: 1,
      per_page: 20,
      total_count: total,
      total_pages: total === 0 ? 0 : Math.ceil(total / 20),
    },
  }
}

describe('usePoliciesStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('starts empty, not loading, without an error', () => {
    const store = usePoliciesStore()

    expect(store.policies).toEqual([])
    expect(store.meta).toBeNull()
    expect(store.loading).toBe(false)
    expect(store.error).toBeNull()
  })

  it('stores policies and pagination metadata on success', async () => {
    vi.mocked(fetchPolicyList).mockResolvedValueOnce(response([policy()], 25))

    const store = usePoliciesStore()
    await store.fetchPolicies({ page: 1 })

    expect(store.policies).toHaveLength(1)
    expect(store.meta?.total_count).toBe(25)
    expect(store.error).toBeNull()
    expect(store.loading).toBe(false)
  })

  it('passes q/status/page straight through to the API layer', async () => {
    vi.mocked(fetchPolicyList).mockResolvedValueOnce(response([]))

    const store = usePoliciesStore()
    await store.fetchPolicies({ q: 'wifi', status: 'inactive', page: 3 })

    expect(fetchPolicyList).toHaveBeenCalledWith({ q: 'wifi', status: 'inactive', page: 3 })
  })

  it('is loading while the request is in flight', async () => {
    let resolveFetch!: (value: PolicyListResponse) => void
    vi.mocked(fetchPolicyList).mockReturnValueOnce(
      new Promise<PolicyListResponse>((resolve) => {
        resolveFetch = resolve
      }),
    )

    const store = usePoliciesStore()
    const pending = store.fetchPolicies({ page: 1 })
    expect(store.loading).toBe(true)

    resolveFetch(response([policy()]))
    await pending
    expect(store.loading).toBe(false)
  })

  it('keeps the previously loaded rows when a refetch fails (no blank table)', async () => {
    vi.mocked(fetchPolicyList).mockResolvedValueOnce(response([policy({ id: 7 })], 7))

    const store = usePoliciesStore()
    await store.fetchPolicies({ page: 1 })

    vi.mocked(fetchPolicyList).mockRejectedValueOnce({ response: { status: 500, data: {} } })
    await store.fetchPolicies({ page: 2 })

    expect(store.policies).toHaveLength(1)
    expect(store.policies[0].id).toBe(7)
    expect(store.meta?.total_count).toBe(7)
    expect(store.error).toBe('Không tải được danh sách policy.')
    expect(store.loading).toBe(false)
  })

  it('falls back to the policy-specific load message when there is no usable body', async () => {
    vi.mocked(fetchPolicyList).mockRejectedValueOnce(new Error('network down'))

    const store = usePoliciesStore()
    await store.fetchPolicies({ page: 1 })

    expect(store.error).toBe('Không tải được danh sách policy.')
  })

  it('clears a previous error once a later request succeeds', async () => {
    vi.mocked(fetchPolicyList).mockRejectedValueOnce(new Error('network down'))
    const store = usePoliciesStore()
    await store.fetchPolicies({ page: 1 })
    expect(store.error).not.toBeNull()

    vi.mocked(fetchPolicyList).mockResolvedValueOnce(response([policy()]))
    await store.fetchPolicies({ page: 1 })

    expect(store.error).toBeNull()
  })

  it('ignores a slow earlier response that resolves after a newer one (debounced search / filter race)', async () => {
    let resolveFirst!: (value: PolicyListResponse) => void
    vi.mocked(fetchPolicyList).mockReturnValueOnce(
      new Promise<PolicyListResponse>((resolve) => {
        resolveFirst = resolve
      }),
    )
    const store = usePoliciesStore()
    const first = store.fetchPolicies({ page: 1 })

    vi.mocked(fetchPolicyList).mockResolvedValueOnce(response([policy({ id: 2, name: 'NEW' })]))
    await store.fetchPolicies({ q: 'wifi', page: 1 })

    resolveFirst(response([policy({ id: 1, name: 'STALE' })]))
    await first

    expect(store.policies.map((p) => p.name)).toEqual(['NEW'])
    expect(store.loading).toBe(false)
  })

  it('does not let a stale failure overwrite a newer successful result', async () => {
    let rejectFirst!: (reason: unknown) => void
    vi.mocked(fetchPolicyList).mockReturnValueOnce(
      new Promise<PolicyListResponse>((_resolve, reject) => {
        rejectFirst = reject
      }),
    )
    const store = usePoliciesStore()
    const first = store.fetchPolicies({ page: 1 })

    vi.mocked(fetchPolicyList).mockResolvedValueOnce(response([policy({ id: 2, name: 'NEW' })]))
    await store.fetchPolicies({ q: 'wifi', page: 1 })

    rejectFirst({ response: { status: 500, data: {} } })
    await first

    expect(store.error).toBeNull()
    expect(store.policies.map((p) => p.name)).toEqual(['NEW'])
  })

  describe('createPolicy', () => {
    it('calls the API layer and returns the created policy', async () => {
      const created = policy({ id: 99, name: 'New Policy' })
      vi.mocked(createPolicy).mockResolvedValueOnce({ policy: created })

      const store = usePoliciesStore()
      const payload = { name: 'New Policy', type: 'wifi', configuration: {}, status: 'active' as const }
      const result = await store.createPolicy(payload)

      expect(createPolicy).toHaveBeenCalledWith(payload)
      expect(result).toEqual(created)
    })

    it('throws the error unhandled and leaves list state alone', async () => {
      const error = {
        response: {
          status: 422,
          data: { errors: { name: ['Tên policy này đã tồn tại trong tổ chức của bạn.'] } },
        },
      }
      vi.mocked(createPolicy).mockRejectedValueOnce(error)
      vi.mocked(fetchPolicyList).mockResolvedValueOnce(response([policy()]))

      const store = usePoliciesStore()
      await store.fetchPolicies({ page: 1 })

      await expect(
        store.createPolicy({ name: 'New Policy', type: 'wifi', configuration: {}, status: 'active' }),
      ).rejects.toEqual(error)
      expect(store.error).toBeNull()
      expect(store.loading).toBe(false)
      expect(store.policies).toHaveLength(1)
    })
  })

  describe('updatePolicy', () => {
    it('calls the API layer with the id and payload, and returns the updated policy', async () => {
      const updated = policy({ id: 7, name: 'Renamed' })
      vi.mocked(updatePolicy).mockResolvedValueOnce({ policy: updated })

      const store = usePoliciesStore()
      const payload = { name: 'Renamed', type: 'wifi', configuration: {}, status: 'active' as const }
      const result = await store.updatePolicy(7, payload)

      expect(updatePolicy).toHaveBeenCalledWith(7, payload)
      expect(result).toEqual(updated)
    })

    it('accepts a partial payload (status-only, for the quick toggle)', async () => {
      vi.mocked(updatePolicy).mockResolvedValueOnce({ policy: policy({ status: 'inactive' }) })

      const store = usePoliciesStore()
      await store.updatePolicy(1, { status: 'inactive' })

      expect(updatePolicy).toHaveBeenCalledWith(1, { status: 'inactive' })
    })

    it('throws the error unhandled and leaves list state alone', async () => {
      const error = { response: { status: 404, data: { error: 'Not found' } } }
      vi.mocked(updatePolicy).mockRejectedValueOnce(error)

      const store = usePoliciesStore()
      await expect(store.updatePolicy(7, { status: 'inactive' })).rejects.toEqual(error)
      expect(store.error).toBeNull()
      expect(store.loading).toBe(false)
    })
  })
})
