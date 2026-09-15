<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import type { FilterDefinition } from '../types/ui'

/**
 * Shared filter bar (UI_UX_design.md §8). Driven entirely by props and
 * events — it owns no routing logic, so each screen decides whether its
 * filters live in the URL (F2 does: docs/design/F2-frontend.md §3) or in
 * local state. Declarative `filters` keeps it reusable for the Groups /
 * Policies lists later.
 */
const props = withDefaults(
  defineProps<{
    filters: FilterDefinition[]
    /** Current value per filter key; "" means no filter on that key. */
    modelValue: Record<string, string>
    clearLabel?: string
  }>(),
  { clearLabel: 'Xóa lọc' },
)

const emit = defineEmits<{
  change: [values: Record<string, string>]
  clear: []
}>()

// Local mirror of the selects' DOM state. Two selects can be changed in
// quick succession (faster than the URL round-trip that feeds `modelValue`
// back in), so emitting from this mirror guarantees the second change still
// carries the first one's value instead of dropping it.
const values = ref<Record<string, string>>({ ...props.modelValue })

// The parent always passes a freshly-built object (a computed in
// DeviceListView), so a reference-equality watch already fires on every
// real change — `deep: true` would only add a wasted recursive diff.
watch(
  () => props.modelValue,
  (next) => {
    values.value = { ...next }
  },
)

const hasActiveFilter = computed(() => Object.values(values.value).some((v) => !!v))

function onSelect(key: string, event: Event) {
  values.value = { ...values.value, [key]: (event.target as HTMLSelectElement).value }
  emit('change', { ...values.value })
}

function onClear() {
  const cleared: Record<string, string> = {}
  for (const filter of props.filters) cleared[filter.key] = ''
  values.value = cleared
  emit('clear')
}
</script>

<template>
  <div class="filter-bar">
    <div v-for="filter in filters" :key="filter.key" class="field">
      <label :for="`filter-${filter.key}`">{{ filter.label }}</label>
      <select
        :id="`filter-${filter.key}`"
        :data-testid="filter.testId"
        :value="values[filter.key] ?? ''"
        @change="onSelect(filter.key, $event)"
      >
        <option value="">{{ filter.allLabel ?? 'Tất cả' }}</option>
        <option v-for="option in filter.options" :key="option.value" :value="option.value">
          {{ option.label }}
        </option>
      </select>
    </div>

    <!-- Only rendered while a filter is actually applied (SoT F2 §5.1). -->
    <button
      v-if="hasActiveFilter"
      type="button"
      class="btn btn-secondary clear-btn"
      data-testid="filter-clear-button"
      @click="onClear"
    >
      {{ clearLabel }}
    </button>
  </div>
</template>
