import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useToastStore } from '../toast'

describe('useToastStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts empty', () => {
    const store = useToastStore()
    expect(store.toasts).toEqual([])
  })

  it('push adds a toast with an incrementing id and default variant success', () => {
    const store = useToastStore()
    store.push('Đã tạo device')

    expect(store.toasts).toHaveLength(1)
    expect(store.toasts[0]).toMatchObject({ message: 'Đã tạo device', variant: 'success' })
  })

  it('push accepts an explicit variant', () => {
    const store = useToastStore()
    store.push('Job failed', 'error')

    expect(store.toasts[0]).toMatchObject({ message: 'Job failed', variant: 'error' })
  })

  it('auto-dismisses a toast after ~3s', () => {
    const store = useToastStore()
    store.push('Đã tạo device')
    expect(store.toasts).toHaveLength(1)

    vi.advanceTimersByTime(3000)

    expect(store.toasts).toHaveLength(0)
  })

  it('dismiss removes exactly the toast with the given id', () => {
    const store = useToastStore()
    store.push('First')
    store.push('Second')
    const firstId = store.toasts[0].id

    store.dismiss(firstId)

    expect(store.toasts).toHaveLength(1)
    expect(store.toasts[0].message).toBe('Second')
  })

  it('stacks multiple toasts when pushed in quick succession', () => {
    const store = useToastStore()
    store.push('Đã tạo device')
    store.push('Đã cập nhật device')

    expect(store.toasts.map((t) => t.message)).toEqual(['Đã tạo device', 'Đã cập nhật device'])
  })
})
