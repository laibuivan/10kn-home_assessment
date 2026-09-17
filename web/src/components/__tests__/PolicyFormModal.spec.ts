import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import PolicyFormModal from '../PolicyFormModal.vue'
import { createPolicy, fetchPolicyList, updatePolicy } from '../../api/policies'
import { usePoliciesStore } from '../../stores/policies'
import type { Policy } from '../../types/policy'

vi.mock('../../api/policies', () => ({
  fetchPolicyList: vi.fn(),
  createPolicy: vi.fn(),
  updatePolicy: vi.fn(),
}))

function policy(overrides: Partial<Policy> = {}): Policy {
  return {
    id: 42,
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

function nameInput(wrapper: ReturnType<typeof mount>) {
  return wrapper.find('[data-testid=policy-form-name]')
}

function typeInput(wrapper: ReturnType<typeof mount>) {
  return wrapper.find('[data-testid=policy-form-type]')
}

function configurationInput(wrapper: ReturnType<typeof mount>) {
  return wrapper.find('[data-testid=policy-form-configuration]')
}

function statusSelect(wrapper: ReturnType<typeof mount>) {
  return wrapper.find('[data-testid=policy-form-status]')
}

describe('PolicyFormModal', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  describe('create/edit prefill', () => {
    it('starts with an empty form in create mode, status defaulting to active', () => {
      const wrapper = mount(PolicyFormModal, { props: { mode: 'create' } })

      expect(wrapper.findAll('h3').map((h) => h.text())).toContain('Thêm Policy')
      expect((nameInput(wrapper).element as HTMLInputElement).value).toBe('')
      expect((typeInput(wrapper).element as HTMLInputElement).value).toBe('')
      expect((configurationInput(wrapper).element as HTMLTextAreaElement).value).toBe('')
      expect((statusSelect(wrapper).element as HTMLSelectElement).value).toBe('active')
    })

    it('prefills from the policy prop in edit mode, pretty-printing configuration (no extra API call)', () => {
      const wrapper = mount(PolicyFormModal, {
        props: { mode: 'edit', policy: policy({ configuration: { ssid: 'corp', vlan: 10 } }) },
      })

      expect(wrapper.findAll('h3').map((h) => h.text())).toContain('Sửa Policy')
      expect((nameInput(wrapper).element as HTMLInputElement).value).toBe('Wifi mặc định')
      expect((typeInput(wrapper).element as HTMLInputElement).value).toBe('wifi')
      expect((configurationInput(wrapper).element as HTMLTextAreaElement).value).toBe(
        JSON.stringify({ ssid: 'corp', vlan: 10 }, null, 2),
      )
      expect((statusSelect(wrapper).element as HTMLSelectElement).value).toBe('active')
      expect(fetchPolicyList).not.toHaveBeenCalled()
    })

    it('shows the status field in both create and edit modes (unlike Device)', () => {
      const createWrapper = mount(PolicyFormModal, { props: { mode: 'create' } })
      const editWrapper = mount(PolicyFormModal, { props: { mode: 'edit', policy: policy() } })

      expect(statusSelect(createWrapper).exists()).toBe(true)
      expect(statusSelect(editWrapper).exists()).toBe(true)
    })

    it('does not cap name/type with maxlength — the length limit is the server contract', () => {
      const wrapper = mount(PolicyFormModal, { props: { mode: 'create' } })

      expect(nameInput(wrapper).attributes('maxlength')).toBeUndefined()
      expect(typeInput(wrapper).attributes('maxlength')).toBeUndefined()
    })
  })

  describe('type combobox suggestions (§2.1, OQ-3)', () => {
    it('derives distinct, sorted type values from the store, with no extra request', () => {
      const store = usePoliciesStore()
      store.policies = [
        policy({ id: 1, type: 'wifi' }),
        policy({ id: 2, type: 'password' }),
        policy({ id: 3, type: 'wifi' }),
      ]

      const wrapper = mount(PolicyFormModal, { props: { mode: 'create' } })

      const options = wrapper.findAll('#policy-type-suggestions option').map((o) => o.attributes('value'))
      expect(options).toEqual(['password', 'wifi'])
      expect(fetchPolicyList).not.toHaveBeenCalled()
    })

    it('reacts when the store changes after mount', async () => {
      const store = usePoliciesStore()
      store.policies = [policy({ id: 1, type: 'wifi' })]
      const wrapper = mount(PolicyFormModal, { props: { mode: 'create' } })

      store.policies = [...store.policies, policy({ id: 2, type: 'device_lock' })]
      await wrapper.vm.$nextTick()

      const options = wrapper.findAll('#policy-type-suggestions option').map((o) => o.attributes('value'))
      expect(options).toEqual(['device_lock', 'wifi'])
    })

    it('is a free-text input (not a closed select) — typing an unlisted value is not blocked', async () => {
      const store = usePoliciesStore()
      store.policies = [policy({ id: 1, type: 'wifi' })]
      const wrapper = mount(PolicyFormModal, { props: { mode: 'create' } })

      await typeInput(wrapper).setValue('brand_new_type')

      expect((typeInput(wrapper).element as HTMLInputElement).value).toBe('brand_new_type')
    })
  })

  describe('parseConfiguration via blur / Format / submit (§2.2)', () => {
    it('accepts a valid JSON object on blur, clearing any prior error', async () => {
      const wrapper = mount(PolicyFormModal, { props: { mode: 'create' } })

      await configurationInput(wrapper).setValue('{"a":1}')
      await configurationInput(wrapper).trigger('blur')

      expect(wrapper.find('[data-testid=field-error-configuration]').exists()).toBe(false)
    })

    it('accepts an empty object {} as valid (distinct from empty/missing)', async () => {
      const wrapper = mount(PolicyFormModal, { props: { mode: 'create' } })

      await configurationInput(wrapper).setValue('{}')
      await configurationInput(wrapper).trigger('blur')

      expect(wrapper.find('[data-testid=field-error-configuration]').exists()).toBe(false)
    })

    it('rejects invalid JSON syntax on blur without touching the raw text', async () => {
      const wrapper = mount(PolicyFormModal, { props: { mode: 'create' } })

      await configurationInput(wrapper).setValue('{not valid json')
      await configurationInput(wrapper).trigger('blur')

      expect(wrapper.find('[data-testid=field-error-configuration]').text()).toBe(
        'Cấu hình phải là một object JSON hợp lệ.',
      )
      expect((configurationInput(wrapper).element as HTMLTextAreaElement).value).toBe('{not valid json')
    })

    it.each([['["a","b"]'], ['5'], ['"just a string"'], ['null']])(
      'rejects syntactically-valid JSON that is not a plain object: %s',
      async (raw) => {
        const wrapper = mount(PolicyFormModal, { props: { mode: 'create' } })

        await configurationInput(wrapper).setValue(raw)
        await configurationInput(wrapper).trigger('blur')

        expect(wrapper.find('[data-testid=field-error-configuration]').text()).toBe(
          'Cấu hình phải là một object JSON hợp lệ.',
        )
      },
    )

    it('rejects an empty textarea with the same message as invalid syntax', async () => {
      const wrapper = mount(PolicyFormModal, { props: { mode: 'create' } })

      await configurationInput(wrapper).trigger('blur')

      expect(wrapper.find('[data-testid=field-error-configuration]').text()).toBe(
        'Cấu hình phải là một object JSON hợp lệ.',
      )
    })

    it('Format pretty-prints the textarea only on a valid parse', async () => {
      const wrapper = mount(PolicyFormModal, { props: { mode: 'create' } })

      await configurationInput(wrapper).setValue('{"b":2,"a":1}')
      await wrapper.find('[data-testid=policy-form-configuration-format]').trigger('click')

      expect((configurationInput(wrapper).element as HTMLTextAreaElement).value).toBe(
        JSON.stringify({ b: 2, a: 1 }, null, 2),
      )
      expect(wrapper.find('[data-testid=field-error-configuration]').exists()).toBe(false)
    })

    it('Format leaves the raw text untouched and shows the error when the JSON is invalid', async () => {
      const wrapper = mount(PolicyFormModal, { props: { mode: 'create' } })

      await configurationInput(wrapper).setValue('{broken')
      await wrapper.find('[data-testid=policy-form-configuration-format]').trigger('click')

      expect((configurationInput(wrapper).element as HTMLTextAreaElement).value).toBe('{broken')
      expect(wrapper.find('[data-testid=field-error-configuration]').text()).toBe(
        'Cấu hình phải là một object JSON hợp lệ.',
      )
    })

    it('blocks submit on a configuration syntax error even when blur never fired', async () => {
      const wrapper = mount(PolicyFormModal, { props: { mode: 'create' } })

      await nameInput(wrapper).setValue('New Policy')
      await typeInput(wrapper).setValue('wifi')
      // setValue triggers `input`, not `blur` — onConfigurationBlur never runs.
      await configurationInput(wrapper).setValue('{invalid')
      await wrapper.find('form').trigger('submit')
      await flushPromises()

      expect(createPolicy).not.toHaveBeenCalled()
      expect(wrapper.find('[data-testid=field-error-configuration]').text()).toBe(
        'Cấu hình phải là một object JSON hợp lệ.',
      )
    })
  })

  describe('client-side required checks (A4/A12)', () => {
    it('blocks submit when name is blank, without calling the API', async () => {
      const wrapper = mount(PolicyFormModal, { props: { mode: 'create' } })

      await typeInput(wrapper).setValue('wifi')
      await configurationInput(wrapper).setValue('{}')
      await wrapper.find('form').trigger('submit')
      await flushPromises()

      expect(createPolicy).not.toHaveBeenCalled()
      expect(wrapper.find('[data-testid=field-error-name]').text()).toBe(
        'Tên policy không được để trống',
      )
    })

    it('blocks submit when type is blank, without calling the API', async () => {
      const wrapper = mount(PolicyFormModal, { props: { mode: 'create' } })

      await nameInput(wrapper).setValue('New Policy')
      await configurationInput(wrapper).setValue('{}')
      await wrapper.find('form').trigger('submit')
      await flushPromises()

      expect(createPolicy).not.toHaveBeenCalled()
      expect(wrapper.find('[data-testid=field-error-type]').text()).toBe(
        'Loại (type) không được để trống',
      )
    })

    it('clears a field error as soon as the user types again', async () => {
      const wrapper = mount(PolicyFormModal, { props: { mode: 'create' } })

      await configurationInput(wrapper).setValue('{}')
      await wrapper.find('form').trigger('submit')
      expect(wrapper.find('[data-testid=field-error-name]').exists()).toBe(true)

      await nameInput(wrapper).setValue('New Policy')

      expect(wrapper.find('[data-testid=field-error-name]').exists()).toBe(false)
    })
  })

  describe('submit payloads', () => {
    it('sends all 4 fields flat on create, and emits saved with the create message', async () => {
      vi.mocked(createPolicy).mockResolvedValueOnce({ policy: policy({ id: 1 }) })
      const wrapper = mount(PolicyFormModal, { props: { mode: 'create' } })

      await nameInput(wrapper).setValue('New Policy')
      await typeInput(wrapper).setValue('wifi')
      await configurationInput(wrapper).setValue('{"ssid":"corp"}')
      await wrapper.find('form').trigger('submit')
      await flushPromises()

      expect(createPolicy).toHaveBeenCalledWith({
        name: 'New Policy',
        type: 'wifi',
        configuration: { ssid: 'corp' },
        status: 'active',
      })
      expect(wrapper.emitted('saved')).toEqual([[{ mode: 'create', message: 'Đã tạo policy' }]])
    })

    it('always sends all 4 fields on edit (never partial), even when nothing changed', async () => {
      vi.mocked(updatePolicy).mockResolvedValueOnce({ policy: policy() })
      const wrapper = mount(PolicyFormModal, { props: { mode: 'edit', policy: policy() } })

      await wrapper.find('form').trigger('submit')
      await flushPromises()

      expect(updatePolicy).toHaveBeenCalledWith(42, {
        name: 'Wifi mặc định',
        type: 'wifi',
        configuration: { ssid: 'corp' },
        status: 'active',
      })
      expect(wrapper.emitted('saved')).toEqual([[{ mode: 'edit', message: 'Đã cập nhật policy' }]])
    })

    it('sends the edited status alongside the other 3 fields', async () => {
      vi.mocked(updatePolicy).mockResolvedValueOnce({ policy: policy({ status: 'inactive' }) })
      const wrapper = mount(PolicyFormModal, { props: { mode: 'edit', policy: policy() } })

      await statusSelect(wrapper).setValue('inactive')
      await wrapper.find('form').trigger('submit')
      await flushPromises()

      expect(updatePolicy).toHaveBeenCalledWith(
        42,
        expect.objectContaining({ status: 'inactive' }),
      )
    })
  })

  describe('deactivate confirm (F8, §2.1.1/§5)', () => {
    it('blocks the PATCH and shows a confirm dialog when deactivating a policy with assignments > 0', async () => {
      const wrapper = mount(PolicyFormModal, {
        props: { mode: 'edit', policy: policy({ status: 'active', assignments_count: 3 }) },
      })

      await statusSelect(wrapper).setValue('inactive')
      await wrapper.find('form').trigger('submit')
      await flushPromises()

      expect(updatePolicy).not.toHaveBeenCalled()
      expect(wrapper.find('[data-testid=policy-deactivate-confirm]').text()).toContain(
        'Policy đang được gán cho 3 group/device.',
      )
    })

    it('calls the PATCH only after the confirm is accepted', async () => {
      vi.mocked(updatePolicy).mockResolvedValueOnce({ policy: policy({ status: 'inactive' }) })
      const wrapper = mount(PolicyFormModal, {
        props: { mode: 'edit', policy: policy({ status: 'active', assignments_count: 3 }) },
      })

      await statusSelect(wrapper).setValue('inactive')
      await wrapper.find('form').trigger('submit')
      await wrapper.find('[data-testid=policy-deactivate-confirm-confirm]').trigger('click')
      await flushPromises()

      expect(updatePolicy).toHaveBeenCalledWith(42, expect.objectContaining({ status: 'inactive' }))
      expect(wrapper.emitted('saved')).toHaveLength(1)
    })

    it('does not call the PATCH when the confirm is cancelled', async () => {
      const wrapper = mount(PolicyFormModal, {
        props: { mode: 'edit', policy: policy({ status: 'active', assignments_count: 3 }) },
      })

      await statusSelect(wrapper).setValue('inactive')
      await wrapper.find('form').trigger('submit')
      await wrapper.find('[data-testid=policy-deactivate-confirm-cancel]').trigger('click')
      await flushPromises()

      expect(updatePolicy).not.toHaveBeenCalled()
      expect(wrapper.find('[data-testid=policy-deactivate-confirm]').exists()).toBe(false)
    })

    it('does not confirm when assignments_count is 0 (A20)', async () => {
      vi.mocked(updatePolicy).mockResolvedValueOnce({ policy: policy({ status: 'inactive' }) })
      const wrapper = mount(PolicyFormModal, {
        props: { mode: 'edit', policy: policy({ status: 'active', assignments_count: 0 }) },
      })

      await statusSelect(wrapper).setValue('inactive')
      await wrapper.find('form').trigger('submit')
      await flushPromises()

      expect(wrapper.find('[data-testid=policy-deactivate-confirm]').exists()).toBe(false)
      expect(updatePolicy).toHaveBeenCalledWith(42, expect.objectContaining({ status: 'inactive' }))
    })

    it('never confirms when activating (inactive -> active), regardless of assignments_count (A22)', async () => {
      vi.mocked(updatePolicy).mockResolvedValueOnce({ policy: policy({ status: 'active' }) })
      const wrapper = mount(PolicyFormModal, {
        props: { mode: 'edit', policy: policy({ status: 'inactive', assignments_count: 5 }) },
      })

      await statusSelect(wrapper).setValue('active')
      await wrapper.find('form').trigger('submit')
      await flushPromises()

      expect(wrapper.find('[data-testid=policy-deactivate-confirm]').exists()).toBe(false)
      expect(updatePolicy).toHaveBeenCalledWith(42, expect.objectContaining({ status: 'active' }))
    })
  })

  describe('error handling', () => {
    it('renders 422 field errors under name/type/configuration/status and preserves raw JSON text', async () => {
      vi.mocked(createPolicy).mockRejectedValueOnce({
        response: {
          status: 422,
          data: {
            errors: {
              name: ['Tên policy này đã tồn tại trong tổ chức của bạn.'],
              type: ['is too long (maximum is 100 characters)'],
              configuration: ['Cấu hình phải là một object JSON hợp lệ.'],
              status: ['is not included in the list'],
            },
          },
        },
      })
      const wrapper = mount(PolicyFormModal, { props: { mode: 'create' } })

      await nameInput(wrapper).setValue('Duplicate')
      await typeInput(wrapper).setValue('wifi')
      await configurationInput(wrapper).setValue('{"raw":"kept"}')
      await wrapper.find('form').trigger('submit')
      await flushPromises()

      expect(wrapper.find('[data-testid=field-error-name]').text()).toBe(
        'Tên policy này đã tồn tại trong tổ chức của bạn.',
      )
      expect(wrapper.find('[data-testid=field-error-type]').text()).toBe(
        'is too long (maximum is 100 characters)',
      )
      expect(wrapper.find('[data-testid=field-error-configuration]').text()).toBe(
        'Cấu hình phải là một object JSON hợp lệ.',
      )
      expect(wrapper.find('[data-testid=field-error-status]').text()).toBe(
        'is not included in the list',
      )
      expect(wrapper.find('[data-testid=policy-form-modal]').exists()).toBe(true)
      expect(wrapper.emitted('saved')).toBeUndefined()
      // Raw JSON text is preserved, not wiped, on a field error.
      expect((configurationInput(wrapper).element as HTMLTextAreaElement).value).toBe('{"raw":"kept"}')
    })

    it('shows the generic banner on a 500 and keeps the modal open', async () => {
      vi.mocked(createPolicy).mockRejectedValueOnce({
        response: { status: 500, data: { error: 'PG::ConnectionBad' } },
      })
      const wrapper = mount(PolicyFormModal, { props: { mode: 'create' } })

      await nameInput(wrapper).setValue('New Policy')
      await typeInput(wrapper).setValue('wifi')
      await configurationInput(wrapper).setValue('{}')
      await wrapper.find('form').trigger('submit')
      await flushPromises()

      expect(wrapper.find('[data-testid=policy-form-banner]').text()).toContain(
        'Có lỗi xảy ra, vui lòng thử lại.',
      )
      expect(wrapper.text()).not.toContain('PG::ConnectionBad')
      expect(wrapper.find('[data-testid=policy-form-modal]').exists()).toBe(true)
    })
  })

  it('emits cancel from the Hủy button without calling the API', async () => {
    const wrapper = mount(PolicyFormModal, { props: { mode: 'create' } })

    await wrapper.find('[data-testid=policy-form-cancel]').trigger('click')

    expect(wrapper.emitted('cancel')).toHaveLength(1)
    expect(createPolicy).not.toHaveBeenCalled()
  })
})
