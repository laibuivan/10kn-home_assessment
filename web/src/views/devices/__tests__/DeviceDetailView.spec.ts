import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { createRouter, createMemoryHistory, type Router } from 'vue-router'
import { setActivePinia, createPinia } from 'pinia'
import DeviceDetailView from '../DeviceDetailView.vue'
import { useDevicesStore } from '../../../stores/devices'
import { fetchDevice, updateDevice, fetchAppliedPolicies } from '../../../api/devices'
import { fetchGroupList } from '../../../api/groups'
import { addGroupDevices, removeGroupDevice } from '../../../api/group-memberships'
import type { DeviceDetail } from '../../../types/device'
import type { Group, GroupListResponse } from '../../../types/group'

vi.mock('../../../api/devices', () => ({
  fetchDevice: vi.fn(),
  updateDevice: vi.fn(),
  createDevice: vi.fn(),
  fetchDeviceList: vi.fn(),
  fetchAppliedPolicies: vi.fn(),
}))

vi.mock('../../../api/groups', () => ({
  fetchGroupList: vi.fn(),
  fetchGroup: vi.fn(),
  createGroup: vi.fn(),
  updateGroup: vi.fn(),
  deleteGroup: vi.fn(),
}))

vi.mock('../../../api/group-memberships', () => ({
  fetchGroupDevices: vi.fn(),
  addGroupDevices: vi.fn(),
  removeGroupDevice: vi.fn(),
}))

function group(overrides: Partial<Group> = {}): Group {
  return {
    id: 3,
    name: 'Engineering',
    description: 'Máy dev & QA',
    devices_count: 4,
    created_at: '2026-09-16T08:00:00.000Z',
    updated_at: '2026-09-16T08:00:00.000Z',
    ...overrides,
  }
}

function groupListResponse(groups: Group[]): GroupListResponse {
  return {
    groups,
    meta: { current_page: 1, per_page: 20, total_count: groups.length, total_pages: 1 },
  }
}

function device(overrides: Partial<DeviceDetail> = {}): DeviceDetail {
  return {
    id: 42,
    identifier: 'IOS-0001',
    name: 'iPhone 14',
    platform: 'ios',
    os_version: '17.4.1',
    status: 'active',
    last_seen_at: '2026-09-15T08:00:00.000Z',
    created_at: '2026-09-15T08:00:00.000Z',
    updated_at: '2026-09-15T08:00:00.000Z',
    groups: [],
    ...overrides,
  }
}

function buildRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', redirect: '/devices' },
      { path: '/login', name: 'login', component: { template: '<div />' } },
      { path: '/devices', name: 'devices', component: { template: '<div />' } },
      { path: '/devices/:id', name: 'device-detail', component: DeviceDetailView, props: true },
      { path: '/groups', name: 'groups', component: { template: '<div />' } },
      { path: '/groups/:id', name: 'group-detail', component: { template: '<div />' } },
    ],
  })
}

async function mountView(path: string): Promise<{ wrapper: VueWrapper; router: Router }> {
  const router = buildRouter()
  router.push(path)
  await router.isReady()

  const wrapper = mount(DeviceDetailView, { global: { plugins: [router] } })
  await flushPromises()
  // 2nd tick: AppliedPoliciesBlock only starts its own fetch once `device`
  // exists (F9-frontend.md §3.1), so 1 flush is not enough to also resolve
  // that child fetch.
  await flushPromises()
  return { wrapper, router }
}

function notFoundError() {
  return { response: { status: 404, data: { error: 'Not found' } } }
}

