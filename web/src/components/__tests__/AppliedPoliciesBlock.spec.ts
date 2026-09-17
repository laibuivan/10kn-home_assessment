import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import AppliedPoliciesBlock from '../AppliedPoliciesBlock.vue'
import { fetchAppliedPolicies } from '../../api/devices'
import type { AppliedPolicyEntry, AppliedPoliciesResponse } from '../../types/appliedPolicy'

vi.mock('../../api/devices', () => ({
  fetchDevice: vi.fn(),
  updateDevice: vi.fn(),
  createDevice: vi.fn(),
  fetchDeviceList: vi.fn(),
  fetchAppliedPolicies: vi.fn(),
}))

function entry(overrides: Partial<AppliedPolicyEntry> = {}): AppliedPolicyEntry {
  return {
    type: 'wifi',
    policy: { id: 1, name: 'Security Baseline', type: 'wifi', configuration: { ssid: 'Corp-5G' }, status: 'active' },
    source: { kind: 'direct', group: null },
    conflict: false,
    candidates: [
      {
        policy_id: 1,
        name: 'Security Baseline',
        configuration: { ssid: 'Corp-5G' },
        status: 'active',
        source: { kind: 'direct', group: null },
        included: true,
        excluded_reason: null,
      },
    ],
    ...overrides,
  }
}

function response(applied_policies: AppliedPolicyEntry[]): AppliedPoliciesResponse {
  return { applied_policies }
}

