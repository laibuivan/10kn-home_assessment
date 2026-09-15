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

const rangeStart = computed(() =>
  props.totalCount === 0 ? 0 : (props.currentPage - 1) * props.perPage + 1,
)
const rangeEnd = computed(() => Math.min(props.currentPage * props.perPage, props.totalCount))

const canGoPrev = computed(() => !props.loading && props.currentPage > 1)
const canGoNext = computed(() => !props.loading && props.currentPage < props.totalPages)

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
        @click="go(currentPage - 1)"
      >
        ‹ Trước
      </button>
      <span class="page-indicator" data-testid="pagination-page-indicator">
        Trang {{ currentPage }} / {{ totalPages }}
      </span>
      <button
        type="button"
        data-testid="pagination-next"
        :disabled="!canGoNext"
        @click="go(currentPage + 1)"
      >
        Sau ›
      </button>
    </div>
  </div>
</template>