describe('DeviceDetailView', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    vi.clearAllMocks()
    // Default for every test that doesn't care about the policies block's
    // content — only the tests in `describe('groups block (F6)')`-adjacent
    // policy scenarios (none in this file, see AppliedPoliciesBlock.spec.ts)
    // would override this.
    vi.mocked(fetchAppliedPolicies).mockResolvedValue({ applied_policies: [] })
  })

  it("shows the device's full information and the empty group/policy blocks on success", async () => {
    vi.mocked(fetchDevice).mockResolvedValue({ device: device() })

    const { wrapper } = await mountView('/devices/42')

    expect(fetchDevice).toHaveBeenCalledWith('42')
    expect(wrapper.find('[data-testid=device-detail-identifier]').text()).toBe('IOS-0001')
    expect(wrapper.find('[data-testid=device-detail-name]').text()).toBe('iPhone 14')
    expect(wrapper.find('[data-testid=device-detail-status]').exists()).toBe(true)
    expect(wrapper.find('[data-testid=device-detail-groups-empty]').text()).toContain('Chưa thuộc group nào.')
    expect(wrapper.find('[data-testid=device-detail-policies-empty]').text()).toContain(
      'Chưa có policy nào áp dụng.',
    )
  })

  it('hides the Edit button and shows the neutral banner for a retired device', async () => {
    vi.mocked(fetchDevice).mockResolvedValue({ device: device({ status: 'retired' }) })

    const { wrapper } = await mountView('/devices/42')

    expect(wrapper.find('[data-testid=device-detail-edit-button]').exists()).toBe(false)
    expect(wrapper.find('[data-testid=device-detail-retired-banner]').text()).toContain(
      'Thiết bị đã retired — không thể chỉnh sửa.',
    )
  })

  it('shows a working Edit button for a non-retired device that opens the prefilled form', async () => {
    vi.mocked(fetchDevice).mockResolvedValue({ device: device() })

    const { wrapper } = await mountView('/devices/42')
    expect(wrapper.find('[data-testid=device-detail-retired-banner]').exists()).toBe(false)

    await wrapper.find('[data-testid=device-detail-edit-button]').trigger('click')

    expect(wrapper.find('[data-testid=device-form-modal]').exists()).toBe(true)
    expect((wrapper.find('[data-testid=device-form-identifier]').element as HTMLInputElement).value).toBe(
      'IOS-0001',
    )
  })

  it('refetches and updates the header immediately after a successful edit (no page reload)', async () => {
    vi.mocked(fetchDevice)
      .mockResolvedValueOnce({ device: device({ status: 'active' }) })
      .mockResolvedValueOnce({ device: device({ status: 'retired' }) })
    vi.mocked(updateDevice).mockResolvedValueOnce({ device: device({ status: 'retired' }) })

    const { wrapper } = await mountView('/devices/42')

    await wrapper.find('[data-testid=device-detail-edit-button]').trigger('click')
    await wrapper.find('[data-testid=device-form-status]').setValue('retired')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(wrapper.find('[data-testid=device-form-modal]').exists()).toBe(false)
    expect(wrapper.find('[data-testid=toast]').text()).toContain('Đã cập nhật device')
    expect(fetchDevice).toHaveBeenCalledTimes(2)
    expect(wrapper.find('[data-testid=device-detail-retired-banner]').exists()).toBe(true)
  })

  it('shows the not-found empty state (with a back link) for a 404', async () => {
    vi.mocked(fetchDevice).mockRejectedValue(notFoundError())

    const { wrapper } = await mountView('/devices/999999999')

    expect(wrapper.find('[data-testid=empty-state]').text()).toContain('Không tìm thấy thiết bị')
    expect(wrapper.find('[data-testid=device-detail-back-link]').exists()).toBe(true)
  })

  it('shows an error banner with retry for a non-404 failure, and retry reloads', async () => {
    vi.mocked(fetchDevice).mockRejectedValueOnce({ response: { status: 500, data: {} } })

    const { wrapper } = await mountView('/devices/42')

    expect(wrapper.find('[data-testid=error-banner]').exists()).toBe(true)
    expect(wrapper.find('[data-testid=empty-state]').exists()).toBe(false)

    vi.mocked(fetchDevice).mockResolvedValueOnce({ device: device() })
    await wrapper.find('[data-testid=retry-button]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid=error-banner]').exists()).toBe(false)
    expect(wrapper.find('[data-testid=device-detail-identifier]').exists()).toBe(true)
  })

  it('uses the last list location for "back to list" when available', async () => {
    vi.mocked(fetchDevice).mockResolvedValue({ device: device() })
    const { wrapper, router } = await mountView('/devices/42')
    const store = useDevicesStore()
    store.lastListLocation = '/devices?platform=ios&page=2'
    await wrapper.vm.$nextTick()

    const backLink = wrapper.find('[data-testid=device-detail-back-link]')
    await backLink.trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.fullPath).toBe('/devices?platform=ios&page=2')
  })

  it('falls back to a plain /devices when there is no last list location', async () => {
    vi.mocked(fetchDevice).mockResolvedValue({ device: device() })
    const { wrapper, router } = await mountView('/devices/42')

    const backLink = wrapper.find('[data-testid=device-detail-back-link]')
    await backLink.trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.path).toBe('/devices')
  })

  // ---------- F6: "Groups đang thuộc" ----------
  describe('groups block (F6)', () => {
    it('lists the real groups, each linking to its detail page', async () => {
      vi.mocked(fetchDevice).mockResolvedValue({
        device: device({ groups: [{ id: 3, name: 'Engineering' }, { id: 5, name: 'Loaner Pool' }] }),
      })

      const { wrapper } = await mountView('/devices/42')

      const rows = wrapper.findAll('[data-testid=device-detail-group-row]')
      expect(rows).toHaveLength(2)
      expect(rows[0].text()).toContain('Engineering')
      expect(rows[0].find('a').attributes('href')).toBe('/groups/3')
      // The empty placeholder is gone now that there is something to show.
      expect(wrapper.find('[data-testid=device-detail-groups-empty]').exists()).toBe(false)
    })

    it('keeps F4\'s empty placeholder when the device belongs to nothing (A25)', async () => {
      vi.mocked(fetchDevice).mockResolvedValue({ device: device({ groups: [] }) })

      const { wrapper } = await mountView('/devices/42')

      expect(wrapper.find('[data-testid=device-detail-groups-empty]').text()).toContain(
        'Chưa thuộc group nào.',
      )
      expect(wrapper.find('[data-testid=device-detail-groups-list]').exists()).toBe(false)
    })

    it('adds the device to a group through the modal, then refetches the device', async () => {
      vi.useFakeTimers()
      vi.mocked(fetchDevice).mockResolvedValue({ device: device({ groups: [] }) })
      vi.mocked(fetchGroupList).mockResolvedValue(groupListResponse([group({ id: 3 })]))
      vi.mocked(addGroupDevices).mockResolvedValueOnce({ added_count: 1, devices_count: 5 })

      const router = buildRouter()
      router.push('/devices/42')
      await router.isReady()
      const wrapper = mount(DeviceDetailView, { global: { plugins: [router] } })
      await flushPromises()
      // 2nd tick — same reason as mountView(): AppliedPoliciesBlock only
      // starts its own fetch once `device` exists (F9-frontend.md §3.1).
      await flushPromises()

      await wrapper.find('[data-testid=device-detail-add-group-button]').trigger('click')
      expect(wrapper.find('[data-testid=device-group-add-modal]').exists()).toBe(true)

      await wrapper.find('[data-testid=device-group-add-search]').setValue('eng')
      await vi.advanceTimersByTimeAsync(300)
      await wrapper.find('[data-testid=device-group-add-search-option]').trigger('click')

      vi.mocked(fetchDevice).mockResolvedValue({
        device: device({ groups: [{ id: 3, name: 'Engineering' }] }),
      })
      await wrapper.find('form').trigger('submit')
      await flushPromises()

      expect(addGroupDevices).toHaveBeenCalledWith(3, [42])
      expect(wrapper.find('[data-testid=device-group-add-modal]').exists()).toBe(false)
      expect(wrapper.find('[data-testid=toast]').text()).toContain('Đã thêm vào group')
      expect(fetchDevice).toHaveBeenCalledTimes(2)
      expect(wrapper.findAll('[data-testid=device-detail-group-row]')).toHaveLength(1)
      vi.useRealTimers()
    })

    it('asks for confirmation before removing, then removes and refetches on 204', async () => {
      vi.mocked(fetchDevice).mockResolvedValue({
        device: device({ groups: [{ id: 3, name: 'Engineering' }] }),
      })
      vi.mocked(removeGroupDevice).mockResolvedValueOnce(undefined)

      const { wrapper } = await mountView('/devices/42')

      await wrapper.find('[data-testid=device-detail-group-remove-button]').trigger('click')
      const dialog = wrapper.find('[data-testid=confirm-modal]')
      expect(dialog.text()).toContain('IOS-0001')
      expect(dialog.text()).toContain('Engineering')
      expect(removeGroupDevice).not.toHaveBeenCalled()

      vi.mocked(fetchDevice).mockResolvedValue({ device: device({ groups: [] }) })
      await wrapper.find('[data-testid=confirm-modal-confirm]').trigger('click')
      await flushPromises()

      expect(removeGroupDevice).toHaveBeenCalledWith(3, 42)
      expect(wrapper.find('[data-testid=confirm-modal]').exists()).toBe(false)
      expect(wrapper.find('[data-testid=toast]').text()).toContain('Đã gỡ thiết bị khỏi group')
      expect(fetchDevice).toHaveBeenCalledTimes(2)
      expect(wrapper.find('[data-testid=device-detail-groups-empty]').exists()).toBe(true)
    })

    it('toasts and does NOT refetch on a 422 — the group link genuinely still exists', async () => {
      vi.mocked(fetchDevice).mockResolvedValue({
        device: device({ groups: [{ id: 3, name: 'Engineering' }] }),
      })
      vi.mocked(removeGroupDevice).mockRejectedValueOnce({
        response: {
          status: 422,
          data: { errors: { base: ['Thiết bị đã retired, không thể thay đổi group'] } },
        },
      })

      const { wrapper } = await mountView('/devices/42')
      const callsBefore = vi.mocked(fetchDevice).mock.calls.length

      await wrapper.find('[data-testid=device-detail-group-remove-button]').trigger('click')
      await wrapper.find('[data-testid=confirm-modal-confirm]').trigger('click')
      await flushPromises()

      expect(wrapper.find('[data-testid=toast]').text()).toContain(
        'Thiết bị đã retired, không thể thay đổi group',
      )
      expect(vi.mocked(fetchDevice).mock.calls.length).toBe(callsBefore)
      expect(wrapper.findAll('[data-testid=device-detail-group-row]')).toHaveLength(1)
    })

    it('refetches on a 404 so a link that is already gone disappears', async () => {
      vi.mocked(fetchDevice).mockResolvedValue({
        device: device({ groups: [{ id: 3, name: 'Engineering' }] }),
      })
      vi.mocked(removeGroupDevice).mockRejectedValueOnce(notFoundError())

      const { wrapper } = await mountView('/devices/42')

      await wrapper.find('[data-testid=device-detail-group-remove-button]').trigger('click')
      vi.mocked(fetchDevice).mockResolvedValue({ device: device({ groups: [] }) })
      await wrapper.find('[data-testid=confirm-modal-confirm]').trigger('click')
      await flushPromises()

      expect(fetchDevice).toHaveBeenCalledTimes(2)
      expect(wrapper.find('[data-testid=device-detail-groups-empty]').exists()).toBe(true)
    })

    it('hides every group action for a retired device but still shows the list (A26)', async () => {
      vi.mocked(fetchDevice).mockResolvedValue({
        device: device({ status: 'retired', groups: [{ id: 3, name: 'Engineering' }] }),
      })

      const { wrapper } = await mountView('/devices/42')

      expect(wrapper.find('[data-testid=device-detail-group-row]').text()).toContain('Engineering')
      expect(wrapper.find('[data-testid=device-detail-add-group-button]').exists()).toBe(false)
      expect(wrapper.find('[data-testid=device-detail-group-remove-button]').exists()).toBe(false)
      expect(wrapper.find('[data-testid=device-detail-retired-banner]').exists()).toBe(true)
    })
  })
})
