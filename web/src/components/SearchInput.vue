<script setup lang="ts">
import { onUnmounted, ref, watch } from 'vue'

/**
 * Shared debounced search box (docs/design/F5-frontend.md §5 OQ-FE-1).
 *
 * Built as a shared component rather than inlined in `GroupListView`
 * because F7 (Policies list) needs exactly the same box: the debounce timer
 * + its `onUnmounted` cleanup is precisely the kind of logic that silently
 * rots when copied, and "typing resets to page 1" must not drift between
 * screens.
 *
 * It owns no routing: it reports a settled search term through `change`
 * (already debounced and trimmed) and lets the screen decide what that
 * means — same division of labour as `FilterBar`.
 */
const props = withDefaults(
  defineProps<{
    /** Current term, owned by the caller (usually read back out of the URL). */
    modelValue: string
    placeholder?: string
    debounceMs?: number
    testId?: string
    clearTestId?: string
  }>(),
  {
    placeholder: 'Tìm...',
    debounceMs: 300,
    testId: undefined,
    clearTestId: undefined,
  },
)

const emit = defineEmits<{
  change: [value: string]
  clear: []
}>()

/** Local mirror of the DOM value: it must update on every keystroke, while `change` only fires once the typing settles. */
const draft = ref(props.modelValue)
let timer: ReturnType<typeof setTimeout> | null = null

function cancelPending() {
  if (timer !== null) {
    clearTimeout(timer)
    timer = null
  }
}

function emitChange() {
  cancelPending()
  emit('change', draft.value.trim())
}

function onInput(event: Event) {
  draft.value = (event.target as HTMLInputElement).value
  cancelPending()
  timer = setTimeout(emitChange, props.debounceMs)
}

/** Enter applies immediately — waiting out the debounce after an explicit "go" feels broken. */
function onEnter() {
  emitChange()
}

function onClear() {
  cancelPending()
  draft.value = ''
  emit('clear')
}

// The term can change from outside (back/forward, a corrective
// router.replace) — mirror it back into the box, and drop any pending
// debounce so a stale keystroke can't overwrite the new term.
watch(
  () => props.modelValue,
  (next) => {
    if (next === draft.value) return
    cancelPending()
    draft.value = next
  },
)

// Leaving the screen mid-typing must not fire a `change` into an unmounted
// view (F5-frontend.md §5).
onUnmounted(cancelPending)
</script>

<template>
  <div class="search-row">
    <div class="field">
      <input
        type="search"
        :value="draft"
        :placeholder="placeholder"
        :data-testid="testId"
        @input="onInput"
        @keydown.enter.prevent="onEnter"
      />
    </div>
    <!-- Only rendered while there is something to clear — no dead button
         (SoT F5 §5.1, UI_UX_design.md §0.1). -->
    <button
      v-if="draft"
      type="button"
      class="btn btn-secondary"
      :data-testid="clearTestId"
      @click="onClear"
    >
      Xóa tìm kiếm
    </button>
  </div>
</template>
