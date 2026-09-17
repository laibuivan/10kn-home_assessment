import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import FormModal from '../FormModal.vue'

function mountModal(props: Partial<InstanceType<typeof FormModal>['$props']> = {}) {
  return mount(FormModal, {
    props: {
      title: 'Thêm Device',
      testId: 'device-form-modal',
      bannerTestId: 'device-form-banner',
      submitTestId: 'device-form-submit',
      cancelTestId: 'device-form-cancel',
      ...props,
    },
    slots: {
      default: '<input data-testid="fake-field" />',
    },
  })
}

describe('FormModal', () => {
  it('renders the title and default slot content', () => {
    const wrapper = mountModal()
    expect(wrapper.find('h3').text()).toBe('Thêm Device')
    expect(wrapper.find('[data-testid=fake-field]').exists()).toBe(true)
  })

  it('does not render a banner when there is no baseError', () => {
    const wrapper = mountModal()
    expect(wrapper.find('[data-testid=device-form-banner]').exists()).toBe(false)
  })

  it('renders the baseError banner when present', () => {
    const wrapper = mountModal({ baseError: 'Thiết bị đã retired, không thể sửa' })
    expect(wrapper.find('[data-testid=device-form-banner]').text()).toContain(
      'Thiết bị đã retired, không thể sửa',
    )
  })

  it('emits submit when the form is submitted', async () => {
    const wrapper = mountModal()
    await wrapper.find('form').trigger('submit')
    expect(wrapper.emitted('submit')).toHaveLength(1)
  })

  it('emits cancel when the Cancel button is clicked', async () => {
    const wrapper = mountModal()
    await wrapper.find('[data-testid=device-form-cancel]').trigger('click')
    expect(wrapper.emitted('cancel')).toHaveLength(1)
  })

  it('emits cancel when the backdrop itself is clicked', async () => {
    const wrapper = mountModal()
    await wrapper.find('[data-testid=device-form-modal]').trigger('click')
    expect(wrapper.emitted('cancel')).toHaveLength(1)
  })

  it('does not emit cancel when clicking inside the form (not the backdrop)', async () => {
    const wrapper = mountModal()
    await wrapper.find('h3').trigger('click')
    expect(wrapper.emitted('cancel')).toBeUndefined()
  })

  it('emits cancel on Escape', async () => {
    const wrapper = mountModal()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('cancel')).toHaveLength(1)
  })

  it('does not close (Cancel click / backdrop / Escape) while submitting', async () => {
    const wrapper = mountModal({ submitting: true })

    await wrapper.find('[data-testid=device-form-cancel]').trigger('click')
    await wrapper.find('[data-testid=device-form-modal]').trigger('click')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('cancel')).toBeUndefined()
  })

  it('disables Save and shows the spinner (data-busy) while submitting', () => {
    const wrapper = mountModal({ submitting: true })
    const submit = wrapper.find('[data-testid=device-form-submit]')
    expect(submit.attributes('disabled')).toBeDefined()
    expect(submit.attributes('data-busy')).toBe('true')
  })

  it('disables Cancel while submitting', () => {
    const wrapper = mountModal({ submitting: true })
    expect(wrapper.find('[data-testid=device-form-cancel]').attributes('disabled')).toBeDefined()
  })

  it('does not add the modal-wide class by default (backward compatible for Group/Device)', () => {
    const wrapper = mountModal()
    expect(wrapper.find('form.modal').classes()).not.toContain('modal-wide')
  })

  it('adds the modal-wide class when wide is true (F7 PolicyFormModal)', () => {
    const wrapper = mountModal({ wide: true })
    expect(wrapper.find('form.modal').classes()).toContain('modal-wide')
  })

  it('removes the document keydown listener on unmount', () => {
    const removeSpy = vi.spyOn(document, 'removeEventListener')
    const wrapper = mountModal()
    wrapper.unmount()
    expect(removeSpy).toHaveBeenCalledWith('keydown', expect.any(Function))
    removeSpy.mockRestore()
  })
})
