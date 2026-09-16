import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import AsyncSearchSelect from '../AsyncSearchSelect.vue'
import type { AsyncSearchSelectOption } from '../AsyncSearchSelect.vue'

const TEST_ID = 'member-search'

function option(id: number, label: string, sublabel?: string): AsyncSearchSelectOption {
  return { id, label, sublabel }
}

function mountSelect(
  search: (query: string) => Promise<AsyncSearchSelectOption[]>,
  props: Partial<{ mode: 'single' | 'multiple'; minChars: number; modelValue: AsyncSearchSelectOption[] }> = {},
) {
  return mount(AsyncSearchSelect, {
    props: {
      search,
      testId: TEST_ID,
      modelValue: props.modelValue ?? [],
      mode: props.mode ?? 'multiple',
      ...(props.minChars === undefined ? {} : { minChars: props.minChars }),
    },
  })
}

/** Types into the box and lets the 300ms debounce settle. */
async function typeAndSettle(wrapper: ReturnType<typeof mountSelect>, value: string) {
  await wrapper.find(`[data-testid=${TEST_ID}]`).setValue(value)
  await vi.advanceTimersByTimeAsync(300)
}

describe('AsyncSearchSelect', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not call `search` while the query is below minChars, and says so', async () => {
    const search = vi.fn().mockResolvedValue([])
    const wrapper = mountSelect(search, { minChars: 2 })

    await typeAndSettle(wrapper, 'a')

    expect(search).not.toHaveBeenCalled()
    expect(wrapper.find(`[data-testid=${TEST_ID}-hint]`).text()).toContain('Nhập từ khóa để tìm')
  })

  it('calls `search` exactly once per burst of keystrokes, with the trimmed query', async () => {
    const search = vi.fn().mockResolvedValue([option(1, 'IOS-0001')])
    const wrapper = mountSelect(search)
    const input = wrapper.find(`[data-testid=${TEST_ID}]`)

    await input.setValue('i')
    await input.setValue('io')
    await input.setValue('  ios  ')
    await vi.advanceTimersByTimeAsync(299)
    expect(search).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(search).toHaveBeenCalledTimes(1)
    expect(search).toHaveBeenCalledWith('ios')
  })

  it('shows a loading row while the fetcher is still running', async () => {
    let resolveSearch!: (value: AsyncSearchSelectOption[]) => void
    const search = vi.fn().mockReturnValue(
      new Promise<AsyncSearchSelectOption[]>((resolve) => {
        resolveSearch = resolve
      }),
    )
    const wrapper = mountSelect(search)

    await typeAndSettle(wrapper, 'ios')
    expect(wrapper.find(`[data-testid=${TEST_ID}-loading]`).exists()).toBe(true)

    resolveSearch([option(1, 'IOS-0001')])
    await vi.advanceTimersByTimeAsync(0)

    expect(wrapper.find(`[data-testid=${TEST_ID}-loading]`).exists()).toBe(false)
    expect(wrapper.findAll(`[data-testid=${TEST_ID}-option]`)).toHaveLength(1)
  })

  it('ignores a stale response that lands after a newer one', async () => {
    let resolveFirst!: (value: AsyncSearchSelectOption[]) => void
    const search = vi
      .fn()
      .mockReturnValueOnce(
        new Promise<AsyncSearchSelectOption[]>((resolve) => {
          resolveFirst = resolve
        }),
      )
      .mockResolvedValueOnce([option(2, 'NEW')])
    const wrapper = mountSelect(search)

    await typeAndSettle(wrapper, 'ios')
    await typeAndSettle(wrapper, 'android')

    resolveFirst([option(1, 'STALE')])
    await vi.advanceTimersByTimeAsync(0)

    const labels = wrapper.findAll(`[data-testid=${TEST_ID}-option]`).map((el) => el.text())
    expect(labels).toEqual(['NEW'])
  })

  it('shows "Không tìm thấy" when the fetcher returns nothing', async () => {
    const wrapper = mountSelect(vi.fn().mockResolvedValue([]))

    await typeAndSettle(wrapper, 'zzz')

    expect(wrapper.find(`[data-testid=${TEST_ID}-empty]`).text()).toContain('Không tìm thấy')
  })

  describe('mode="multiple"', () => {
    it('toggles an option in and out of modelValue without closing the dropdown', async () => {
      const search = vi.fn().mockResolvedValue([option(1, 'IOS-0001'), option(2, 'AND-0002')])
      const wrapper = mountSelect(search)
      await typeAndSettle(wrapper, 'a')

      await wrapper.findAll(`[data-testid=${TEST_ID}-option]`)[0].trigger('click')

      const firstEmit = wrapper.emitted('update:modelValue')![0][0] as AsyncSearchSelectOption[]
      expect(firstEmit.map((o) => o.id)).toEqual([1])
      // Still open, so a second pick needs no re-typing.
      expect(wrapper.findAll(`[data-testid=${TEST_ID}-option]`)).toHaveLength(2)

      // Re-mount with the option already selected: clicking it again removes it.
      await wrapper.setProps({ modelValue: [option(1, 'IOS-0001')] })
      await wrapper.findAll(`[data-testid=${TEST_ID}-option]`)[0].trigger('click')

      const secondEmit = wrapper.emitted('update:modelValue')![1][0] as AsyncSearchSelectOption[]
      expect(secondEmit).toEqual([])
    })
  })

  describe('mode="single"', () => {
    it('replaces the whole selection and closes the dropdown', async () => {
      const search = vi.fn().mockResolvedValue([option(1, 'Engineering'), option(2, 'Sales')])
      const wrapper = mountSelect(search, {
        mode: 'single',
        modelValue: [option(9, 'Đã chọn trước')],
      })
      await typeAndSettle(wrapper, 'e')

      await wrapper.findAll(`[data-testid=${TEST_ID}-option]`)[1].trigger('click')

      const emitted = wrapper.emitted('update:modelValue')![0][0] as AsyncSearchSelectOption[]
      expect(emitted.map((o) => o.id)).toEqual([2])
      expect(wrapper.find(`[data-testid=${TEST_ID}-dropdown]`).exists()).toBe(false)
    })
  })

  it('renders a chip per selected option, whose "×" removes just that one', async () => {
    const wrapper = mountSelect(vi.fn().mockResolvedValue([]), {
      modelValue: [option(1, 'IOS-0001'), option(2, 'AND-0002')],
    })

    expect(wrapper.findAll(`[data-testid=${TEST_ID}-selected-chip]`)).toHaveLength(2)

    await wrapper.findAll(`[data-testid=${TEST_ID}-selected-remove]`)[0].trigger('click')

    const emitted = wrapper.emitted('update:modelValue')![0][0] as AsyncSearchSelectOption[]
    expect(emitted.map((o) => o.id)).toEqual([2])
  })

  it('renders the optional sublabel under the main label', async () => {
    const search = vi.fn().mockResolvedValue([option(1, 'IOS-0001', 'iPhone 14 · ios')])
    const wrapper = mountSelect(search)

    await typeAndSettle(wrapper, 'ios')

    expect(wrapper.find(`[data-testid=${TEST_ID}-option]`).text()).toContain('iPhone 14 · ios')
  })

  it('does not fire the pending search after the component is unmounted', async () => {
    const search = vi.fn().mockResolvedValue([])
    const wrapper = mountSelect(search)

    await wrapper.find(`[data-testid=${TEST_ID}]`).setValue('ios')
    wrapper.unmount()
    await vi.advanceTimersByTimeAsync(300)

    expect(search).not.toHaveBeenCalled()
  })

  it('drops the previous results when the query falls back below minChars', async () => {
    const search = vi.fn().mockResolvedValue([option(1, 'IOS-0001')])
    const wrapper = mountSelect(search)

    await typeAndSettle(wrapper, 'ios')
    expect(wrapper.findAll(`[data-testid=${TEST_ID}-option]`)).toHaveLength(1)

    await typeAndSettle(wrapper, '')

    expect(wrapper.findAll(`[data-testid=${TEST_ID}-option]`)).toHaveLength(0)
    expect(wrapper.find(`[data-testid=${TEST_ID}-hint]`).exists()).toBe(true)
    expect(search).toHaveBeenCalledTimes(1)
  })
})
