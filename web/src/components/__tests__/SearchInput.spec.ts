import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import SearchInput from '../SearchInput.vue'

describe('SearchInput', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function mountInput(modelValue = '') {
    return mount(SearchInput, {
      props: { modelValue, testId: 'group-search-input', clearTestId: 'search-clear-button' },
    })
  }

  it('emits `change` once, after the debounce, for a burst of keystrokes', async () => {
    const wrapper = mountInput()
    const input = wrapper.find('[data-testid=group-search-input]')

    await input.setValue('s')
    await input.setValue('sa')
    await input.setValue('sal')
    vi.advanceTimersByTime(299)
    expect(wrapper.emitted('change')).toBeUndefined()

    vi.advanceTimersByTime(1)
    expect(wrapper.emitted('change')).toHaveLength(1)
    expect(wrapper.emitted('change')![0]).toEqual(['sal'])
  })

  it('trims the emitted value (a whitespace-only term means "no filter")', async () => {
    const wrapper = mountInput()

    await wrapper.find('[data-testid=group-search-input]').setValue('  sales  ')
    vi.advanceTimersByTime(300)
    expect(wrapper.emitted('change')![0]).toEqual(['sales'])

    await wrapper.find('[data-testid=group-search-input]').setValue('   ')
    vi.advanceTimersByTime(300)
    expect(wrapper.emitted('change')![1]).toEqual([''])
  })

  it('applies immediately on Enter without waiting out the debounce', async () => {
    const wrapper = mountInput()
    const input = wrapper.find('[data-testid=group-search-input]')

    await input.setValue('sales')
    await input.trigger('keydown.enter')

    expect(wrapper.emitted('change')).toHaveLength(1)
    expect(wrapper.emitted('change')![0]).toEqual(['sales'])

    // The pending debounce was cancelled — Enter must not emit twice.
    vi.advanceTimersByTime(300)
    expect(wrapper.emitted('change')).toHaveLength(1)
  })

  it('only renders the clear button while there is a term, and emits `clear` (not `change`)', async () => {
    const wrapper = mountInput()
    expect(wrapper.find('[data-testid=search-clear-button]').exists()).toBe(false)

    await wrapper.find('[data-testid=group-search-input]').setValue('sales')
    expect(wrapper.find('[data-testid=search-clear-button]').exists()).toBe(true)

    await wrapper.find('[data-testid=search-clear-button]').trigger('click')
    vi.advanceTimersByTime(300)

    expect(wrapper.emitted('clear')).toHaveLength(1)
    // Clearing goes through `clear` only; the queued debounce was cancelled.
    expect(wrapper.emitted('change')).toBeUndefined()
    expect((wrapper.find('[data-testid=group-search-input]').element as HTMLInputElement).value).toBe('')
  })

  it('does not emit after unmount while a debounce is still pending', async () => {
    const wrapper = mountInput()

    await wrapper.find('[data-testid=group-search-input]').setValue('sales')
    wrapper.unmount()
    vi.advanceTimersByTime(300)

    expect(wrapper.emitted('change')).toBeUndefined()
  })

  it('mirrors an externally changed modelValue back into the box (back/forward)', async () => {
    const wrapper = mountInput('sales')
    expect((wrapper.find('[data-testid=group-search-input]').element as HTMLInputElement).value).toBe('sales')

    await wrapper.setProps({ modelValue: 'engineering' })

    expect((wrapper.find('[data-testid=group-search-input]').element as HTMLInputElement).value).toBe(
      'engineering',
    )
  })

  it('drops a pending keystroke when modelValue changes from outside', async () => {
    const wrapper = mountInput('')

    await wrapper.find('[data-testid=group-search-input]').setValue('typing')
    await wrapper.setProps({ modelValue: 'from-url' })
    vi.advanceTimersByTime(300)

    expect(wrapper.emitted('change')).toBeUndefined()
    expect((wrapper.find('[data-testid=group-search-input]').element as HTMLInputElement).value).toBe(
      'from-url',
    )
  })
})
