import { describe, it, expect, vi, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import AsyncJobBanner from '../AsyncJobBanner.vue'
import type { PolicyAssignmentJob } from '../../types/policyAssignmentJob'

function job(overrides: Partial<PolicyAssignmentJob> = {}): PolicyAssignmentJob {
  return {
    id: 1,
    status: 'pending',
    total_count: 3,
    processed_count: 0,
    error_message: null,
    policy: { id: 5, name: 'Security Baseline' },
    group: { id: 7, name: 'Sales Team' },
    created_at: '2026-09-17T08:00:00.000Z',
    updated_at: '2026-09-17T08:00:00.000Z',
    ...overrides,
  }
}

describe('AsyncJobBanner', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('pending: neutral copy naming the policy and group, no buttons', () => {
    const wrapper = mount(AsyncJobBanner, { props: { job: job({ status: 'pending' }) } })

    expect(wrapper.find('[data-testid=async-job-banner]').text()).toContain(
      'Đang chờ xử lý policy "Security Baseline" cho group "Sales Team"...',
    )
    expect(wrapper.find('.job-banner').classes()).toContain('status-pending')
    expect(wrapper.find('[data-testid=async-job-banner-dismiss]').exists()).toBe(false)
    expect(wrapper.find('[data-testid=async-job-banner-retry]').exists()).toBe(false)
  })

  it('running: shows the device count, no buttons', () => {
    const wrapper = mount(AsyncJobBanner, { props: { job: job({ status: 'running', total_count: 250 }) } })

    expect(wrapper.text()).toContain('Đang gán policy "Security Baseline" cho 250 thiết bị...')
    expect(wrapper.find('[data-testid=async-job-banner-dismiss]').exists()).toBe(false)
  })

  it('done: success copy, total_count, and a "Đóng" button', () => {
    const wrapper = mount(AsyncJobBanner, { props: { job: job({ status: 'done', total_count: 250 }) } })

    expect(wrapper.text()).toContain('Đã gán policy "Security Baseline" cho 250 thiết bị.')
    expect(wrapper.find('.job-banner').classes()).toContain('status-done')
    expect(wrapper.find('[data-testid=async-job-banner-dismiss]').exists()).toBe(true)
    expect(wrapper.find('[data-testid=async-job-banner-retry]').exists()).toBe(false)
  })

  it('done: auto-dismisses after 4s', async () => {
    vi.useFakeTimers()
    const wrapper = mount(AsyncJobBanner, { props: { job: job({ status: 'done' }) } })

    await vi.advanceTimersByTimeAsync(4000)

    expect(wrapper.emitted('dismiss')).toEqual([[1]])
  })

  it('done: emits dismiss immediately when the button is clicked, without waiting the 4s', async () => {
    const wrapper = mount(AsyncJobBanner, { props: { job: job({ status: 'done' }) } })

    await wrapper.find('[data-testid=async-job-banner-dismiss]').trigger('click')

    expect(wrapper.emitted('dismiss')).toEqual([[1]])
  })

  it('failed (group still exists): "Xem chi tiết"/"Thử lại"/"Đóng", error copy hidden until expanded', async () => {
    const wrapper = mount(AsyncJobBanner, {
      props: { job: job({ status: 'failed', error_message: 'Đã hết thời gian chờ.' }) },
    })

    expect(wrapper.text()).toContain('Gán policy "Security Baseline" cho group "Sales Team" thất bại.')
    expect(wrapper.find('.job-banner').classes()).toContain('status-failed')
    expect(wrapper.find('[data-testid=async-job-banner-retry]').exists()).toBe(true)
    expect(wrapper.find('[data-testid=async-job-banner-dismiss]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('Đã hết thời gian chờ.')

    await wrapper.find('[data-testid=async-job-banner-details-toggle]').trigger('click')

    expect(wrapper.text()).toContain('Đã hết thời gian chờ.')
  })

  it('failed with group === null: no "Thử lại" button, uses the "(group đã bị xóa)" label', () => {
    const wrapper = mount(AsyncJobBanner, {
      props: { job: job({ status: 'failed', group: null, error_message: 'Group đã bị xóa' }) },
    })

    expect(wrapper.text()).toContain('Gán policy "Security Baseline" cho group "(group đã bị xóa)" thất bại.')
    expect(wrapper.find('[data-testid=async-job-banner-retry]').exists()).toBe(false)
    expect(wrapper.find('[data-testid=async-job-banner-dismiss]').exists()).toBe(true)
  })

  it('emits retry with the job when "Thử lại" is clicked', async () => {
    const wrapper = mount(AsyncJobBanner, { props: { job: job({ status: 'failed' }) } })

    await wrapper.find('[data-testid=async-job-banner-retry]').trigger('click')

    expect(wrapper.emitted('retry')).toHaveLength(1)
    expect((wrapper.emitted('retry') as unknown as PolicyAssignmentJob[][])[0][0].id).toBe(1)
  })
})
