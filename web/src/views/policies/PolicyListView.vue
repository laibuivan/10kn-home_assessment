<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { LocationQueryRaw } from 'vue-router'
import AppShell from '../../components/AppShell.vue'
import FilterBar from '../../components/FilterBar.vue'
import SearchInput from '../../components/SearchInput.vue'
import DataTable from '../../components/DataTable.vue'
import PaginationBar from '../../components/PaginationBar.vue'
import StatusBadge from '../../components/StatusBadge.vue'
import EmptyState from '../../components/EmptyState.vue'
import ErrorState from '../../components/ErrorState.vue'
import PolicyFormModal from '../../components/PolicyFormModal.vue'
import ActionsMenu from '../../components/ActionsMenu.vue'
import type { ActionsMenuItem } from '../../components/ActionsMenu.vue'
import { usePoliciesStore } from '../../stores/policies'
import { useToastStore } from '../../stores/toast'
import { extractErrorMessage } from '../../utils/apiError'
import { firstQueryValue } from '../../utils/queryParams'
import { isPolicyStatus, type Policy, type PolicyQueryParams, type PolicyStatus } from '../../types/policy'
import type { DataTableColumn, FilterDefinition } from '../../types/ui'

const route = useRoute()
const router = useRouter()
const store = usePoliciesStore()
const toastStore = useToastStore()

const TOGGLE_FAILED_MESSAGE = 'Không cập nhật được trạng thái, vui lòng thử lại.'

/**
 * The URL is the single source of truth for "what is being shown"
 * (docs/design/F7-frontend.md §1/§3): every render and every fetch reads
 * from here, and every interaction writes back with router.replace — same
 * mechanism as Devices/Groups. A hand-edited junk `page`/`status` is
 * sanitized rather than sent to the API.
 */
const activeQuery = computed<PolicyQueryParams>(() => {
  const parsedPage = Number(firstQueryValue(route.query.page))
  const page = Number.isInteger(parsedPage) && parsedPage >= 1 ? parsedPage : 1
  const q = (firstQueryValue(route.query.q) ?? '').trim()
  const rawStatus = firstQueryValue(route.query.status)
  return {
    q: q || undefined,
    status: isPolicyStatus(rawStatus) ? rawStatus : undefined,
    page,
  }
})

const searchTerm = computed(() => activeQuery.value.q ?? '')
const hasActiveQuery = computed(() => !!activeQuery.value.q || !!activeQuery.value.status)

const filterValues = computed<Record<string, string>>(() => ({
  status: activeQuery.value.status ?? '',
}))

const filters: FilterDefinition[] = [
  {
    key: 'status',
    label: 'Status',
    testId: 'filter-status',
    options: [
      { value: 'active', label: 'active' },
      { value: 'inactive', label: 'inactive' },
    ],
  },
]

// No "Số nơi đang gán" column (SoT OQ-6 — F8 carry-over: no
// `policy_assignments` table exists yet at F7, `serialize_policy` does not
// return this field).
const columns: DataTableColumn<Policy>[] = [
  { key: 'name', label: 'Name', value: (row) => row.name },
  { key: 'type', label: 'Type', value: (row) => row.type },
  { key: 'status', label: 'Status' },
  { key: 'actions', label: '', cellClass: 'actions-cell' },
]

// ---------- Create/edit modal ----------
const showModal = ref(false)
const modalMode = ref<'create' | 'edit'>('create')
const modalPolicy = ref<Policy | null>(null)

function openCreateModal() {
  modalMode.value = 'create'
  modalPolicy.value = null
  showModal.value = true
}

function openEditModal(policy: Policy) {
  modalMode.value = 'edit'
  modalPolicy.value = policy
  showModal.value = true
}

function closeModal() {
  showModal.value = false
}

// ---------- Toggle status (§2.3) — direct PATCH from the "⋯" menu, no modal ----------
/** Single-flight per row: an array of ids currently in flight, not one global boolean. */
const togglingIds = ref<number[]>([])

function isToggling(id: number): boolean {
  return togglingIds.value.includes(id)
}

async function toggleStatus(policy: Policy) {
  if (isToggling(policy.id)) return
  togglingIds.value = [...togglingIds.value, policy.id]
  const nextStatus: PolicyStatus = policy.status === 'active' ? 'inactive' : 'active'
  try {
    await store.updatePolicy(policy.id, { status: nextStatus })
    toastStore.push(nextStatus === 'active' ? 'Đã kích hoạt policy' : 'Đã vô hiệu hoá policy')
    load()
  } catch (error) {
    toastStore.push(extractErrorMessage(error, TOGGLE_FAILED_MESSAGE), 'error')
  } finally {
    togglingIds.value = togglingIds.value.filter((id) => id !== policy.id)
  }
}

/**
 * Exactly 2 items — "Sửa" and the status toggle (S30: no "Xóa"/"Xem chi
 * tiết", since neither a delete route nor a detail page exists at F7).
 * Both are disabled on the row currently mid-toggle, so a stray edit
 * submit can never race the in-flight PATCH.
 */
function rowActions(policy: Policy): ActionsMenuItem[] {
  const toggling = isToggling(policy.id)
  return [
    {
      key: 'edit',
      label: 'Sửa',
      onClick: () => openEditModal(policy),
      disabled: toggling,
      testId: 'policy-action-edit',
    },
    {
      key: 'toggle-status',
      label: policy.status === 'active' ? 'Vô hiệu hoá' : 'Kích hoạt',
      onClick: () => toggleStatus(policy),
      disabled: toggling,
      testId: 'policy-action-toggle-status',
    },
  ]
}

