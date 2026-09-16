<script setup lang="ts">
import { onMounted, onUnmounted, ref, useId } from 'vue'

/**
 * Shared confirmation dialog (docs/design/F5-frontend.md §2.1, spec'd in
 * UI_UX_design.md §8) — built once at F5 for "Xóa group" and deliberately
 * general enough that F6 (gỡ device khỏi group) and F8 (gỡ/gán policy)
 * reuse it without changing a line here.
 *
 * It exists so no screen ever reaches for `window.confirm`
 * (UI_UX_design.md §10): a native dialog cannot show a spinner, cannot be
 * styled, and cannot be asserted on by a test.
 *
 * Two contracts worth knowing before reusing it:
 *   - **Single-flight**: the confirm button disables itself for the whole
 *     duration of `onConfirm`, so a double click only ever produces one
 *     request (SoT F5 §5.2 A24) — every caller gets that for free.
 *   - **It never closes itself.** The parent owns the `v-if`. A component
 *     that cannot know whether the action succeeded must not decide to
 *     disappear: that is what lets "500 -> keep the dialog open so the user
 *     can retry" (A13) work without an extra prop.
 */
const props = withDefaults(
  defineProps<{
    title: string
    message: string
    /** Label of the confirm button. Neutral by default — each caller names its own action ("Xóa", "Gỡ khỏi group"...). */
    confirmLabel?: string
    cancelLabel?: string
    /** true -> confirm button is `btn-danger` (red); false -> `btn-primary`. */
    destructive?: boolean
    /** The real action. May be async — this component awaits it. */
    onConfirm: () => Promise<unknown> | unknown
    testId?: string
    confirmTestId?: string
    cancelTestId?: string
  }>(),
  {
    confirmLabel: 'Xác nhận',
    cancelLabel: 'Hủy',
    destructive: false,
    testId: undefined,
    confirmTestId: undefined,
    cancelTestId: undefined,
  },
)

const emit = defineEmits<{
  cancel: []
  error: [unknown]
}>()

const submitting = ref(false)
const cancelButton = ref<HTMLButtonElement | null>(null)
// Per-instance id: a hardcoded one would collide if two dialogs were ever
// mounted at once (not true today — GroupListView renders at most one — but
// this component is meant for F6/F8 to reuse unmodified, so it must not
// assume it stays a singleton).
const titleId = useId()

async function run() {
  // Single-flight: the guard, not just the `:disabled` attribute, is what
  // makes A24 true — a programmatic/duplicated event never gets past here.
  if (submitting.value) return
  submitting.value = true
  try {
    await props.onConfirm()
  } catch (error) {
    // The caller is expected to handle its own outcome inside `onConfirm`
    // (GroupListView does, in a try/catch). This catch only exists so a
    // rejected promise never surfaces as an unhandled rejection in the
    // console (UI_UX_design.md §10); listening to `error` is optional.
    emit('error', error)
  } finally {
    submitting.value = false
  }
}

function requestCancel() {
  // Blocked mid-flight for the same reason FormModal blocks it: never leave
  // an in-flight request with nowhere to render its result.
  if (submitting.value) return
  emit('cancel')
}

function onEscape(event: KeyboardEvent) {
  if (event.key === 'Escape') requestCancel()
}

onMounted(() => {
  document.addEventListener('keydown', onEscape)
  // Focus lands on "Hủy", never on the destructive button — a stray Enter
  // must not delete anything (F5-frontend.md §2.1).
  cancelButton.value?.focus()
})
onUnmounted(() => document.removeEventListener('keydown', onEscape))
</script>

<template>
  <div
    class="modal-backdrop"
    role="dialog"
    aria-modal="true"
    :aria-labelledby="titleId"
    :data-testid="testId"
    @click.self="requestCancel"
  >
    <div class="modal">
      <h3 :id="titleId">{{ title }}</h3>
      <p>{{ message }}</p>

      <div class="actions">
        <button
          ref="cancelButton"
          type="button"
          class="btn btn-secondary"
          :data-testid="cancelTestId"
          :disabled="submitting"
          @click="requestCancel"
        >
          {{ cancelLabel }}
        </button>
        <button
          type="button"
          class="btn"
          :class="destructive ? 'btn-danger' : 'btn-primary'"
          :data-testid="confirmTestId"
          :disabled="submitting"
          :data-busy="submitting"
          @click="run"
        >
          <span class="btn-label">{{ confirmLabel }}</span>
          <span class="spinner" aria-hidden="true"></span>
        </button>
      </div>
    </div>
  </div>
</template>
