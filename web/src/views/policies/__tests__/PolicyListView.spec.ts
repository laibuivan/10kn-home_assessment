import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { createRouter, createMemoryHistory, type Router } from 'vue-router'
import { setActivePinia, createPinia } from 'pinia'
import PolicyListView from '../PolicyListView.vue'
import { fetchPolicyList, createPolicy, updatePolicy } from '../../../api/policies'
import type { Policy, PolicyListResponse } from '../../../types/policy'

vi.mock('../../../api/policies', () => ({
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
    assignments_count: 0,
    created_at: '2026-09-17T08:00:00.000Z',
    updated_at: '2026-09-17T08:00:00.000Z',
    ...overrides,
  }
}

function listResponse(
  policies: Policy[],
  meta: Partial<PolicyListResponse['meta']> = {},
): PolicyListResponse {
  const totalCount = meta.total_count ?? policies.length
  const perPage = meta.per_page ?? 20
  return {
    policies,
    meta: {
      current_page: meta.current_page ?? 1,
      per_page: perPage,
      total_count: totalCount,
      total_pages: meta.total_pages ?? (totalCount === 0 ? 0 : Math.ceil(totalCount / perPage)),
    },
  }
}

function buildRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', redirect: '/devices' },
      { path: '/login', name: 'login', component: { template: '<div />' } },
      { path: '/devices', name: 'devices', component: { template: '<div />' } },
      { path: '/policies', name: 'policies', component: PolicyListView },
      { path: '/policies/:id', name: 'policy-detail', component: { template: '<div />' } },
    ],
  })
}

async function mountView(path = '/policies'): Promise<{ wrapper: VueWrapper; router: Router }> {
  const router = buildRouter()
  router.push(path)
  await router.isReady()

  const wrapper = mount(PolicyListView, { global: { plugins: [router] } })
  await flushPromises()
  return { wrapper, router }
}

/** Opens the "⋯" menu of the first row and clicks one of its items. */
async function rowAction(wrapper: VueWrapper, testId: string) {
  await wrapper.find('[data-testid=actions-menu-trigger]').trigger('click')
  await wrapper.find(`[data-testid=${testId}]`).trigger('click')
}

