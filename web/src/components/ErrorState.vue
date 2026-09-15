<script setup lang="ts">
/**
 * Shared error banner with a retry affordance (UI_UX_design.md §9, SoT F2
 * §5.2 A11). Generic on purpose — any screen that loads data can drop this
 * in; it never knows *what* failed, it just reports and re-emits "retry".
 */
withDefaults(
  defineProps<{
    message: string
    retryLabel?: string
  }>(),
  { retryLabel: 'Thử lại' },
)

defineEmits<{ retry: [] }>()
</script>

<template>
  <div class="error-banner" data-testid="error-banner" role="alert">
    <span aria-hidden="true">⚠</span>
    <span class="banner-body">
      <span>{{ message }}</span>
      <button
        type="button"
        class="btn btn-secondary"
        data-testid="retry-button"
        @click="$emit('retry')"
      >
        {{ retryLabel }}
      </button>
    </span>
  </div>
</template>
