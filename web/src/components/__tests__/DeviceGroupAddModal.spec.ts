import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import DeviceGroupAddModal from '../DeviceGroupAddModal.vue'
import { fetchGroupList } from '../../api/groups'
import { addGroupDevices } from '../../api/group-memberships'
import type { Group, GroupListResponse } from '../../types/group'

vi.mock('../../api/groups', () => ({
  fetchGroupList: vi.fn(),
  fetchGroup: vi.fn(),
  createGroup: vi.fn(),
  updateGroup: vi.fn(),
  deleteGroup: vi.fn(),
}))

vi.mock('../../api/group-memberships', () => ({
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

function listResponse(groups: Group[]): GroupListResponse {
  return {
    groups,
    meta: { current_page: 1, per_page: 20, total_count: groups.length, total_pages: 1 },
  }
}

function mountModal(): VueWrapper {
  return mount(DeviceGroupAddModal, { props: { deviceId: 42, deviceIdentifier: 'IOS-0001' } })
}

async function searchAndPick(wrapper: VueWrapper, term: string, index = 0) {
  await wrapper.find('[data-testid=device-group-add-search]').setValue(term)
  await vi.advanceTimersByTimeAsync(300)
  await wrapper.findAll('[data-testid=device-group-add-search-option]')[index].trigger('click')
}

describe('DeviceGroupAddModal', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('names the device in its title and searches groups by the typed term', async () => {
    vi.mocked(fetchGroupList).mockResolvedValue(listResponse([group()]))
    const wrapper = mountModal()

    expect(wrapper.find('[data-testid=device-group-add-modal]').text()).toContain('IOS-0001')

    await wrapper.find('[data-testid=device-group-add-search]').setValue('eng')
    await vi.advanceTimersByTimeAsync(300)

    expect(fetchGroupList).toHaveBeenCalledWith({ q: 'eng', page: 1 })
    expect(wrapper.find('[data-testid=device-group-add-search-option]').text()).toContain('Engineering')
  })

  it('disables "Thêm" until a group is picked', async () => {
    vi.mocked(fetchGroupList).mockResolvedValue(listResponse([group()]))
    const wrapper = mountModal()

    const submit = () => wrapper.find('[data-testid=device-group-add-submit]')
    expect(submit().text()).toContain('Thêm')
    expect(submit().attributes('disabled')).toBeDefined()

    await searchAndPick(wrapper, 'eng')

    expect(submit().attributes('disabled')).toBeUndefined()
  })

  it('adds THIS device to the picked group through the same POST the other direction uses', async () => {
    vi.mocked(fetchGroupList).mockResolvedValue(listResponse([group({ id: 3 })]))
    vi.mocked(addGroupDevices).mockResolvedValueOnce({ added_count: 1, devices_count: 5 })
    const wrapper = mountModal()

    await searchAndPick(wrapper, 'eng')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(addGroupDevices).toHaveBeenCalledWith(3, [42])
    expect(wrapper.emitted('added')).toHaveLength(1)
  })

  it('keeps the modal open with its own copy when the group vanished (404)', async () => {
    vi.mocked(fetchGroupList).mockResolvedValue(listResponse([group()]))
    vi.mocked(addGroupDevices).mockRejectedValueOnce({
      response: { status: 404, data: { error: 'Not found' } },
    })
    const wrapper = mountModal()

    await searchAndPick(wrapper, 'eng')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(wrapper.find('[data-testid=device-group-add-banner]').text()).toContain(
      'Group đã chọn không còn tồn tại hoặc đã bị xóa.',
    )
    expect(wrapper.emitted('added')).toBeUndefined()
    expect(wrapper.emitted('cancel')).toBeUndefined()
  })

  it('shows the server message verbatim on a 422 (retired device, A27)', async () => {
    vi.mocked(fetchGroupList).mockResolvedValue(listResponse([group()]))
    vi.mocked(addGroupDevices).mockRejectedValueOnce({
      response: {
        status: 422,
        data: { errors: { base: ['Thiết bị đã retired, không thể thay đổi group'] } },
      },
    })
    const wrapper = mountModal()

    await searchAndPick(wrapper, 'eng')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(wrapper.find('[data-testid=device-group-add-banner]').text()).toContain(
      'Thiết bị đã retired, không thể thay đổi group',
    )
    expect(wrapper.emitted('added')).toBeUndefined()
  })

  it('falls back to the generic banner on a 500', async () => {
    vi.mocked(fetchGroupList).mockResolvedValue(listResponse([group()]))
    vi.mocked(addGroupDevices).mockRejectedValueOnce({
      response: { status: 500, data: { error: 'PG::Error: boom' } },
    })
    const wrapper = mountModal()

    await searchAndPick(wrapper, 'eng')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    const banner = wrapper.find('[data-testid=device-group-add-banner]')
    expect(banner.text()).toContain('Có lỗi xảy ra, vui lòng thử lại.')
    expect(banner.text()).not.toContain('PG::Error')
  })
})