describe('PolicyListView', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('loads the first page with no filters when the URL is bare', async () => {
    vi.mocked(fetchPolicyList).mockResolvedValue(
      listResponse([policy(), policy({ id: 2, name: 'Password Baseline' })], { total_count: 2 }),
    )

    const { wrapper } = await mountView('/policies')

    expect(fetchPolicyList).toHaveBeenCalledWith({ q: undefined, status: undefined, page: 1 })
    expect(wrapper.findAll('[data-testid=policy-row]')).toHaveLength(2)
  })

  it('hydrates q/status/page straight from the URL (shared link)', async () => {
    vi.mocked(fetchPolicyList).mockResolvedValue(
      listResponse([policy()], { current_page: 2, total_count: 25 }),
    )

    const { wrapper } = await mountView('/policies?q=wifi&status=inactive&page=2')

    expect(fetchPolicyList).toHaveBeenCalledWith({ q: 'wifi', status: 'inactive', page: 2 })
    expect((wrapper.find('[data-testid=policy-search-input]').element as HTMLInputElement).value).toBe(
      'wifi',
    )
    expect((wrapper.find('[data-testid=filter-status]').element as HTMLSelectElement).value).toBe(
      'inactive',
    )
  })

  it('sanitizes a hand-edited page, a whitespace-only q, and an out-of-enum status', async () => {
    vi.mocked(fetchPolicyList).mockResolvedValue(listResponse([policy()]))

    await mountView('/policies?q=%20%20&page=abc&status=bogus')

    expect(fetchPolicyList).toHaveBeenCalledWith({ q: undefined, status: undefined, page: 1 })
  })

  it('renders Name/Type/Status/Số nơi đang gán columns (F8, F7 OQ-6 carry-over)', async () => {
    vi.mocked(fetchPolicyList).mockResolvedValue(
      listResponse([policy({ name: 'Wifi mặc định', type: 'wifi', assignments_count: 4 })]),
    )

    const { wrapper } = await mountView('/policies')

    expect(wrapper.find('[data-field=name]').text()).toBe('Wifi mặc định')
    expect(wrapper.find('[data-field=type]').text()).toBe('wifi')
    expect(wrapper.find('[data-field=assignments_count]').text()).toBe('4')
    expect(wrapper.find('th').exists()).toBe(true)
    const headers = wrapper.findAll('th').map((h) => h.text())
    expect(headers).toEqual(['Name', 'Type', 'Status', 'Số nơi đang gán', ''])
  })

  it('makes the table row clickable, navigating to the detail page (F8, F7 OQ-7 carry-over)', async () => {
    vi.mocked(fetchPolicyList).mockResolvedValue(listResponse([policy({ id: 5 })]))

    const { wrapper, router } = await mountView('/policies')
    await wrapper.find('[data-field=name]').trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.path).toBe('/policies/5')
  })

  describe('search', () => {
    it('writes the term into the URL, drops the page, and keeps status', async () => {
      vi.useFakeTimers()
      vi.mocked(fetchPolicyList).mockResolvedValue(
        listResponse([policy()], { current_page: 2, total_count: 25 }),
      )
      const { wrapper, router } = await mountView('/policies?page=2&status=inactive')

      await wrapper.find('[data-testid=policy-search-input]').setValue('wifi')
      vi.advanceTimersByTime(300)
      await flushPromises()

      expect(router.currentRoute.value.query).toEqual({ q: 'wifi', status: 'inactive' })
      expect(fetchPolicyList).toHaveBeenLastCalledWith({ q: 'wifi', status: 'inactive', page: 1 })
    })

    it('search-box clear only clears q, keeping status (OQ-FE-2)', async () => {
      vi.mocked(fetchPolicyList).mockResolvedValue(listResponse([policy()], { total_count: 45 }))

      const { wrapper, router } = await mountView('/policies?q=wifi&status=active&page=2')

      await wrapper.find('[data-testid=search-clear-button]').trigger('click')
      await flushPromises()

      expect(router.currentRoute.value.query).toEqual({ status: 'active' })
      expect(fetchPolicyList).toHaveBeenLastCalledWith({ q: undefined, status: 'active', page: 1 })
    })
  })

  describe('filter', () => {
    it('changing status drops the page and keeps q', async () => {
      vi.mocked(fetchPolicyList).mockResolvedValue(listResponse([policy()], { total_count: 45 }))

      const { wrapper, router } = await mountView('/policies?q=wifi&page=2')

      await wrapper.find('[data-testid=filter-status]').setValue('inactive')
      await flushPromises()

      expect(router.currentRoute.value.query).toEqual({ q: 'wifi', status: 'inactive' })
      expect(fetchPolicyList).toHaveBeenLastCalledWith({ q: 'wifi', status: 'inactive', page: 1 })
    })

    it('filter-bar clear only clears status, keeping q (OQ-FE-2)', async () => {
      vi.mocked(fetchPolicyList).mockResolvedValue(listResponse([policy()], { total_count: 45 }))

      const { wrapper, router } = await mountView('/policies?q=wifi&status=active')

      await wrapper.find('[data-testid=filter-clear-button]').trigger('click')
      await flushPromises()

      expect(router.currentRoute.value.query).toEqual({ q: 'wifi' })
      expect(fetchPolicyList).toHaveBeenLastCalledWith({ q: 'wifi', status: undefined, page: 1 })
    })
  })

  describe('empty states', () => {
    it('shows "Chưa có policy nào" with the only "+ Thêm Policy" CTA when the org has no policies (A19)', async () => {
      vi.mocked(fetchPolicyList).mockResolvedValue(listResponse([]))

      const { wrapper } = await mountView('/policies')

      expect(wrapper.find('[data-testid=empty-state]').text()).toContain('Chưa có policy nào')
      expect(wrapper.find('[data-testid=empty-state-clear-button]').exists()).toBe(false)
      expect(wrapper.findAll('[data-testid=add-policy-button]')).toHaveLength(1)

      await wrapper.find('[data-testid=add-policy-button]').trigger('click')
      expect(wrapper.find('[data-testid=policy-form-modal]').exists()).toBe(true)
    })

    it('shows "Không tìm thấy policy nào" with a "Xóa bộ lọc" clearing both q and status (A20)', async () => {
      vi.mocked(fetchPolicyList).mockResolvedValue(listResponse([]))

      const { wrapper, router } = await mountView('/policies?q=khong-ton-tai&status=inactive')

      expect(wrapper.find('[data-testid=empty-state]').text()).toContain('Không tìm thấy policy nào')
      expect(
        wrapper.find('[data-testid=empty-state]').findAll('[data-testid=add-policy-button]'),
      ).toHaveLength(0)
      expect(wrapper.findAll('[data-testid=add-policy-button]')).toHaveLength(1)

      await wrapper.find('[data-testid=empty-state-clear-button]').trigger('click')
      await flushPromises()

      expect(router.currentRoute.value.query).toEqual({})
    })

    it('shows skeleton rows (not an empty state) during the very first load', async () => {
      let resolveFetch!: (value: PolicyListResponse) => void
      vi.mocked(fetchPolicyList).mockReturnValueOnce(
        new Promise<PolicyListResponse>((resolve) => {
          resolveFetch = resolve
        }),
      )

      const router = buildRouter()
      router.push('/policies')
      await router.isReady()
      const wrapper = mount(PolicyListView, { global: { plugins: [router] } })
      await flushPromises()

      expect(wrapper.findAll('[data-testid=skeleton-row]').length).toBeGreaterThan(0)
      expect(wrapper.find('[data-testid=empty-state]').exists()).toBe(false)
      expect(wrapper.find('[data-testid=policies-table]').exists()).toBe(false)

      resolveFetch(listResponse([policy()]))
      await flushPromises()

      expect(wrapper.find('[data-testid=policies-table]').exists()).toBe(true)
    })
  })

  it('shows an error banner with a retry button and refetches on retry (A25)', async () => {
    vi.mocked(fetchPolicyList).mockRejectedValueOnce({ response: { status: 500, data: {} } })

    const { wrapper } = await mountView('/policies')

    expect(wrapper.find('[data-testid=error-banner]').text()).toContain(
      'Không tải được danh sách policy.',
    )
    expect(wrapper.find('[data-testid=policies-table]').exists()).toBe(false)
    expect(wrapper.find('[data-testid=policy-search-input]').exists()).toBe(true)

    vi.mocked(fetchPolicyList).mockResolvedValueOnce(listResponse([policy()]))
    await wrapper.find('[data-testid=retry-button]').trigger('click')
    await flushPromises()

    expect(fetchPolicyList).toHaveBeenCalledTimes(2)
    expect(wrapper.find('[data-testid=error-banner]').exists()).toBe(false)
  })

  describe('row actions menu (F8 reopens "Xem chi tiết", A28/A29)', () => {
    it('offers "Sửa", the toggle label, then "Xem chi tiết" — 3 items, in that order', async () => {
      vi.mocked(fetchPolicyList).mockResolvedValue(listResponse([policy({ status: 'active' })]))

      const { wrapper } = await mountView('/policies')
      await wrapper.find('[data-testid=actions-menu-trigger]').trigger('click')

      const items = wrapper.findAll('.dropdown-item')
      expect(items.map((item) => item.text())).toEqual(['Sửa', 'Vô hiệu hoá', 'Xem chi tiết'])
    })

    it('labels the toggle "Kích hoạt" for an inactive policy', async () => {
      vi.mocked(fetchPolicyList).mockResolvedValue(listResponse([policy({ status: 'inactive' })]))

      const { wrapper } = await mountView('/policies')
      await wrapper.find('[data-testid=actions-menu-trigger]').trigger('click')

      const items = wrapper.findAll('.dropdown-item')
      expect(items.map((item) => item.text())).toEqual(['Sửa', 'Kích hoạt', 'Xem chi tiết'])
    })

    it('"Xem chi tiết" navigates to the detail page without opening the edit modal', async () => {
      vi.mocked(fetchPolicyList).mockResolvedValue(listResponse([policy({ id: 8 })]))

      const { wrapper, router } = await mountView('/policies')
      await rowAction(wrapper, 'policy-action-view')
      await flushPromises()

      expect(router.currentRoute.value.path).toBe('/policies/8')
      expect(wrapper.find('[data-testid=policy-form-modal]').exists()).toBe(false)
    })
  })

  describe('create / edit', () => {
    it('opens the edit modal prefilled from the row, without an extra API call', async () => {
      vi.mocked(fetchPolicyList).mockResolvedValue(
        listResponse([policy({ id: 5, name: 'Wifi mặc định', type: 'wifi' })]),
      )
      const { wrapper } = await mountView('/policies')
      const callsBefore = vi.mocked(fetchPolicyList).mock.calls.length

      await rowAction(wrapper, 'policy-action-edit')

      expect((wrapper.find('[data-testid=policy-form-name]').element as HTMLInputElement).value).toBe(
        'Wifi mặc định',
      )
      expect(fetchPolicyList).toHaveBeenCalledTimes(callsBefore)
    })

    it('after creating: closes the modal, toasts, returns to page 1 keeping q/status, and refetches', async () => {
      vi.mocked(fetchPolicyList).mockResolvedValue(listResponse([policy()], { total_count: 45 }))
      vi.mocked(createPolicy).mockResolvedValueOnce({ policy: policy({ id: 99, name: 'New Policy' }) })

      const { wrapper, router } = await mountView('/policies?q=wifi&status=active&page=2')
      const callsBefore = vi.mocked(fetchPolicyList).mock.calls.length

      await wrapper.find('[data-testid=add-policy-button]').trigger('click')
      await wrapper.find('[data-testid=policy-form-name]').setValue('New Policy')
      await wrapper.find('[data-testid=policy-form-type]').setValue('wifi')
      await wrapper.find('[data-testid=policy-form-configuration]').setValue('{}')
      await wrapper.find('form').trigger('submit')
      await flushPromises()

      expect(wrapper.find('[data-testid=policy-form-modal]').exists()).toBe(false)
      expect(wrapper.find('[data-testid=toast]').text()).toContain('Đã tạo policy')
      expect(router.currentRoute.value.query).toEqual({ q: 'wifi', status: 'active' })
      expect(vi.mocked(fetchPolicyList).mock.calls.length).toBe(callsBefore + 1)
      expect(fetchPolicyList).toHaveBeenLastCalledWith({ q: 'wifi', status: 'active', page: 1 })
    })

    it('after editing: closes the modal, toasts, and refetches the same q/status/page', async () => {
      vi.mocked(fetchPolicyList).mockResolvedValue(
        listResponse([policy({ id: 5 })], { current_page: 2, total_count: 45 }),
      )
      vi.mocked(updatePolicy).mockResolvedValueOnce({ policy: policy({ id: 5, name: 'Renamed' }) })

      const { wrapper, router } = await mountView('/policies?q=wifi&status=active&page=2')

      await rowAction(wrapper, 'policy-action-edit')
      await wrapper.find('[data-testid=policy-form-name]').setValue('Renamed')
      await wrapper.find('form').trigger('submit')
      await flushPromises()

      expect(wrapper.find('[data-testid=policy-form-modal]').exists()).toBe(false)
      expect(wrapper.find('[data-testid=toast]').text()).toContain('Đã cập nhật policy')
      expect(router.currentRoute.value.query).toEqual({ q: 'wifi', status: 'active', page: '2' })
      expect(fetchPolicyList).toHaveBeenLastCalledWith({ q: 'wifi', status: 'active', page: 2 })
    })
  })

  describe('toggle status (§2.3)', () => {
    it('toggles active -> inactive, toasts, and refetches (no optimistic update)', async () => {
      vi.mocked(fetchPolicyList).mockResolvedValueOnce(listResponse([policy({ id: 5, status: 'active' })]))
      let resolveUpdate!: (value: { policy: Policy }) => void
      vi.mocked(updatePolicy).mockReturnValueOnce(
        new Promise((resolve) => {
          resolveUpdate = resolve
        }),
      )

      const { wrapper } = await mountView('/policies')
      await wrapper.find('[data-testid=actions-menu-trigger]').trigger('click')
      await wrapper.find('[data-testid=policy-action-toggle-status]').trigger('click')

      expect(updatePolicy).toHaveBeenCalledWith(5, { status: 'inactive' })
      // Not optimistic: the row still shows the old status until refetch completes.
      expect(wrapper.find('[data-field=status]').text()).toBe('active')

      vi.mocked(fetchPolicyList).mockResolvedValueOnce(
        listResponse([policy({ id: 5, status: 'inactive' })]),
      )
      resolveUpdate({ policy: policy({ id: 5, status: 'inactive' }) })
      await flushPromises()

      expect(wrapper.find('[data-testid=toast]').text()).toContain('Đã vô hiệu hoá policy')
      expect(wrapper.find('[data-field=status]').text()).toBe('inactive')
    })

    it('toggles inactive -> active with the matching toast', async () => {
      vi.mocked(fetchPolicyList).mockResolvedValue(listResponse([policy({ id: 5, status: 'inactive' })]))
      vi.mocked(updatePolicy).mockResolvedValueOnce({ policy: policy({ id: 5, status: 'active' }) })

      const { wrapper } = await mountView('/policies')
      await rowAction(wrapper, 'policy-action-toggle-status')
      await flushPromises()

      expect(updatePolicy).toHaveBeenCalledWith(5, { status: 'active' })
      expect(wrapper.find('[data-testid=toast]').text()).toContain('Đã kích hoạt policy')
    })

    it('single-flight per row: a second click while the first PATCH is in flight is ignored', async () => {
      vi.mocked(fetchPolicyList).mockResolvedValue(listResponse([policy({ id: 5, status: 'active' })]))
      let resolveUpdate!: (value: { policy: Policy }) => void
      vi.mocked(updatePolicy).mockReturnValueOnce(
        new Promise((resolve) => {
          resolveUpdate = resolve
        }),
      )

      const { wrapper } = await mountView('/policies')
      await wrapper.find('[data-testid=actions-menu-trigger]').trigger('click')
      const toggleItem = wrapper.find('[data-testid=policy-action-toggle-status]')
      await toggleItem.trigger('click')
      // Menu closes on click; disabled state is asserted via a fresh menu open.
      await wrapper.find('[data-testid=actions-menu-trigger]').trigger('click')
      expect(wrapper.find('[data-testid=policy-action-toggle-status]').attributes('disabled')).toBeDefined()
      expect(wrapper.find('[data-testid=policy-action-edit]').attributes('disabled')).toBeDefined()

      resolveUpdate({ policy: policy({ id: 5, status: 'inactive' }) })
      await flushPromises()

      expect(updatePolicy).toHaveBeenCalledTimes(1)
    })

    it('shows an error toast and does not change the row on failure', async () => {
      vi.mocked(fetchPolicyList).mockResolvedValue(listResponse([policy({ id: 5, status: 'active' })]))
      vi.mocked(updatePolicy).mockRejectedValueOnce({ response: { status: 500, data: {} } })

      const { wrapper } = await mountView('/policies')
      await rowAction(wrapper, 'policy-action-toggle-status')
      await flushPromises()

      expect(wrapper.find('[data-testid=toast]').text()).toContain(
        'Không cập nhật được trạng thái, vui lòng thử lại.',
      )
      expect(wrapper.find('[data-field=status]').text()).toBe('active')
    })
  })

  describe('deactivate confirm — F8 carry-over (F7 OQ-9), §2.1.1', () => {
    it('deactivating with assignments_count > 0 asks for confirmation instead of PATCHing directly (A21)', async () => {
      vi.mocked(fetchPolicyList).mockResolvedValue(
        listResponse([policy({ id: 5, status: 'active', assignments_count: 7 })]),
      )

      const { wrapper } = await mountView('/policies')
      await rowAction(wrapper, 'policy-action-toggle-status')

      expect(updatePolicy).not.toHaveBeenCalled()
      expect(wrapper.find('[data-testid=policy-deactivate-confirm]').text()).toContain(
        'Policy đang được gán cho 7 group/device.',
      )
    })

    it('PATCHes only after the confirm is accepted', async () => {
      vi.mocked(fetchPolicyList).mockResolvedValue(
        listResponse([policy({ id: 5, status: 'active', assignments_count: 7 })]),
      )
      vi.mocked(updatePolicy).mockResolvedValueOnce({ policy: policy({ id: 5, status: 'inactive' }) })

      const { wrapper } = await mountView('/policies')
      await rowAction(wrapper, 'policy-action-toggle-status')
      await wrapper.find('[data-testid=policy-deactivate-confirm-confirm]').trigger('click')
      await flushPromises()

      expect(updatePolicy).toHaveBeenCalledWith(5, { status: 'inactive' })
      expect(wrapper.find('[data-testid=toast]').text()).toContain('Đã vô hiệu hoá policy')
    })

    it('cancelling the confirm leaves the policy untouched', async () => {
      vi.mocked(fetchPolicyList).mockResolvedValue(
        listResponse([policy({ id: 5, status: 'active', assignments_count: 7 })]),
      )

      const { wrapper } = await mountView('/policies')
      await rowAction(wrapper, 'policy-action-toggle-status')
      await wrapper.find('[data-testid=policy-deactivate-confirm-cancel]').trigger('click')
      await flushPromises()

      expect(updatePolicy).not.toHaveBeenCalled()
      expect(wrapper.find('[data-testid=policy-deactivate-confirm]').exists()).toBe(false)
    })

    it('activating (inactive -> active) never confirms, regardless of assignments_count (A22)', async () => {
      vi.mocked(fetchPolicyList).mockResolvedValue(
        listResponse([policy({ id: 5, status: 'inactive', assignments_count: 9 })]),
      )
      vi.mocked(updatePolicy).mockResolvedValueOnce({ policy: policy({ id: 5, status: 'active' }) })

      const { wrapper } = await mountView('/policies')
      await rowAction(wrapper, 'policy-action-toggle-status')
      await flushPromises()

      expect(wrapper.find('[data-testid=policy-deactivate-confirm]').exists()).toBe(false)
      expect(updatePolicy).toHaveBeenCalledWith(5, { status: 'active' })
    })
  })
})
