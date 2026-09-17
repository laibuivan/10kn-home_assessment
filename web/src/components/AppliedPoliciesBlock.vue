<script setup lang="ts">
/**
 * Device Detail — "Policy đang áp dụng" (docs/design/F9-frontend.md §1-§3).
 * Self-contained: fetches its own data, owns its own loading/error/empty/
 * success state, no emits (F9 has no write action from this block — OQ-6).
 * Deliberately does NOT read `device.status` — Device retired (A14) needs
 * no special case here, this component only ever knows `deviceId`.
 */
import { computed, ref, watch } from 'vue'
import ErrorState from './ErrorState.vue'
import StatusBadge from './StatusBadge.vue'
import { fetchAppliedPolicies } from '../api/devices'
import { extractErrorMessage } from '../utils/apiError'
import type { AppliedPolicyEntry, AppliedPolicySource } from '../types/appliedPolicy'

const props = defineProps<{ deviceId: number }>()

const GENERIC_ERROR_MESSAGE = 'Không tải được policy đang áp dụng.'

const items = ref<AppliedPolicyEntry[]>([])
const loading = ref(true)
const error = ref<string | null>(null)
/** Array, not Set — Vue reactivity on Set/Map needs a new instance to trigger updates; indexOf/splice on a plain array is simpler (F9-frontend.md §3.4). */
const expandedTypes = ref<string[]>([])

// Bumped on every load() call; a response is only applied if its token is
// still current when it resolves. Guards against an out-of-order response
// when deviceId changes again before a previous fetch has settled (same
// component instance is reused across /devices/:id navigations — no remount).
let requestToken = 0

async function load() {
  const token = ++requestToken
  loading.value = true
  error.value = null
  expandedTypes.value = []
  try {
    const response = await fetchAppliedPolicies(props.deviceId)
    if (token !== requestToken) return
    items.value = response.applied_policies
  } catch (err) {
    if (token !== requestToken) return
    // A race-condition 404 (Device deleted between Header load and this
    // block's own fetch) is handled the same as any other error — no
    // dedicated "not found" UI for a sub-block (F9-frontend.md §5).
    error.value = extractErrorMessage(err, GENERIC_ERROR_MESSAGE)
  } finally {
    if (token === requestToken) loading.value = false
  }
}

// watch, not onMounted — same reasoning as DeviceDetailView.load (F4): a
// future same-component navigation between two /devices/:id would not
// remount, only change the prop.
watch(() => props.deviceId, load, { immediate: true })

const conflictCount = computed(() => items.value.filter((entry) => entry.conflict).length)

function isExpanded(type: string): boolean {
  return expandedTypes.value.includes(type)
}

function toggleCandidates(type: string) {
  const idx = expandedTypes.value.indexOf(type)
  if (idx === -1) expandedTypes.value.push(type)
  else expandedTypes.value.splice(idx, 1)
}

function sourceLabel(source: AppliedPolicySource): string {
  // The `?? '(đã xóa)'` branch is unreachable in practice — F9 drops a
  // group's candidates entirely once the group is destroyed (A12) — this
  // only satisfies TypeScript's `string | null` (F9-frontend.md §3.4).
  return source.kind === 'direct' ? 'Trực tiếp' : `Từ group: ${source.group?.name ?? '(đã xóa)'}`
}
</script>

<template>
  <div>
    <div v-if="loading" data-testid="device-detail-policies-loading">
      <span class="skeleton-cell" style="height: 14px; display: block; margin-bottom: 8px"></span>
      <span class="skeleton-cell" style="height: 14px; display: block; width: 70%"></span>
    </div>

    <div v-else-if="error" data-testid="device-detail-policies-error">
      <ErrorState :message="error" @retry="load" />
    </div>

    <div v-else-if="items.length === 0" data-testid="device-detail-policies-empty">
      <div class="placeholder-box">
        <span class="ic" aria-hidden="true">▣</span>
        <span>Chưa có policy nào áp dụng.</span>
      </div>
    </div>

    <template v-else>
      <div v-if="conflictCount > 0" class="warning-banner" data-testid="device-detail-policies-conflict-banner">
        <span aria-hidden="true">⚠</span>
        <span>Đã tự động chọn policy ưu tiên cao hơn cho {{ conflictCount }} loại đang xung đột.</span>
      </div>

      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Nguồn</th>
              <th>Trạng thái</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="entry in items" :key="entry.type">
              <tr data-testid="device-detail-policies-row">
                <td>{{ entry.policy.name }}</td>
                <td class="mono">{{ entry.type }}</td>
                <td>
                  <div class="policies-source-cell">
                    <span class="chip" data-testid="device-detail-policies-source">{{ sourceLabel(entry.source) }}</span>
                    <span
                      v-if="entry.conflict"
                      class="conflict-flag"
                      title="Đang có xung đột giữa các policy cùng type này — xem 'Xem tất cả nguồn'."
                      data-testid="device-detail-policies-conflict-flag"
                      aria-hidden="true"
                    >⚠</span>
                    <button
                      v-if="entry.candidates.length > 1"
                      type="button"
                      class="link-btn"
                      data-testid="device-detail-policies-view-sources"
                      :aria-expanded="isExpanded(entry.type)"
                      @click="toggleCandidates(entry.type)"
                    >
                      {{ isExpanded(entry.type) ? 'Ẩn nguồn' : `Xem tất cả nguồn (${entry.candidates.length})` }}
                    </button>
                  </div>
                </td>
                <td><StatusBadge :status="entry.policy.status" /></td>
              </tr>
              <tr v-if="isExpanded(entry.type)" data-testid="device-detail-policies-candidates">
                <td colspan="4">
                  <ul class="candidate-list">
                    <li
                      v-for="candidate in entry.candidates"
                      :key="`${candidate.policy_id}-${candidate.source.kind}-${candidate.source.group?.id ?? 'direct'}`"
                      data-testid="device-detail-policies-candidate-row"
                    >
                      <span>{{ candidate.name }}</span>
                      <span class="chip">{{ sourceLabel(candidate.source) }}</span>
                      <span v-if="candidate.included" class="badge active">Đang áp dụng</span>
                      <span v-else class="reason">{{ candidate.excluded_reason }}</span>
                    </li>
                  </ul>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>
