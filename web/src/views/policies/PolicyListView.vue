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
import ConfirmModal from '../../components/ConfirmModal.vue'
import ActionsMenu from '../../components/ActionsMenu.vue'
import type { ActionsMenuItem } from '../../components/ActionsMenu.vue'
import { usePoliciesStore } from '../../stores/policies'
import { useToastStore } from '../../stores/toast'
import { extractErrorMessage } from '../../utils/apiError'
import { firstQueryValue } from '../../utils/queryParams'
import { DEACTIVATE_WARNING } from '../../utils/policyMessages'
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

// F8 carry-over (F7 OQ-6) — "Số nơi đang gán" between Status and "⋯", exact
// ASCII order UI_UX_design.md §7.1 draws (Name │ Type │ Status │ Số nơi
// đang gán │ ⋯). Plain value, no `cellClass` (same as Group's
// `devices_count` — not a number that needs `tabular-nums` emphasis).
const columns: DataTableColumn<Policy>[] = [
  { key: 'name', label: 'Name', value: (row) => row.name },
  { key: 'type', label: 'Type', value: (row) => row.type },
  { key: 'status', label: 'Status' },
  { key: 'assignments_count', label: 'Số nơi đang gán', value: (row) => String(row.assignments_count) },
  { key: 'actions', label: '', cellClass: 'actions-cell' },
]

function viewDetail(policy: Policy) {
  router.push(`/policies/${policy.id}`)
}

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

/** F8 — policy awaiting the deactivate-with-assignments confirm (§2.1.1); `null` means the dialog is not mounted. */
const pendingDeactivate = ref<Policy | null>(null)

async function toggleStatus(policy: Policy) {
  if (isToggling(policy.id)) return
  const nextStatus: PolicyStatus = policy.status === 'active' ? 'inactive' : 'active'
  // A20/A21/A22: only deactivating (active -> inactive) with N > 0 needs a
  // second look. Activating back (A22) never does — nothing is at risk.
  if (nextStatus === 'inactive' && policy.assignments_count > 0) {
    pendingDeactivate.value = policy
    return
  }
  await doToggleStatus(policy, nextStatus)
}

async function doToggleStatus(policy: Policy, nextStatus: PolicyStatus) {
  togglingIds.value = [...togglingIds.value, policy.id]
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

async function confirmDeactivate() {
  const policy = pendingDeactivate.value
  if (!policy) return
  pendingDeactivate.value = null
  await doToggleStatus(policy, 'inactive')
}

/**
 * F8 reopens "Xem chi tiết" as the 3rd item (A28, F7-frontend.md §0 had
 * deliberately left it out — no detail page existed yet). Same order Group
 * settled on: edit, the action-specific one, view last.
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
    {
      key: 'view',
      label: 'Xem chi tiết',
      onClick: () => viewDetail(policy),
      testId: 'policy-action-view',
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
      <!-- F8 — the row is now clickable, same pattern GroupListView adopted
           when `/groups/:id` was born at F6 (§2.1). -->
      <DataTable
        :columns="columns"
        :rows="store.policies"
        :row-key="(row: Policy) => row.id"
        :loading="store.loading"
        :on-row-click="viewDetail"
        test-id="policies-table"
        row-test-id="policy-row"
      >
        <template #cell-status="{ row }">
          <StatusBadge :status="(row as Policy).status" />
        </template>
        <template #cell-actions="{ row }">
          <!-- Required now the row itself is clickable: without it, opening
               the "⋯" menu would also navigate to the detail page. -->
          <span @click.stop>
            <ActionsMenu :items="rowActions(row as Policy)" />
          </span>
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

  <ConfirmModal
    v-if="pendingDeactivate"
    title="Chuyển Policy sang inactive?"
    :message="DEACTIVATE_WARNING(pendingDeactivate.assignments_count)"
    confirm-label="Chuyển sang inactive"
    :on-confirm="confirmDeactivate"
    test-id="policy-deactivate-confirm"
    confirm-test-id="policy-deactivate-confirm-confirm"
    cancel-test-id="policy-deactivate-confirm-cancel"
    @cancel="pendingDeactivate = null"
  />
</template>
