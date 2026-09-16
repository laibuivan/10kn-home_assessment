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

/**
 * Pagination envelope returned by every paginated list endpoint
 * (`meta` in F2-api.md §5 / F5-api.md §1) — identical for Devices, Groups
 * and (later) Policies, so it lives here next to the other shared list
 * component contracts rather than in one feature's type file
 * (F5-frontend.md §5 OQ-FE-2). `PaginationBar`'s props mirror it field by
 * field.
 */
export interface PaginationMeta {
  current_page: number
  per_page: number
  total_count: number
  total_pages: number
}
