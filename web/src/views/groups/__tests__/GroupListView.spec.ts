import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { createRouter, createMemoryHistory, type Router } from 'vue-router'
import { setActivePinia, createPinia } from 'pinia'
import GroupListView from '../GroupListView.vue'
import { fetchGroupList, createGroup, updateGroup, deleteGroup } from '../../../api/groups'
import type { Group, GroupListResponse } from '../../../types/group'

vi.mock('../../../api/groups', () => ({
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

function listResponse(
  groups: Group[],
  meta: Partial<GroupListResponse['meta']> = {},
): GroupListResponse {
  const totalCount = meta.total_count ?? groups.length
  const perPage = meta.per_page ?? 20
  return {
    groups,
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
      { path: '/groups', name: 'groups', component: GroupListView },
    ],
  })
}

async function mountView(path = '/groups'): Promise<{ wrapper: VueWrapper; router: Router }> {
  const router = buildRouter()
  router.push(path)
  await router.isReady()

  const wrapper = mount(GroupListView, { global: { plugins: [router] } })
  await flushPromises()
  return { wrapper, router }
}

/** Opens the "⋯" menu of the first row and clicks one of its items. */
async function rowAction(wrapper: VueWrapper, testId: string) {
  await wrapper.find('[data-testid=actions-menu-trigger]').trigger('click')
  await wrapper.find(`[data-testid=${testId}]`).trigger('click')
}

describe('GroupListView', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('loads the first page with no search term when the URL is bare', async () => {
    vi.mocked(fetchGroupList).mockResolvedValue(
      listResponse([group(), group({ id: 2, name: 'Engineering' })], { total_count: 2 }),
    )

    const { wrapper } = await mountView('/groups')

    expect(fetchGroupList).toHaveBeenCalledWith({ q: undefined, page: 1 })
    expect(wrapper.findAll('[data-testid=group-row]')).toHaveLength(2)
  })

  it('hydrates the search term and page straight from the URL (shared link)', async () => {
    vi.mocked(fetchGroupList).mockResolvedValue(
      listResponse([group()], { current_page: 2, total_count: 25 }),
    )

    const { wrapper } = await mountView('/groups?q=sales&page=2')

    expect(fetchGroupList).toHaveBeenCalledWith({ q: 'sales', page: 2 })
    expect((wrapper.find('[data-testid=group-search-input]').element as HTMLInputElement).value).toBe(
      'sales',
    )
    expect(wrapper.find('[data-testid=pagination-page-indicator]').text()).toContain('Trang 2')
  })

  it('sanitizes a hand-edited page and a whitespace-only q', async () => {
    vi.mocked(fetchGroupList).mockResolvedValue(listResponse([group()]))

    await mountView('/groups?q=%20%20&page=abc')

    expect(fetchGroupList).toHaveBeenCalledWith({ q: undefined, page: 1 })
  })

  it('renders Name and Description columns, with an em dash (never "null") for no description', async () => {
    vi.mocked(fetchGroupList).mockResolvedValue(
      listResponse([group({ id: 3, name: 'Kho thiết bị', description: null })]),
    )

    const { wrapper } = await mountView('/groups')

    expect(wrapper.find('[data-field=name]').text()).toBe('Kho thiết bị')
    expect(wrapper.find('[data-field=description]').text()).toBe('—')
    expect(wrapper.text()).not.toContain('null')
  })

  it('puts the full description in a title attribute so truncation hides nothing', async () => {
    const long = 'Đội kinh doanh khu vực miền Nam'.repeat(10)
    vi.mocked(fetchGroupList).mockResolvedValue(listResponse([group({ description: long })]))

    const { wrapper } = await mountView('/groups')

    expect(wrapper.find('[data-field=description] .cell-truncate').attributes('title')).toBe(long)
  })

  describe('search', () => {
    it('writes the term into the URL and drops the page (back to page 1)', async () => {
      vi.useFakeTimers()
      vi.mocked(fetchGroupList).mockResolvedValue(
        listResponse([group()], { current_page: 2, total_count: 25 }),
      )
      const router = buildRouter()
      router.push('/groups?page=2')
      await router.isReady()
      const wrapper = mount(GroupListView, { global: { plugins: [router] } })
      await flushPromises()

      await wrapper.find('[data-testid=group-search-input]').setValue('sales')
      vi.advanceTimersByTime(300)
      await flushPromises()

      expect(router.currentRoute.value.query).toEqual({ q: 'sales' })
      expect(fetchGroupList).toHaveBeenLastCalledWith({ q: 'sales', page: 1 })
    })

    it('keeps the search term when the page changes', async () => {
      vi.mocked(fetchGroupList).mockResolvedValue(
        listResponse([group()], { current_page: 1, total_count: 45 }),
      )

      const { wrapper, router } = await mountView('/groups?q=sales')

      await wrapper.find('[data-testid=pagination-next]').trigger('click')
      await flushPromises()

      expect(router.currentRoute.value.query).toEqual({ q: 'sales', page: '2' })
      expect(fetchGroupList).toHaveBeenLastCalledWith({ q: 'sales', page: 2 })
    })

    it('clears both q and page from the URL via the search box\'s clear button', async () => {
      vi.mocked(fetchGroupList).mockResolvedValue(listResponse([group()], { total_count: 45 }))

      const { wrapper, router } = await mountView('/groups?q=sales&page=2')

      await wrapper.find('[data-testid=search-clear-button]').trigger('click')
      await flushPromises()

      expect(router.currentRoute.value.query).toEqual({})
      expect(fetchGroupList).toHaveBeenLastCalledWith({ q: undefined, page: 1 })
    })
  })

  describe('empty states', () => {
    it('shows "Chưa có group nào" with the only "+ Thêm Group" CTA when the org has no groups', async () => {
      vi.mocked(fetchGroupList).mockResolvedValue(listResponse([]))

      const { wrapper } = await mountView('/groups')

      expect(wrapper.find('[data-testid=empty-state]').text()).toContain('Chưa có group nào')
      expect(wrapper.find('[data-testid=empty-state-clear-search-button]').exists()).toBe(false)
      // The list-head button hides while this variant's own CTA is up.
      expect(wrapper.findAll('[data-testid=add-group-button]')).toHaveLength(1)

      await wrapper.find('[data-testid=add-group-button]').trigger('click')
      expect(wrapper.find('[data-testid=group-form-modal]').exists()).toBe(true)
    })

    it('shows "Không tìm thấy group nào" with a clear-search button (and no create CTA) when the search matches nothing', async () => {
      vi.mocked(fetchGroupList).mockResolvedValue(listResponse([]))

      const { wrapper, router } = await mountView('/groups?q=khong-ton-tai')

      expect(wrapper.find('[data-testid=empty-state]').text()).toContain('Không tìm thấy group nào')
      expect(wrapper.find('[data-testid=empty-state]').findAll('[data-testid=add-group-button]')).toHaveLength(
        0,
      )
      // The list-head button is still there in this variant.
      expect(wrapper.findAll('[data-testid=add-group-button]')).toHaveLength(1)

      await wrapper.find('[data-testid=empty-state-clear-search-button]').trigger('click')
      await flushPromises()

      expect(router.currentRoute.value.query).toEqual({})
    })

    it('shows skeleton rows (not an empty state) during the very first load', async () => {
      let resolveFetch!: (value: GroupListResponse) => void
      vi.mocked(fetchGroupList).mockReturnValueOnce(
        new Promise<GroupListResponse>((resolve) => {
          resolveFetch = resolve
        }),
      )

      const router = buildRouter()
      router.push('/groups')
      await router.isReady()
      const wrapper = mount(GroupListView, { global: { plugins: [router] } })
      await flushPromises()

      expect(wrapper.findAll('[data-testid=skeleton-row]').length).toBeGreaterThan(0)
      expect(wrapper.find('[data-testid=empty-state]').exists()).toBe(false)
      expect(wrapper.find('[data-testid=groups-table]').exists()).toBe(false)

      resolveFetch(listResponse([group()]))
      await flushPromises()

      expect(wrapper.find('[data-testid=groups-table]').exists()).toBe(true)
    })
  })

  it('shows an error banner with a retry button and refetches on retry', async () => {
    vi.mocked(fetchGroupList).mockRejectedValueOnce({ response: { status: 500, data: {} } })

    const { wrapper } = await mountView('/groups')

    expect(wrapper.find('[data-testid=error-banner]').text()).toContain('Không tải được danh sách group.')
    expect(wrapper.find('[data-testid=groups-table]').exists()).toBe(false)
    // The search box stays usable while the table is in error.
    expect(wrapper.find('[data-testid=group-search-input]').exists()).toBe(true)

    vi.mocked(fetchGroupList).mockResolvedValueOnce(listResponse([group()]))
    await wrapper.find('[data-testid=retry-button]').trigger('click')
    await flushPromises()

    expect(fetchGroupList).toHaveBeenCalledTimes(2)
    expect(wrapper.find('[data-testid=error-banner]').exists()).toBe(false)
    expect(wrapper.findAll('[data-testid=group-row]')).toHaveLength(1)
  })

  describe('row actions menu', () => {
    it('offers exactly "Sửa" and "Xóa" — no detail action, nothing disabled', async () => {
      vi.mocked(fetchGroupList).mockResolvedValue(listResponse([group()]))

      const { wrapper } = await mountView('/groups')
      await wrapper.find('[data-testid=actions-menu-trigger]').trigger('click')

      const items = wrapper.findAll('.dropdown-item')
      expect(items.map((item) => item.text())).toEqual(['Sửa', 'Xóa'])
      expect(items.every((item) => item.attributes('disabled') === undefined)).toBe(true)
      expect(wrapper.text()).not.toContain('Xem chi tiết')
    })

    it('does not navigate anywhere when a row is clicked (no group detail page)', async () => {
      vi.mocked(fetchGroupList).mockResolvedValue(listResponse([group({ id: 7 })]))

      const { wrapper, router } = await mountView('/groups')

      await wrapper.find('[data-field=name]').trigger('click')
      await flushPromises()

      expect(router.currentRoute.value.path).toBe('/groups')
    })
  })

  describe('create / edit', () => {
    it('opens the edit modal prefilled from the row, without an extra API call', async () => {
      vi.mocked(fetchGroupList).mockResolvedValue(
        listResponse([group({ id: 5, name: 'Engineering', description: 'Máy dev & QA' })]),
      )
      const { wrapper } = await mountView('/groups')
      const callsBefore = vi.mocked(fetchGroupList).mock.calls.length

      await rowAction(wrapper, 'group-action-edit')

      expect((wrapper.find('[data-testid=group-form-name]').element as HTMLInputElement).value).toBe(
        'Engineering',
      )
      expect(
        (wrapper.find('[data-testid=group-form-description]').element as HTMLTextAreaElement).value,
      ).toBe('Máy dev & QA')
      expect(fetchGroupList).toHaveBeenCalledTimes(callsBefore)
    })

    it('after creating: closes the modal, toasts, returns to page 1 keeping q, and refetches', async () => {
      vi.mocked(fetchGroupList).mockResolvedValue(listResponse([group()], { total_count: 45 }))
      vi.mocked(createGroup).mockResolvedValueOnce({ group: group({ id: 99, name: 'Group Mới Nhất' }) })

      const { wrapper, router } = await mountView('/groups?q=sales&page=2')
      const callsBefore = vi.mocked(fetchGroupList).mock.calls.length

      await wrapper.find('[data-testid=add-group-button]').trigger('click')
      await wrapper.find('[data-testid=group-form-name]').setValue('Group Mới Nhất')
      await wrapper.find('form').trigger('submit')
      await flushPromises()

      expect(wrapper.find('[data-testid=group-form-modal]').exists()).toBe(false)
      expect(wrapper.find('[data-testid=toast]').text()).toContain('Đã tạo group')
      expect(router.currentRoute.value.query).toEqual({ q: 'sales' })
      // Exactly one refetch: dropping `page` from the URL already triggers
      // the `watch(activeQuery, ...)` reload, so onSaved must not fire a
      // second, redundant GET on top of it.
      expect(vi.mocked(fetchGroupList).mock.calls.length).toBe(callsBefore + 1)
      expect(fetchGroupList).toHaveBeenLastCalledWith({ q: 'sales', page: 1 })
    })

    it('after creating from page 1: refetches exactly once (no watcher trigger to piggyback on)', async () => {
      vi.mocked(fetchGroupList).mockResolvedValue(listResponse([group()], { total_count: 3 }))
      vi.mocked(createGroup).mockResolvedValueOnce({ group: group({ id: 99, name: 'Group Mới Nhất' }) })

      const { wrapper } = await mountView('/groups')
      const callsBefore = vi.mocked(fetchGroupList).mock.calls.length

      await wrapper.find('[data-testid=add-group-button]').trigger('click')
      await wrapper.find('[data-testid=group-form-name]').setValue('Group Mới Nhất')
      await wrapper.find('form').trigger('submit')
      await flushPromises()

      expect(vi.mocked(fetchGroupList).mock.calls.length).toBe(callsBefore + 1)
    })

    it('after editing: closes the modal, toasts, and refetches the same q + page', async () => {
      vi.mocked(fetchGroupList).mockResolvedValue(
        listResponse([group({ id: 5, name: 'Engineering' })], { current_page: 2, total_count: 45 }),
      )
      vi.mocked(updateGroup).mockResolvedValueOnce({ group: group({ id: 5, name: 'Sales APAC' }) })

      const { wrapper, router } = await mountView('/groups?q=sales&page=2')

      await rowAction(wrapper, 'group-action-edit')
      await wrapper.find('[data-testid=group-form-name]').setValue('Sales APAC')
      await wrapper.find('form').trigger('submit')
      await flushPromises()

      expect(wrapper.find('[data-testid=group-form-modal]').exists()).toBe(false)
      expect(wrapper.find('[data-testid=toast]').text()).toContain('Đã cập nhật group')
      expect(router.currentRoute.value.query).toEqual({ q: 'sales', page: '2' })
      expect(fetchGroupList).toHaveBeenLastCalledWith({ q: 'sales', page: 2 })
    })

    it('closes the edit modal with an error toast and refetches when the group is already gone (404)', async () => {
      vi.mocked(fetchGroupList).mockResolvedValue(listResponse([group({ id: 5 })]))
      vi.mocked(updateGroup).mockRejectedValueOnce({
        response: { status: 404, data: { error: 'Not found' } },
      })

      const { wrapper } = await mountView('/groups')
      const callsBefore = vi.mocked(fetchGroupList).mock.calls.length

      await rowAction(wrapper, 'group-action-edit')
      await wrapper.find('[data-testid=group-form-name]').setValue('Sales APAC')
      await wrapper.find('form').trigger('submit')
      await flushPromises()

      expect(wrapper.find('[data-testid=group-form-modal]').exists()).toBe(false)
      expect(wrapper.find('[data-testid=toast]').text()).toContain('Group không tồn tại hoặc đã bị xóa')
      expect(vi.mocked(fetchGroupList).mock.calls.length).toBe(callsBefore + 1)
    })
  })

  describe('delete', () => {
    it('asks for confirmation first — no request, and the row is still there', async () => {
      vi.mocked(fetchGroupList).mockResolvedValue(listResponse([group()]))

      const { wrapper } = await mountView('/groups')
      await rowAction(wrapper, 'group-action-delete')

      const dialog = wrapper.find('[data-testid=confirm-modal]')
      expect(dialog.exists()).toBe(true)
      expect(dialog.text()).toContain('không thể hoàn tác')
      expect(dialog.text()).toContain('Thiết bị và policy không bị xóa')
      expect(dialog.text()).toContain('Sales Team')
      expect(deleteGroup).not.toHaveBeenCalled()
      expect(wrapper.findAll('[data-testid=group-row]')).toHaveLength(1)
    })

    it('cancelling sends no request and leaves the row in place', async () => {
      vi.mocked(fetchGroupList).mockResolvedValue(listResponse([group()]))

      const { wrapper } = await mountView('/groups')
      await rowAction(wrapper, 'group-action-delete')
      await wrapper.find('[data-testid=confirm-modal-cancel]').trigger('click')

      expect(wrapper.find('[data-testid=confirm-modal]').exists()).toBe(false)
      expect(deleteGroup).not.toHaveBeenCalled()
      expect(wrapper.findAll('[data-testid=group-row]')).toHaveLength(1)
    })

    it('on 204: closes the dialog, toasts, and refetches (the row disappears only then)', async () => {
      vi.mocked(fetchGroupList).mockResolvedValueOnce(listResponse([group({ id: 7 })], { total_count: 1 }))
      vi.mocked(deleteGroup).mockResolvedValueOnce(undefined)

      const { wrapper } = await mountView('/groups')
      await rowAction(wrapper, 'group-action-delete')

      vi.mocked(fetchGroupList).mockResolvedValueOnce(listResponse([]))
      await wrapper.find('[data-testid=confirm-modal-confirm]').trigger('click')
      await flushPromises()

      expect(deleteGroup).toHaveBeenCalledWith(7)
      expect(wrapper.find('[data-testid=confirm-modal]').exists()).toBe(false)
      expect(wrapper.find('[data-testid=toast]').text()).toContain('Đã xóa group')
      expect(fetchGroupList).toHaveBeenCalledTimes(2)
      expect(wrapper.findAll('[data-testid=group-row]')).toHaveLength(0)
    })

    it('on 404: closes the dialog, shows the "already deleted" toast, and refetches', async () => {
      vi.mocked(fetchGroupList).mockResolvedValueOnce(listResponse([group({ id: 7 })], { total_count: 1 }))
      vi.mocked(deleteGroup).mockRejectedValueOnce({
        response: { status: 404, data: { error: 'Not found' } },
      })

      const { wrapper } = await mountView('/groups')
      await rowAction(wrapper, 'group-action-delete')

      vi.mocked(fetchGroupList).mockResolvedValueOnce(listResponse([]))
      await wrapper.find('[data-testid=confirm-modal-confirm]').trigger('click')
      await flushPromises()

      expect(wrapper.find('[data-testid=confirm-modal]').exists()).toBe(false)
      expect(wrapper.find('[data-testid=toast]').text()).toContain('Group không tồn tại hoặc đã bị xóa')
      expect(fetchGroupList).toHaveBeenCalledTimes(2)
      expect(wrapper.findAll('[data-testid=group-row]')).toHaveLength(0)
    })

    it('on 500: keeps the dialog open, toasts, does not refetch, and the row stays', async () => {
      vi.mocked(fetchGroupList).mockResolvedValue(listResponse([group({ id: 7 })], { total_count: 1 }))
      vi.mocked(deleteGroup).mockRejectedValueOnce({ response: { status: 500, data: {} } })

      const { wrapper } = await mountView('/groups')
      await rowAction(wrapper, 'group-action-delete')
      const callsBefore = vi.mocked(fetchGroupList).mock.calls.length

      await wrapper.find('[data-testid=confirm-modal-confirm]').trigger('click')
      await flushPromises()

      expect(wrapper.find('[data-testid=confirm-modal]').exists()).toBe(true)
      expect(wrapper.find('[data-testid=toast]').text()).toContain(
        'Không xóa được group, vui lòng thử lại.',
      )
      expect(vi.mocked(fetchGroupList).mock.calls.length).toBe(callsBefore)
      expect(wrapper.findAll('[data-testid=group-row]')).toHaveLength(1)
      // The button is enabled again so the user can retry (A13).
      expect(wrapper.find('[data-testid=confirm-modal-confirm]').attributes('disabled')).toBeUndefined()
    })

    it('sends one request only when the confirm button is clicked twice (A24)', async () => {
      vi.mocked(fetchGroupList).mockResolvedValue(listResponse([group({ id: 7 })], { total_count: 1 }))
      let resolveDelete!: () => void
      vi.mocked(deleteGroup).mockReturnValueOnce(
        new Promise<void>((resolve) => {
          resolveDelete = resolve
        }),
      )

      const { wrapper } = await mountView('/groups')
      await rowAction(wrapper, 'group-action-delete')

      const confirm = wrapper.find('[data-testid=confirm-modal-confirm]')
      await confirm.trigger('click')
      await confirm.trigger('click')

      expect(deleteGroup).toHaveBeenCalledTimes(1)

      resolveDelete()
      await flushPromises()
    })

    it('falls back to page 1 after deleting the last row of a later page (S27)', async () => {
      vi.mocked(fetchGroupList).mockResolvedValueOnce(
        listResponse([group({ id: 21 })], { current_page: 2, total_count: 21 }),
      )
      vi.mocked(deleteGroup).mockResolvedValueOnce(undefined)

      const { wrapper, router } = await mountView('/groups?page=2')

      await rowAction(wrapper, 'group-action-delete')

      // Refetch of page 2 after the delete comes back empty — the whole
      // (searched) set is gone, so `total_pages` is 0 and only the
      // "total_count === 0 && page > 1" branch can rescue the blank page.
      vi.mocked(fetchGroupList).mockResolvedValueOnce(
        listResponse([], { current_page: 2, total_count: 0, total_pages: 0 }),
      )
      vi.mocked(fetchGroupList).mockResolvedValueOnce(
        listResponse([group({ id: 1 })], { current_page: 1, total_count: 20 }),
      )
      await wrapper.find('[data-testid=confirm-modal-confirm]').trigger('click')
      await flushPromises()

      expect(router.currentRoute.value.query).toEqual({})
      expect(fetchGroupList).toHaveBeenLastCalledWith({ q: undefined, page: 1 })
    })

    it('walks back to the last real page when the current one is past the end', async () => {
      vi.mocked(fetchGroupList).mockResolvedValue(
        listResponse([group()], { current_page: 999, total_count: 25, total_pages: 2 }),
      )

      const { router } = await mountView('/groups?page=999')
      await flushPromises()

      expect(router.currentRoute.value.query).toEqual({ page: '2' })
      expect(fetchGroupList).toHaveBeenLastCalledWith({ q: undefined, page: 2 })
    })
  })
})
