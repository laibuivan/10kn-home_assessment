<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'

/**
 * Generic modal shell for create/edit forms (docs/design/F3-frontend.md §1).
 *
 * Knows nothing about specific fields — the form itself is the default
 * slot, owned and validated by the caller (`DeviceFormModal` today, later
 * Group/Policy). Only owns: backdrop, title, the `baseError` banner above
 * the slot, and the Cancel/Save action row (disable + spinner while
 * `submitting`).
 *
 * Closes on backdrop click / Escape / Cancel — EXCEPT while `submitting`
 * (F3-frontend.md §5 risk note: avoids an orphaned in-flight request with
 * nowhere left to render its response).
 */
const props = withDefaults(
  defineProps<{
    title: string
    submitting?: boolean
    /**
     * Extra, caller-owned reason to block submission (F6: "nothing selected
     * yet"). Additive to `submitting` and separate from it on purpose — a
     * disabled-because-nothing-to-send button must NOT show the in-flight
     * spinner, which is what reusing `submitting` for this would do.
     */
    submitDisabled?: boolean
    baseError?: string | null
    submitLabel?: string
    cancelLabel?: string
    testId?: string
    bannerTestId?: string
    submitTestId?: string
    cancelTestId?: string
    /**
     * NEW at F7 (docs/design/F7-frontend.md §2.4) — the JSON editor +
     * Format button in `PolicyFormModal` need more room than the base
     * `.modal { max-width: 360px }` gives Group/Device. Backward compatible:
     * defaults to `false`, so every existing caller (`GroupFormModal`,
     * `DeviceFormModal`) keeps rendering byte-identical CSS/behavior.
     */
    wide?: boolean
  }>(),
  {
    submitting: false,
    submitDisabled: false,
    baseError: null,
    submitLabel: 'Lưu',
    cancelLabel: 'Hủy',
    testId: undefined,
    bannerTestId: undefined,
    submitTestId: undefined,
    cancelTestId: undefined,
    wide: false,
  },
)

const emit = defineEmits<{
  submit: []
  cancel: []
}>()

function requestCancel() {
  if (props.submitting) return
  emit('cancel')
}

function onEscape(event: KeyboardEvent) {
  if (event.key === 'Escape') requestCancel()
}

onMounted(() => document.addEventListener('keydown', onEscape))
onUnmounted(() => document.removeEventListener('keydown', onEscape))
</script>

<template>
  <div class="modal-backdrop" :data-testid="testId" @click.self="requestCancel">
    <form class="modal" :class="{ 'modal-wide': wide }" @submit.prevent="$emit('submit')">
      <h3>{{ title }}</h3>

      <div v-if="baseError" class="error-banner" role="alert" :data-testid="bannerTestId">
        <span aria-hidden="true">⚠</span>
        <span>{{ baseError }}</span>
      </div>

      <div class="modal-body">
        <slot />
      </div>

      <div class="actions">
        <button
          type="button"
          class="btn btn-secondary"
          :data-testid="cancelTestId"
          :disabled="submitting"
          @click="requestCancel"
        >
          {{ cancelLabel }}
        </button>
        <button
          type="submit"
          class="btn btn-primary"
          :data-testid="submitTestId"
          :disabled="submitting || submitDisabled"
          :data-busy="submitting"
        >
          <span class="btn-label">{{ submitLabel }}</span>
          <span class="spinner" aria-hidden="true"></span>
        </button>
      </div>
    </form>
  </div>
</template>
