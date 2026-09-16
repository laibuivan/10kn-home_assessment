/**
 * Helpers for reading `route.query` — shared by every list screen that keeps
 * its filters/page in the URL (F5-frontend.md §5 OQ-FE-4). Moved out of
 * `DeviceListView.vue` unchanged when `GroupListView` needed the same rule.
 */

/** vue-router repeats a query key as an array (`?page=1&page=2`) — only the first value is ever meaningful here. */
export function firstQueryValue(value: string | (string | null)[] | null): string | null {
  return Array.isArray(value) ? (value[0] ?? null) : value
}
