<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { LocationQueryRaw } from 'vue-router'
import AppShell from '../../components/AppShell.vue'
import FilterBar from '../../components/FilterBar.vue'
import DataTable from '../../components/DataTable.vue'
import PaginationBar from '../../components/PaginationBar.vue'
import StatusBadge from '../../components/StatusBadge.vue'
import EmptyState from '../../components/EmptyState.vue'
import ErrorState from '../../components/ErrorState.vue'
import DeviceFormModal from '../../components/DeviceFormModal.vue'
import { useDevicesStore } from '../../stores/devices'
import { useToastStore } from '../../stores/toast'
import {
  DEVICE_PLATFORMS,
  DEVICE_STATUSES,
  isDevicePlatform,
  isDeviceStatus,
  type Device,
  type DeviceQueryParams,
} from '../../types/device'
import type { DataTableColumn, FilterDefinition } from '../../types/ui'

const route = useRoute()
const router = useRouter()
const store = useDevicesStore()
const toastStore = useToastStore()

/**
 * The URL is the single source of truth for "what is being shown"
 * (docs/design/F2-frontend.md §3): every render and every fetch reads from
 * here, and every interaction writes back with router.replace. Hand-edited
 * junk in the query string is sanitized away rather than sent to the API —
 * the dropdowns can only produce valid values, so a 422 banner would only
 * ever be shown to someone who typed the URL themselves (§5 OQ-FE-1/2).
 */
/** vue-router repeats a query key as an array (`?page=1&page=2`) — only the first value is ever meaningful here. */
function firstQueryValue(value: string | (string | null)[] | null): string | null {
  return Array.isArray(value) ? (value[0] ?? null) : value
}

const activeQuery = computed<DeviceQueryParams>(() => {
  const parsedPage = Number(firstQueryValue(route.query.page))
  const page = Number.isInteger(parsedPage) && parsedPage >= 1 ? parsedPage : 1

  const rawPlatform = firstQueryValue(route.query.platform)
  const rawStatus = firstQueryValue(route.query.status)

  return {
    platform: isDevicePlatform(rawPlatform) ? rawPlatform : undefined,
    status: isDeviceStatus(rawStatus) ? rawStatus : undefined,
    page,
  }
})

const hasActiveFilter = computed(() => !!activeQuery.value.platform || !!activeQuery.value.status)

const filterValues = computed<Record<string, string>>(() => ({
  platform: activeQuery.value.platform ?? '',
  status: activeQuery.value.status ?? '',
}))

const filters: FilterDefinition[] = [
  {
    key: 'platform',
    label: 'Platform',
    testId: 'filter-platform',
    options: DEVICE_PLATFORMS.map((value) => ({ value, label: value })),
  },
  {
    key: 'status',
    label: 'Status',
    testId: 'filter-status',
    options: DEVICE_STATUSES.map((value) => ({ value, label: value })),
  },
]

const columns: DataTableColumn<Device>[] = [
  { key: 'identifier', label: 'Identifier', cellClass: 'mono', value: (row) => row.identifier },
  { key: 'name', label: 'Name', value: (row) => row.name },
  { key: 'platform', label: 'Platform', value: (row) => row.platform },
  { key: 'os_version', label: 'OS Version', value: (row) => row.os_version },
  { key: 'status', label: 'Status' },
  { key: 'last_seen_at', label: 'Last seen', value: (row) => formatTimestamp(row.last_seen_at) },
  { key: 'actions', label: '', cellClass: 'actions-cell' },
]

const RETIRED_EDIT_BLOCKED_MESSAGE = 'Thiết bị đã retired, không thể sửa'

// ---------- Create/edit modal (F3-frontend.md §1/§3) ----------
const showModal = ref(false)
const modalMode = ref<'create' | 'edit'>('create')
const modalDevice = ref<Device | null>(null)

function openCreateModal() {
  modalMode.value = 'create'
  modalDevice.value = null
  showModal.value = true
}

function openEditModal(device: Device) {
  modalMode.value = 'edit'
  modalDevice.value = device
  showModal.value = true
}

function closeModal() {
  showModal.value = false
}

function onSaved(payload: { mode: 'create' | 'edit'; message: string }) {
  closeModal()
  toastStore.push(payload.message)
  // Refetch at the current filter/page from the URL — no query change, no
  // page jump (SoT F3 §5.1). If the just-edited record no longer matches
  // the active filter it simply disappears from the table; that's correct.
  load()
}

function formatTimestamp(value: string | null): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

// Empty only once a response has actually come back — before that the table
// shows skeleton rows, not "no devices" (UI_UX_design.md §9).
const showEmptyState = computed(
  () => !store.loading && store.meta !== null && store.meta.total_count === 0,
)

