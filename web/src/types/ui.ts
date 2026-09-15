/**
 * Prop contracts for the shared list components (FilterBar / DataTable).
 * They live outside the SFCs because `<script setup>` cannot export types,
 * and every screen that reuses these components needs them.
 */

export interface FilterOption {
  value: string
  label: string
}

export interface FilterDefinition {
  key: string
  label: string
  /** data-testid for the <select>, e.g. "filter-platform". */
  testId: string
  options: FilterOption[]
  /** Label of the "no filter" option. Defaults to "Tất cả". */
  allLabel?: string
}

export interface DataTableColumn<T> {
  /** Also becomes the cell's `data-field` attribute and the `cell-<key>` slot name. */
  key: string
  label: string
  /** Extra class on the <td> (e.g. "mono"). */
  cellClass?: string
  /** Plain-text cell value; omit when the column is rendered through its slot. */
  value?: (row: T) => string | null | undefined
}