describe('AppliedPoliciesBlock', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows a loading skeleton before the response resolves', async () => {
    let resolvePromise: (value: AppliedPoliciesResponse) => void = () => {}
    vi.mocked(fetchAppliedPolicies).mockReturnValue(
      new Promise((resolve) => {
        resolvePromise = resolve
      }),
    )

    const wrapper = mount(AppliedPoliciesBlock, { props: { deviceId: 42 } })

    expect(wrapper.find('[data-testid=device-detail-policies-loading]').exists()).toBe(true)
    expect(wrapper.find('[data-testid=device-detail-policies-empty]').exists()).toBe(false)

    resolvePromise(response([]))
    await flushPromises()

    expect(wrapper.find('[data-testid=device-detail-policies-loading]').exists()).toBe(false)
  })

  it('renders the empty placeholder with the exact literal text and testid (S1)', async () => {
    vi.mocked(fetchAppliedPolicies).mockResolvedValue(response([]))

    const wrapper = mount(AppliedPoliciesBlock, { props: { deviceId: 42 } })
    await flushPromises()

    expect(wrapper.find('[data-testid=device-detail-policies-empty]').text()).toContain(
      'Chưa có policy nào áp dụng.',
    )
    expect(wrapper.find('[data-testid=device-detail-policies-row]').exists()).toBe(false)
  })

  it('shows an ErrorState on failure, and retry calls fetchAppliedPolicies again (S20)', async () => {
    vi.mocked(fetchAppliedPolicies).mockRejectedValueOnce({ response: { status: 500, data: {} } })

    const wrapper = mount(AppliedPoliciesBlock, { props: { deviceId: 42 } })
    await flushPromises()

    expect(wrapper.find('[data-testid=device-detail-policies-error]').exists()).toBe(true)
    expect(wrapper.find('[data-testid=error-banner]').exists()).toBe(true)
    expect(wrapper.find('[data-testid=device-detail-policies-empty]').exists()).toBe(false)

    vi.mocked(fetchAppliedPolicies).mockResolvedValueOnce(response([]))
    await wrapper.find('[data-testid=retry-button]').trigger('click')
    await flushPromises()

    expect(fetchAppliedPolicies).toHaveBeenCalledTimes(2)
    expect(wrapper.find('[data-testid=device-detail-policies-error]').exists()).toBe(false)
    expect(wrapper.find('[data-testid=device-detail-policies-empty]').exists()).toBe(true)
  })

  it('renders one row per type with no conflict banner when nothing conflicts (S2-S4)', async () => {
    vi.mocked(fetchAppliedPolicies).mockResolvedValue(
      response([
        entry({ type: 'wifi', source: { kind: 'direct', group: null } }),
        entry({
          type: 'password',
          policy: { id: 2, name: 'Password Rule', type: 'password', configuration: {}, status: 'active' },
          source: { kind: 'group', group: { id: 7, name: 'Sales Laptops' } },
          candidates: [
            {
              policy_id: 2,
              name: 'Password Rule',
              configuration: {},
              status: 'active',
              source: { kind: 'group', group: { id: 7, name: 'Sales Laptops' } },
              included: true,
              excluded_reason: null,
            },
          ],
        }),
      ]),
    )

    const wrapper = mount(AppliedPoliciesBlock, { props: { deviceId: 42 } })
    await flushPromises()

    const rows = wrapper.findAll('[data-testid=device-detail-policies-row]')
    expect(rows).toHaveLength(2)
    expect(wrapper.find('[data-testid=device-detail-policies-conflict-banner]').exists()).toBe(false)

    const sources = wrapper.findAll('[data-testid=device-detail-policies-source]')
    expect(sources[0].text()).toBe('Trực tiếp')
    expect(sources[1].text()).toBe('Từ group: Sales Laptops')

    // Only 1 candidate each -> no "Xem tất cả nguồn" link (F9-frontend.md §5).
    expect(wrapper.find('[data-testid=device-detail-policies-view-sources]').exists()).toBe(false)
  })

  it('shows the conflict banner with the exact count, and a conflict flag on the affected row (S6-S8)', async () => {
    vi.mocked(fetchAppliedPolicies).mockResolvedValue(
      response([
        entry({
          type: 'wifi',
          conflict: true,
          candidates: [
            {
              policy_id: 1,
              name: 'Security Baseline',
              configuration: { ssid: 'Corp-5G' },
              status: 'active',
              source: { kind: 'direct', group: null },
              included: true,
              excluded_reason: null,
            },
            {
              policy_id: 2,
              name: 'Wifi Group',
              configuration: { ssid: 'Guest' },
              status: 'active',
              source: { kind: 'group', group: { id: 3, name: 'Sales Laptops' } },
              included: false,
              excluded_reason: 'Ưu tiên thấp hơn',
            },
          ],
        }),
      ]),
    )

    const wrapper = mount(AppliedPoliciesBlock, { props: { deviceId: 42 } })
    await flushPromises()

    expect(wrapper.find('[data-testid=device-detail-policies-conflict-banner]').text()).toContain(
      'Đã tự động chọn policy ưu tiên cao hơn cho 1 loại đang xung đột.',
    )
    expect(wrapper.find('[data-testid=device-detail-policies-conflict-flag]').exists()).toBe(true)
  })

  it('accordion toggles open/closed and lists every candidate with its literal excluded_reason (OQ-4, S13, S19)', async () => {
    vi.mocked(fetchAppliedPolicies).mockResolvedValue(
      response([
        entry({
          type: 'wifi',
          conflict: false,
          source: { kind: 'group', group: { id: 3, name: 'Group A' } },
          candidates: [
            {
              policy_id: 5,
              name: 'Security Baseline',
              configuration: {},
              status: 'active',
              source: { kind: 'group', group: { id: 3, name: 'Group A' } },
              included: true,
              excluded_reason: null,
            },
            {
              policy_id: 5,
              name: 'Security Baseline',
              configuration: {},
              status: 'active',
              source: { kind: 'group', group: { id: 9, name: 'Group B' } },
              included: true,
              excluded_reason: null,
            },
          ],
        }),
      ]),
    )

    const wrapper = mount(AppliedPoliciesBlock, { props: { deviceId: 42 } })
    await flushPromises()

    const toggle = wrapper.find('[data-testid=device-detail-policies-view-sources]')
    expect(toggle.exists()).toBe(true)
    expect(toggle.attributes('aria-expanded')).toBe('false')
    expect(wrapper.find('[data-testid=device-detail-policies-candidates]').exists()).toBe(false)

    await toggle.trigger('click')

    expect(toggle.attributes('aria-expanded')).toBe('true')
    // A13 — 2 candidates sharing the same policy_id but a different group
    // must render as 2 distinct rows (key includes source.group.id).
    const candidateRows = wrapper.findAll('[data-testid=device-detail-policies-candidate-row]')
    expect(candidateRows).toHaveLength(2)
    expect(candidateRows[0].text()).toContain('Đang áp dụng')
    expect(candidateRows[1].text()).toContain('Đang áp dụng')

    await toggle.trigger('click')
    expect(wrapper.find('[data-testid=device-detail-policies-candidates]').exists()).toBe(false)
  })

  it('renders the exact excluded_reason literal from the API without remapping it (OQ-4)', async () => {
    vi.mocked(fetchAppliedPolicies).mockResolvedValue(
      response([
        entry({
          type: 'wifi',
          conflict: true,
          candidates: [
            {
              policy_id: 1,
              name: 'Wifi New',
              configuration: {},
              status: 'active',
              source: { kind: 'group', group: { id: 3, name: 'Group A' } },
              included: true,
              excluded_reason: null,
            },
            {
              policy_id: 2,
              name: 'Wifi Old',
              configuration: {},
              status: 'active',
              source: { kind: 'group', group: { id: 9, name: 'Group B' } },
              included: false,
              excluded_reason: 'Ưu tiên thấp hơn',
            },
            {
              policy_id: 3,
              name: 'Wifi Inactive',
              configuration: {},
              status: 'inactive',
              source: { kind: 'group', group: { id: 5, name: 'Group C' } },
              included: false,
              excluded_reason: 'Policy đang inactive, không được tính hiệu lực',
            },
          ],
        }),
      ]),
    )

    const wrapper = mount(AppliedPoliciesBlock, { props: { deviceId: 42 } })
    await flushPromises()

    await wrapper.find('[data-testid=device-detail-policies-view-sources]').trigger('click')

    const rows = wrapper.findAll('[data-testid=device-detail-policies-candidate-row]')
    expect(rows).toHaveLength(3)
    expect(rows[0].text()).toContain('Đang áp dụng')
    expect(rows[1].text()).toContain('Ưu tiên thấp hơn')
    expect(rows[2].text()).toContain('Policy đang inactive, không được tính hiệu lực')
  })

  it('refetches when deviceId changes', async () => {
    vi.mocked(fetchAppliedPolicies).mockResolvedValue(response([]))

    const wrapper = mount(AppliedPoliciesBlock, { props: { deviceId: 42 } })
    await flushPromises()
    expect(fetchAppliedPolicies).toHaveBeenCalledWith(42)

    await wrapper.setProps({ deviceId: 99 })
    await flushPromises()

    expect(fetchAppliedPolicies).toHaveBeenCalledWith(99)
    expect(fetchAppliedPolicies).toHaveBeenCalledTimes(2)
  })

  it('ignores a stale response that resolves after a newer deviceId request has already started', async () => {
    let resolveFirst: (value: AppliedPoliciesResponse) => void = () => {}
    vi.mocked(fetchAppliedPolicies).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve
        }),
    )

    const wrapper = mount(AppliedPoliciesBlock, { props: { deviceId: 42 } })

    // Navigate to device 99 before device 42's request resolves.
    vi.mocked(fetchAppliedPolicies).mockResolvedValueOnce(
      response([entry({ type: 'wifi', policy: { id: 9, name: 'Device 99 Policy', type: 'wifi', configuration: {}, status: 'active' } })]),
    )
    await wrapper.setProps({ deviceId: 99 })
    await flushPromises()

    expect(wrapper.find('[data-testid=device-detail-policies-row]').text()).toContain('Device 99 Policy')

    // Device 42's stale response now arrives — must not overwrite device 99's data.
    resolveFirst(response([entry({ type: 'wifi', policy: { id: 1, name: 'Device 42 Policy', type: 'wifi', configuration: {}, status: 'active' } })]))
    await flushPromises()

    expect(wrapper.find('[data-testid=device-detail-policies-row]').text()).toContain('Device 99 Policy')
    expect(wrapper.find('[data-testid=device-detail-policies-row]').text()).not.toContain('Device 42 Policy')
  })

  it('collapses any expanded accordion when deviceId changes, so it does not leak into the next device', async () => {
    vi.mocked(fetchAppliedPolicies).mockResolvedValue(
      response([
        entry({
          type: 'wifi',
          candidates: [
            {
              policy_id: 1,
              name: 'A',
              configuration: {},
              status: 'active',
              source: { kind: 'direct', group: null },
              included: true,
              excluded_reason: null,
            },
            {
              policy_id: 2,
              name: 'B',
              configuration: {},
              status: 'active',
              source: { kind: 'group', group: { id: 3, name: 'G' } },
              included: false,
              excluded_reason: 'Ưu tiên thấp hơn',
            },
          ],
        }),
      ]),
    )

    const wrapper = mount(AppliedPoliciesBlock, { props: { deviceId: 42 } })
    await flushPromises()
    await wrapper.find('[data-testid=device-detail-policies-view-sources]').trigger('click')
    expect(wrapper.find('[data-testid=device-detail-policies-candidates]').exists()).toBe(true)

    await wrapper.setProps({ deviceId: 99 })
    await flushPromises()

    expect(wrapper.find('[data-testid=device-detail-policies-candidates]').exists()).toBe(false)
  })
})