function onSaved(payload: { mode: 'create' | 'edit'; message: string }) {
  closeModal()
  toastStore.push(payload.message)
  if (payload.mode === 'create') {
    // Back to page 1 (keeping q/status) so the newest policy is visible.
    const wasOnFirstPage = activeQuery.value.page === 1
    replaceQuery({ q: activeQuery.value.q, status: activeQuery.value.status })
    if (wasOnFirstPage) load()
    return
  }
  load()
}

// Empty only once a response has actually come back — before that the table
// shows skeleton rows, not "no policies" (UI_UX_design.md §9).
const showEmptyState = computed(
  () => !store.loading && store.meta !== null && store.meta.total_count === 0,
)

// A19 (org has no policy at all) is the only empty variant with a "+ Thêm
// Policy" CTA; A20 (search/filter matched nothing) only offers "Xóa bộ lọc".
// Distinguished purely by the FE's own query state — the API returns an
// identical body for both (F7-frontend.md §4).
const showEmptyStateNoPolicies = computed(() => showEmptyState.value && !hasActiveQuery.value)

function load() {
  return store.fetchPolicies(activeQuery.value)
}

function replaceQuery(query: LocationQueryRaw) {
  router.replace({ query })
}

/** Changing the search term always resets to page 1 — the page key is simply dropped. */
function onSearchChange(value: string) {
  replaceQuery({ q: value || undefined, status: activeQuery.value.status })
}

/** Search's own clear button only clears `q`, keeping `status` (OQ-FE-2). */
function onSearchClear() {
  replaceQuery({ status: activeQuery.value.status })
}

/** Changing the status filter always resets to page 1. */
function onFilterChange(values: Record<string, string>) {
  replaceQuery({ q: activeQuery.value.q, status: values.status || undefined })
}

/** FilterBar's own clear button only clears `status`, keeping `q` (OQ-FE-2). */
function onFilterClear() {
  replaceQuery({ q: activeQuery.value.q })
}

/** A20's own CTA clears both q and status at once — no way to know which one is "the culprit" for 0 results. */
function onClearAll() {
  replaceQuery({})
}

/** Changing the page always keeps the current search term and status filter. */
function onPageChange(page: number) {
  replaceQuery({
    q: activeQuery.value.q,
    status: activeQuery.value.status,
    page: page === 1 ? undefined : String(page),
  })
}

watch(
  activeQuery,
  () => {
    load()
  },
  { immediate: true },
)

// A page past the end of the result set would show a confusing blank table
// while data does exist — walk back instead.
watch(
  () => store.meta,
  (meta) => {
    if (!meta) return
    if (meta.total_pages > 0 && activeQuery.value.page > meta.total_pages) {
      onPageChange(meta.total_pages)
    } else if (meta.total_count === 0 && activeQuery.value.page > 1) {
      onPageChange(1)
    }
  },
)
</script>

<template>
  <AppShell>
    <div class="list-head">
      <h3>Policies</h3>
      <button
        v-if="!showEmptyStateNoPolicies"
        type="button"
        class="btn btn-primary"
        data-testid="add-policy-button"
        @click="openCreateModal"
      >
        + Thêm Policy
      </button>
    </div>

    <!-- Always visible, in every state — including while the table is in error. -->
    <SearchInput
      :model-value="searchTerm"
      placeholder="Tìm theo tên policy..."
      test-id="policy-search-input"
      clear-test-id="search-clear-button"
      @change="onSearchChange"
      @clear="onSearchClear"
    />
    <FilterBar
      :filters="filters"
      :model-value="filterValues"
      @change="onFilterChange"
      @clear="onFilterClear"
    />

    <ErrorState v-if="store.error" :message="store.error" @retry="load" />

    <EmptyState
      v-else-if="showEmptyState && hasActiveQuery"
      title="Không tìm thấy policy nào"
      description="Thử từ khóa/bộ lọc khác."
    >
      <button
        type="button"
        class="btn btn-secondary"
        data-testid="empty-state-clear-button"
        @click="onClearAll"
      >
        Xóa bộ lọc
      </button>
    </EmptyState>

    <EmptyState
      v-else-if="showEmptyState"
      title="Chưa có policy nào"
      description="Organization này chưa có Policy nào."
    >
      <button type="button" class="btn btn-primary" data-testid="add-policy-button" @click="openCreateModal">
        + Thêm Policy
      </button>
    </EmptyState>

    <template v-else>
      <!-- No `onRowClick` — F7 has no detail page to go to (OQ-7). -->
      <DataTable
        :columns="columns"
        :rows="store.policies"
        :row-key="(row: Policy) => row.id"
        :loading="store.loading"
        test-id="policies-table"
        row-test-id="policy-row"
      >
        <template #cell-status="{ row }">
          <StatusBadge :status="(row as Policy).status" />
        </template>
        <template #cell-actions="{ row }">
          <ActionsMenu :items="rowActions(row as Policy)" />
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

  <PolicyFormModal
    v-if="showModal"
    :mode="modalMode"
    :policy="modalPolicy"
    @saved="onSaved"
    @cancel="closeModal"
  />
</template>
