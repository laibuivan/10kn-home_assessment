import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import GroupFormModal from '../GroupFormModal.vue'
import { createGroup, updateGroup } from '../../api/groups'
import type { Group } from '../../types/group'

vi.mock('../../api/groups', () => ({
  createGroup: vi.fn(),
  updateGroup: vi.fn(),
}))

function group(overrides: Partial<Group> = {}): Group {
  return {
    id: 42,
    name: 'Engineering',
    description: 'Máy dev & QA',
    created_at: '2026-09-16T08:00:00.000Z',
    updated_at: '2026-09-16T08:00:00.000Z',
    ...overrides,
  }
}

function nameInput(wrapper: ReturnType<typeof mount>) {
  return wrapper.find('[data-testid=group-form-name]')
}

function descriptionInput(wrapper: ReturnType<typeof mount>) {
  return wrapper.find('[data-testid=group-form-description]')
}

describe('GroupFormModal', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('starts with an empty form in create mode', () => {
    const wrapper = mount(GroupFormModal, { props: { mode: 'create' } })

    expect(wrapper.findAll('h3').map((h) => h.text())).toContain('Thêm Group')
    expect((nameInput(wrapper).element as HTMLInputElement).value).toBe('')
    expect((descriptionInput(wrapper).element as HTMLTextAreaElement).value).toBe('')
  })

  it('prefills from the group prop in edit mode (no extra API call)', () => {
    const wrapper = mount(GroupFormModal, { props: { mode: 'edit', group: group() } })

    expect(wrapper.findAll('h3').map((h) => h.text())).toContain('Sửa Group')
    expect((nameInput(wrapper).element as HTMLInputElement).value).toBe('Engineering')
    expect((descriptionInput(wrapper).element as HTMLTextAreaElement).value).toBe('Máy dev & QA')
  })

  it('renders an empty description box for a group that has none', () => {
    const wrapper = mount(GroupFormModal, {
      props: { mode: 'edit', group: group({ description: null }) },
    })

    expect((descriptionInput(wrapper).element as HTMLTextAreaElement).value).toBe('')
  })

  it('does not cap the inputs with maxlength — the length limit is the server contract (A10)', () => {
    const wrapper = mount(GroupFormModal, { props: { mode: 'create' } })

    expect(nameInput(wrapper).attributes('maxlength')).toBeUndefined()
    expect(descriptionInput(wrapper).attributes('maxlength')).toBeUndefined()
  })

  it('blocks submit client-side when the name is only whitespace, without calling the API (A4)', async () => {
    const wrapper = mount(GroupFormModal, { props: { mode: 'create' } })

    await nameInput(wrapper).setValue('   ')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(createGroup).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid=field-error-name]').text()).toBe('Tên group không được để trống')
    expect(wrapper.find('[data-testid=group-form-modal]').exists()).toBe(true)
  })

  it('clears a field error as soon as the user types again', async () => {
    const wrapper = mount(GroupFormModal, { props: { mode: 'create' } })

    await wrapper.find('form').trigger('submit')
    expect(wrapper.find('[data-testid=field-error-name]').exists()).toBe(true)

    await nameInput(wrapper).setValue('Sales Team')

    expect(wrapper.find('[data-testid=field-error-name]').exists()).toBe(false)
  })

  it('omits description from the POST body when it was left blank (A25)', async () => {
    vi.mocked(createGroup).mockResolvedValueOnce({ group: group({ id: 1, description: null }) })
    const wrapper = mount(GroupFormModal, { props: { mode: 'create' } })

    await nameInput(wrapper).setValue('Sales Team')
    await descriptionInput(wrapper).setValue('   ')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(createGroup).toHaveBeenCalledWith({ name: 'Sales Team', description: undefined })
    const payload = vi.mocked(createGroup).mock.calls[0][0]
    expect(payload.description).toBeUndefined()
  })

  it('sends name and description on create, and emits `saved` with the create message', async () => {
    vi.mocked(createGroup).mockResolvedValueOnce({ group: group({ id: 1, name: 'Sales Team' }) })
    const wrapper = mount(GroupFormModal, { props: { mode: 'create' } })

    await nameInput(wrapper).setValue('Sales Team')
    await descriptionInput(wrapper).setValue('Đội kinh doanh')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(createGroup).toHaveBeenCalledWith({ name: 'Sales Team', description: 'Đội kinh doanh' })
    expect(wrapper.emitted('saved')).toEqual([[{ mode: 'create', message: 'Đã tạo group' }]])
  })

  it('always sends description on edit, including an empty string (the only way to clear it)', async () => {
    vi.mocked(updateGroup).mockResolvedValueOnce({ group: group({ description: null }) })
    const wrapper = mount(GroupFormModal, { props: { mode: 'edit', group: group() } })

    await descriptionInput(wrapper).setValue('')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(updateGroup).toHaveBeenCalledWith(42, { name: 'Engineering', description: '' })
    expect(wrapper.emitted('saved')).toEqual([[{ mode: 'edit', message: 'Đã cập nhật group' }]])
  })

  it('keeps the same name on edit without tripping the uniqueness rule (A8)', async () => {
    vi.mocked(updateGroup).mockResolvedValueOnce({ group: group({ description: 'Khu vực APAC' }) })
    const wrapper = mount(GroupFormModal, { props: { mode: 'edit', group: group() } })

    await descriptionInput(wrapper).setValue('Khu vực APAC')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(updateGroup).toHaveBeenCalledWith(42, { name: 'Engineering', description: 'Khu vực APAC' })
    expect(wrapper.emitted('saved')).toHaveLength(1)
  })

  it('renders a 422 duplicate-name error under the name field and keeps the modal open (A5/A7)', async () => {
    vi.mocked(createGroup).mockRejectedValueOnce({
      response: {
        status: 422,
        data: { errors: { name: ['Tên group này đã tồn tại trong tổ chức của bạn.'] } },
      },
    })
    const wrapper = mount(GroupFormModal, { props: { mode: 'create' } })

    await nameInput(wrapper).setValue('Sales Team')
    await descriptionInput(wrapper).setValue('Đội kinh doanh')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(wrapper.find('[data-testid=field-error-name]').text()).toBe(
      'Tên group này đã tồn tại trong tổ chức của bạn.',
    )
    expect(wrapper.find('[data-testid=group-form-modal]').exists()).toBe(true)
    expect(wrapper.emitted('saved')).toBeUndefined()
    // The data the user typed is still there.
    expect((nameInput(wrapper).element as HTMLInputElement).value).toBe('Sales Team')
    expect((descriptionInput(wrapper).element as HTMLTextAreaElement).value).toBe('Đội kinh doanh')
  })

  it("renders Rails' English length message verbatim, on the right field (A10)", async () => {
    vi.mocked(createGroup).mockRejectedValueOnce({
      response: {
        status: 422,
        data: {
          errors: {
            name: ['is too long (maximum is 100 characters)'],
            description: ['is too long (maximum is 500 characters)'],
          },
        },
      },
    })
    const wrapper = mount(GroupFormModal, { props: { mode: 'create' } })

    await nameInput(wrapper).setValue('x'.repeat(101))
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(wrapper.find('[data-testid=field-error-name]').text()).toBe(
      'is too long (maximum is 100 characters)',
    )
    expect(wrapper.find('[data-testid=field-error-description]').text()).toBe(
      'is too long (maximum is 500 characters)',
    )
    expect(wrapper.find('[data-testid=group-form-banner]').exists()).toBe(false)
  })

  it('emits `missing` on a 404 while editing, instead of showing a "Not found" banner (A12)', async () => {
    vi.mocked(updateGroup).mockRejectedValueOnce({
      response: { status: 404, data: { error: 'Not found' } },
    })
    const wrapper = mount(GroupFormModal, { props: { mode: 'edit', group: group() } })

    await nameInput(wrapper).setValue('Sales APAC')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(wrapper.emitted('missing')).toHaveLength(1)
    expect(wrapper.emitted('saved')).toBeUndefined()
    expect(wrapper.find('[data-testid=group-form-banner]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Not found')
  })

  it('shows the generic banner on a 500 and keeps the modal open', async () => {
    vi.mocked(createGroup).mockRejectedValueOnce({
      response: { status: 500, data: { error: 'PG::ConnectionBad' } },
    })
    const wrapper = mount(GroupFormModal, { props: { mode: 'create' } })

    await nameInput(wrapper).setValue('Sales Team')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(wrapper.find('[data-testid=group-form-banner]').text()).toContain(
      'Có lỗi xảy ra, vui lòng thử lại.',
    )
    // Server internals never reach the user.
    expect(wrapper.text()).not.toContain('PG::ConnectionBad')
    expect(wrapper.find('[data-testid=group-form-modal]').exists()).toBe(true)
  })

  it('emits `cancel` from the Hủy button without calling the API', async () => {
    const wrapper = mount(GroupFormModal, { props: { mode: 'create' } })

    await wrapper.find('[data-testid=group-form-cancel]').trigger('click')

    expect(wrapper.emitted('cancel')).toHaveLength(1)
    expect(createGroup).not.toHaveBeenCalled()
  })
})
