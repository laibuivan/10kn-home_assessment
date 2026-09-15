<script setup lang="ts">
import { computed } from 'vue'

/**
 * Shared pagination bar (UI_UX_design.md §8). Purely presentational: it
 * reports the page the user asked for and lets the screen decide what that
 * means (F2 writes it into the URL — docs/design/F2-frontend.md §2).
 */
const props = withDefaults(
  defineProps<{
    currentPage: number
    perPage: number
    totalCount: number
    totalPages: number
    loading?: boolean
  }>(),
  { loading: false },
)

const emit = defineEmits<{ change: [page: number] }>()

/**
 * `currentPage` can transiently be out of `[1, totalPages]` — e.g. right
 * after loading a URL whose `page` was past the end, for the one render
 * between that response landing and DeviceListView's corrective
 * `router.replace` resolving (F2-frontend.md §5 OQ-FE-4). Displaying and
 * enabling controls off the raw prop would show a nonsensical range and a
 * Prev button that looks enabled but silently no-ops against `go`'s own
 * bounds check — so every derived value here reads the clamped page.
 */
const displayPage = computed(() => Math.min(Math.max(props.currentPage, 1), Math.max(props.totalPages, 1)))

const rangeStart = computed(() =>
  props.totalCount === 0 ? 0 : (displayPage.value - 1) * props.perPage + 1,
)
const rangeEnd = computed(() => Math.min(displayPage.value * props.perPage, props.totalCount))

const canGoPrev = computed(() => !props.loading && displayPage.value > 1)
const canGoNext = computed(() => !props.loading && displayPage.value < props.totalPages)

function go(page: number) {
  if (props.loading) return
  if (page < 1 || page > props.totalPages || page === props.currentPage) return
  emit('change', page)
}
</script>

<template>
  <div class="pagination" :data-disabled="loading">
    <span data-testid="pagination-info">
      Hiển thị {{ rangeStart }}–{{ rangeEnd }} / {{ totalCount }}
    </span>
    <div class="steps">
      <button
        type="button"
        data-testid="pagination-prev"
        :disabled="!canGoPrev"
        @click="go(displayPage - 1)"
      >
        ‹ Trước
      </button>
      <span class="page-indicator" data-testid="pagination-page-indicator">
        Trang {{ displayPage }} / {{ totalPages }}
      </span>
      <button
        type="button"
        data-testid="pagination-next"
        :disabled="!canGoNext"
        @click="go(displayPage + 1)"
      >
        Sau ›
      </button>
    </div>
  </div>
</template>
