<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'

/**
 * Shared "type to search, pick one or many" control — docs/design/
 * F6-frontend.md §2.4, specced in UI_UX_design.md §8.
 *
 * Built once at F6 (device -> group, group -> device) and written to be
 * reused verbatim by F7/F8 for picking Policies: it knows nothing about
 * endpoints or resources, the caller passes a `search` fetcher and gets
 * `{ id, label, sublabel }` options back — the same division of labour
 * `DataTable` has with its rows.
 *
 * The debounce + its `onUnmounted` cleanup is copied from `SearchInput.vue`
 * rather than reusing that component: `SearchInput` hardwires a "Xóa tìm
 * kiếm" button next to the box, which makes no sense inside a dropdown.
 * Only the mechanism is shared, and it is the mechanism (a pending timer
 * firing into an unmounted component) that actually matters.
 *
 * Deliberately NOT implemented (F6-frontend.md §2.4 points 8–10, all noted
 * as known limits at approval time): no client-side cap on how many options
 * can be selected (the 500-id limit is the server's contract and must be
 * allowed to answer 422), no pagination inside the dropdown (page 1 only —
 * this is a search box, not a browser), and no arrow-key navigation.
 */
export interface AsyncSearchSelectOption {
  id: number
  /** Main line — identifier, group name... */
  label: string
  /** Optional smaller, muted second line (device name + platform, group description...). */
  sublabel?: string
}

const props = withDefaults(
  defineProps<{
    /**
     * Caller-supplied fetcher. Called once per settled debounce with the
     * trimmed query; this component never builds a URL itself.
     */
    search: (query: string) => Promise<AsyncSearchSelectOption[]>
    mode?: 'single' | 'multiple'
    placeholder?: string
    debounceMs?: number
    /** Minimum characters before any request goes out — default 1, so an empty box never silently loads "everything". */
    minChars?: number
    /** Controlled: the caller owns the selection so it can read it back at submit time. */
    modelValue: AsyncSearchSelectOption[]
    testId?: string
  }>(),
  {
    mode: 'multiple',
    placeholder: 'Tìm kiếm...',
    debounceMs: 300,
    minChars: 1,
    testId: undefined,
  },
)

const emit = defineEmits<{ 'update:modelValue': [AsyncSearchSelectOption[]] }>()

const query = ref('')
const results = ref<AsyncSearchSelectOption[]>([])
const loading = ref(false)
/** False until a search has actually come back, so "Không tìm thấy" never shows before the first response. */
const searched = ref(false)
const open = ref(false)

/**
 * Local request-id guard — same rule the Pinia list stores apply, kept
 * inside the component because no other screen needs to read this state.
 */
let lastRequestId = 0
let timer: ReturnType<typeof setTimeout> | null = null

function cancelPending() {
  if (timer !== null) {
    clearTimeout(timer)
    timer = null
  }
}

const trimmedQuery = computed(() => query.value.trim())
const belowMinChars = computed(() => trimmedQuery.value.length < props.minChars)

function testIdFor(suffix: string): string | undefined {
  return props.testId ? `${props.testId}-${suffix}` : undefined
}

async function runSearch() {
  const term = trimmedQuery.value
  if (term.length < props.minChars) return
  const requestId = ++lastRequestId
  loading.value = true
  try {
    const options = await props.search(term)
    if (requestId !== lastRequestId) return
    results.value = options
    searched.value = true
  } catch {
    if (requestId !== lastRequestId) return
    // A failed lookup shows the same "nothing to pick" dropdown rather than
    // its own error state: the form's own banner is where a failure the user
    // must act on belongs, and retrying here is just typing again.
    results.value = []
    searched.value = true
  } finally {
    if (requestId === lastRequestId) loading.value = false
  }
}

function onInput(event: Event) {
  query.value = (event.target as HTMLInputElement).value
  open.value = true
  cancelPending()
  if (belowMinChars.value) {
    // Nothing to search for: drop stale results (and make sure a response
    // still in flight can no longer land) instead of leaving the previous
    // term's list under a now-empty box.
    lastRequestId += 1
    loading.value = false
    results.value = []
    searched.value = false
    return
  }
  timer = setTimeout(runSearch, props.debounceMs)
}

function onFocus() {
  open.value = true
}

function isSelected(option: AsyncSearchSelectOption): boolean {
  return props.modelValue.some((selected) => selected.id === option.id)
}

function selectOption(option: AsyncSearchSelectOption) {
  if (props.mode === 'single') {
    // Replaces the whole selection and closes the list — there is nothing
    // more to pick, and leaving it open invites a second, ignored click.
    emit('update:modelValue', [option])
    open.value = false
    return
  }
  if (isSelected(option)) {
    emit(
      'update:modelValue',
      props.modelValue.filter((selected) => selected.id !== option.id),
    )
  } else {
    emit('update:modelValue', [...props.modelValue, option])
  }
  // Dropdown stays open on purpose: picking several rows in a row is the
  // whole point of `mode="multiple"`.
}

function removeSelected(option: AsyncSearchSelectOption) {
  emit(
    'update:modelValue',
    props.modelValue.filter((selected) => selected.id !== option.id),
  )
}

// Leaving the screen mid-typing must not fire a request into an unmounted
// component (same reason SearchInput does this).
onUnmounted(cancelPending)
</script>

<template>
  <div class="async-search">
    <input
      type="text"
      :value="query"
      :placeholder="placeholder"
      :data-testid="testId"
      @input="onInput"
      @focus="onFocus"
    />

    <div v-if="open" class="async-search-dropdown" :data-testid="testIdFor('dropdown')">
      <div v-if="loading" class="async-search-loading" :data-testid="testIdFor('loading')">
        <span class="spinner" aria-hidden="true" style="display: inline-block"></span>
        Đang tìm...
      </div>
      <div
        v-else-if="belowMinChars"
        class="async-search-hint"
        :data-testid="testIdFor('hint')"
      >
        Nhập từ khóa để tìm...
      </div>
      <div
        v-else-if="searched && results.length === 0"
        class="async-search-empty"
        :data-testid="testIdFor('empty')"
      >
        Không tìm thấy
      </div>
      <template v-else>
        <div
          v-for="option in results"
          :key="option.id"
          class="async-search-option"
          :class="{ 'is-selected': isSelected(option) }"
          :data-testid="testIdFor('option')"
          @click="selectOption(option)"
        >
          <strong>{{ option.label }}</strong>
          <span v-if="option.sublabel" class="sub">{{ option.sublabel }}</span>
        </div>
      </template>
    </div>

    <!-- The only place the user can see the whole current selection: search
         results change under them as they type, chips do not. Rendered in
         both modes (single simply never holds more than one). -->
    <div v-if="modelValue.length > 0" class="chip-list">
      <span
        v-for="option in modelValue"
        :key="option.id"
        class="chip"
        :data-testid="testIdFor('selected-chip')"
      >
        {{ option.label }}
        <button
          type="button"
          title="Bỏ chọn"
          :data-testid="testIdFor('selected-remove')"
          @click="removeSelected(option)"
        >
          ×
        </button>
      </span>
    </div>
  </div>
</template>
