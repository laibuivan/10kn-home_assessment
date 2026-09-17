<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import type { PolicyAssignmentJob } from '../types/policyAssignmentJob'

/**
 * One card for one job — docs/design/F8-frontend.md §2.3.2. Purely
 * presentational: it renders `job` and emits the user's intent
 * (`retry`/`dismiss`); it never polls itself — `stores/jobs.ts` is the only
 * place with a `setInterval`, so the timer's lifetime is the session's, not
 * this component's mount lifetime (which would die every route change).
 */
const props = defineProps<{ job: PolicyAssignmentJob }>()
const emit = defineEmits<{ retry: [job: PolicyAssignmentJob]; dismiss: [jobId: number] }>()

/** "Xem chi tiết" toggle when `failed` — there is no dedicated job route to navigate to. */
const expanded = ref(false)

const groupLabel = computed(() => props.job.group?.name ?? '(group đã bị xóa)')

const message = computed(() => {
  switch (props.job.status) {
    case 'pending':
      return `Đang chờ xử lý policy "${props.job.policy.name}" cho group "${groupLabel.value}"...`
    case 'running':
      return `Đang gán policy "${props.job.policy.name}" cho ${props.job.total_count} thiết bị...`
    case 'done':
      return `Đã gán policy "${props.job.policy.name}" cho ${props.job.total_count} thiết bị.`
    case 'failed':
      return `Gán policy "${props.job.policy.name}" cho group "${groupLabel.value}" thất bại.`
    default:
      return ''
  }
})

/** No "Thử lại" once the Group is gone — nothing left to re-enqueue against (A10/§2.3.2). */
const canRetry = computed(() => props.job.status === 'failed' && props.job.group !== null)
const showButtons = computed(() => props.job.status === 'done' || props.job.status === 'failed')

let autoHideTimer: ReturnType<typeof setTimeout> | null = null
watch(
  () => props.job.status,
  (status) => {
    if (status === 'done') {
      autoHideTimer = setTimeout(() => emit('dismiss', props.job.id), 4000)
    }
  },
  { immediate: true },
)
onUnmounted(() => {
  if (autoHideTimer) clearTimeout(autoHideTimer)
})
</script>

<template>
  <div
    class="job-banner"
    :class="`status-${job.status}`"
    :data-job-id="job.id"
    data-testid="async-job-banner"
    role="status"
  >
    <span>
      <span v-if="job.status === 'pending' || job.status === 'running'" class="spinner" aria-hidden="true" style="display: inline-block"></span>
      {{ message }}
    </span>

    <div v-if="expanded && job.status === 'failed' && job.error_message" class="job-banner-detail">
      {{ job.error_message }}
    </div>

    <div v-if="showButtons" class="job-banner-actions">
      <button
        v-if="job.status === 'failed'"
        type="button"
        class="btn btn-secondary btn-sm"
        data-testid="async-job-banner-details-toggle"
        @click="expanded = !expanded"
      >
        Xem chi tiết
      </button>
      <button
        v-if="canRetry"
        type="button"
        class="btn btn-secondary btn-sm"
        data-testid="async-job-banner-retry"
        @click="emit('retry', job)"
      >
        Thử lại
      </button>
      <button
        type="button"
        class="btn btn-secondary btn-sm"
        data-testid="async-job-banner-dismiss"
        @click="emit('dismiss', job.id)"
      >
        Đóng
      </button>
    </div>
  </div>
</template>
