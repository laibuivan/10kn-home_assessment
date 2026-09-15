<script setup lang="ts" generic="T">
import { computed } from 'vue'
import type { DataTableColumn } from '../types/ui'

/**
 * Shared data table (UI_UX_design.md §8, ma trận loading §9).
 *
 * Loading has two distinct looks, both handled here so every list screen
 * behaves the same:
 *   - first load (no rows yet)  -> skeleton rows
 *   - refetch (rows on screen)  -> dim overlay + spinner over the old rows,
 *     never a blank flash (SoT F2 §7)
 *
 * `onRowClick` is optional: without it the table is not clickable and does
 * not pretend to be (no `.is-clickable`, hence no pointer cursor — see
 * components.css). F2 passes no handler.
 */
const props = withDefaults(
  defineProps<{
    columns: DataTableColumn<T>[]
    rows: T[]
    rowKey: (row: T) => string | number
    loading?: boolean
    skeletonRows?: number
    /** Text rendered when a column value is null/empty (F2-frontend.md §5 OQ-FE-5). */
    emptyValue?: string
    onRowClick?: (row: T) => void
    testId?: string
    rowTestId?: string
  }>(),
  {
    loading: false,
    skeletonRows: 5,
    emptyValue: '—',
    onRowClick: undefined,
    testId: undefined,
    rowTestId: undefined,
  },
)

const showSkeleton = computed(() => props.loading && props.rows.length === 0)
const showOverlay = computed(() => props.loading && props.rows.length > 0)
const skeletonRowIndexes = computed(() => Array.from({ length: props.skeletonRows }, (_, i) => i))

function cellText(column: DataTableColumn<T>, row: T): string {
  const raw = column.value?.(row)
  return raw === null || raw === undefined || raw === '' ? props.emptyValue : raw
}
</script>

<template>
  <div class="table-overlay-wrap">
    <div class="table-wrap">
      <!--
        While the skeleton is up there is no data to read yet, so the table
        does NOT answer to `testId` — a test (or a human) waiting for
        "the devices table" waits for real rows, not for placeholders.
      -->
      <table
        class="data-table"
        :class="{ 'is-clickable': !!onRowClick }"
        :data-testid="showSkeleton ? undefined : testId"
      >
        <thead>
          <tr>
            <th v-for="column in columns" :key="column.key">{{ column.label }}</th>
          </tr>
        </thead>
        <tbody v-if="showSkeleton">
          <tr v-for="index in skeletonRowIndexes" :key="`skeleton-${index}`" data-testid="skeleton-row">
            <td v-for="column in columns" :key="column.key">
              <span class="skeleton-cell"></span>
            </td>
          </tr>
        </tbody>
        <tbody v-else>
          <tr
            v-for="row in rows"
            :key="rowKey(row)"
            :data-testid="rowTestId"
            @click="onRowClick?.(row)"
          >
            <td v-for="column in columns" :key="column.key" :data-field="column.key" :class="column.cellClass">
              <slot :name="`cell-${column.key}`" :row="row">{{ cellText(column, row) }}</slot>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-if="showOverlay" class="table-loading-overlay" data-testid="table-loading-overlay">
      <span class="spinner" aria-hidden="true"></span>
    </div>
  </div>
</template>