// Variant A1 (org has no devices at all, no filter applied) is the only
// empty variant that gets a "+ Thêm Device" CTA (SoT F3 §7); A2 (empty
// because of an active filter) keeps just "Xóa lọc" as in F2. The list-head
// button is hidden while A1's own CTA is showing so there is only ever one
// `add-device-button` on the page at a time (F3-frontend.md §2).
const showEmptyStateA1 = computed(() => showEmptyState.value && !hasActiveFilter.value)

function load() {
  return store.fetchDevices(activeQuery.value)
}

function replaceQuery(query: LocationQueryRaw) {
  router.replace({ query })
}

/** Changing a filter always resets to page 1 (SoT F2 §5.1) — the page key is simply dropped. */
function onFilterChange(values: Record<string, string>) {
  replaceQuery({
    platform: values.platform || undefined,
    status: values.status || undefined,
  })
}

function onClearFilters() {
  replaceQuery({})
}

/** Changing the page always keeps the current filter (SoT F2 §5.1). */
function onPageChange(page: number) {
  replaceQuery({
    platform: activeQuery.value.platform,
    status: activeQuery.value.status,
    page: page === 1 ? undefined : String(page),
  })
}

// `activeQuery` is a computed that reads individual route.query.* fields, so
// it already re-evaluates as a plain reference change on every navigation —
// `deep: true` would only add a wasted recursive diff of the returned object.
watch(
  activeQuery,
  () => {
    load()
  },
  { immediate: true },
)

// A page number past the end of the (possibly just-filtered) result set
// would show a confusing blank table while data does exist — walk back to
// the last real page instead (F2-frontend.md §5 OQ-FE-4).
watch(
  () => store.meta,
  (meta) => {
    if (!meta) return
    if (meta.total_pages > 0 && activeQuery.value.page > meta.total_pages) {
      onPageChange(meta.total_pages)
    }
  },
)
</script>

<template>
  <AppShell>
    <div class="list-head">
      <h3>Devices</h3>
      <button
        v-if="!showEmptyStateA1"
        type="button"
        class="btn btn-primary"
        data-testid="add-device-button"
        @click="openCreateModal"
      >
        + Thêm Device
      </button>
    </div>

    <!-- Always visible, in every state — including while the table is in
         error (SoT F2 §7 / §5.2 A11). -->
    <FilterBar
      :filters="filters"
      :model-value="filterValues"
      @change="onFilterChange"
      @clear="onClearFilters"
    />

    <ErrorState v-if="store.error" :message="store.error" @retry="load" />

    <EmptyState
      v-else-if="showEmptyState && hasActiveFilter"
      title="Không tìm thấy thiết bị nào khớp bộ lọc"
      description="Thử đổi hoặc xóa bộ lọc đang áp dụng."
    >
      <button
        type="button"
        class="btn btn-secondary"
        data-testid="empty-state-clear-button"
        @click="onClearFilters"
      >
        Xóa lọc
      </button>
    </EmptyState>

    <EmptyState
      v-else-if="showEmptyState"
      title="Không có thiết bị nào"
      description="Organization này chưa có Device nào."
    >
      <button type="button" class="btn btn-primary" data-testid="add-device-button" @click="openCreateModal">
        + Thêm Device
      </button>
    </EmptyState>

    <template v-else>
      <DataTable
        :columns="columns"
        :rows="store.devices"
        :row-key="(row: Device) => row.id"
        :loading="store.loading"
        test-id="devices-table"
        row-test-id="device-row"
      >
        <template #cell-status="{ row }">
          <StatusBadge :status="(row as Device).status" />
        </template>
        <template #cell-actions="{ row }">
          <span
            v-if="(row as Device).status === 'retired'"
            class="tooltip-wrap"
            data-testid="edit-device-tooltip"
            :title="RETIRED_EDIT_BLOCKED_MESSAGE"
          >
            <button type="button" class="btn btn-secondary" data-testid="edit-device-button" disabled>
              Sửa
            </button>
          </span>
          <button
            v-else
            type="button"
            class="btn btn-secondary"
            data-testid="edit-device-button"
            @click="openEditModal(row as Device)"
          >
            Sửa
          </button>
        </template>
      </DataTable>

      <PaginationBar
        v-if="store.meta"
        :current-page="store.meta.current_page"
        :per-page="store.meta.per_page"
        :total-count="store.meta.total_count"
        :total-pages="store.meta.total_pages"
        :loading="store.loading"
        @change="onPageChange"
      />
    </template>
  </AppShell>

  <DeviceFormModal
    v-if="showModal"
    :mode="modalMode"
    :device="modalDevice"
    @saved="onSaved"
    @cancel="closeModal"
  />
</template>
