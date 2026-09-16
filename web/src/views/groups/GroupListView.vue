<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { LocationQueryRaw } from 'vue-router'
import AppShell from '../../components/AppShell.vue'
import SearchInput from '../../components/SearchInput.vue'
import DataTable from '../../components/DataTable.vue'
import PaginationBar from '../../components/PaginationBar.vue'
import EmptyState from '../../components/EmptyState.vue'
import ErrorState from '../../components/ErrorState.vue'
import GroupFormModal from '../../components/GroupFormModal.vue'
import ConfirmModal from '../../components/ConfirmModal.vue'
import ActionsMenu from '../../components/ActionsMenu.vue'
import type { ActionsMenuItem } from '../../components/ActionsMenu.vue'
import { useGroupsStore } from '../../stores/groups'
import { useToastStore } from '../../stores/toast'
import { isNotFoundError } from '../../utils/apiError'
import { firstQueryValue } from '../../utils/queryParams'
import type { Group, GroupQueryParams } from '../../types/group'
import type { DataTableColumn } from '../../types/ui'

const route = useRoute()
const router = useRouter()
const store = useGroupsStore()
const toastStore = useToastStore()

const DELETE_SUCCESS_MESSAGE = 'Đã xóa group'
const GROUP_MISSING_MESSAGE = 'Group không tồn tại hoặc đã bị xóa'
const DELETE_FAILED_MESSAGE = 'Không xóa được group, vui lòng thử lại.'

/**
 * The URL is the single source of truth for "what is being shown"
 * (docs/design/F5-frontend.md §3.4): every render and every fetch reads from
 * here, and every interaction writes back with router.replace — so a reload
 * or a shared `/groups?q=sales&page=3` link always agrees with the table.
 * A hand-edited junk `page` is sanitized to 1 here rather than sent to the
 * API, same rule as the Devices list.
 */
const activeQuery = computed<GroupQueryParams>(() => {
  const parsedPage = Number(firstQueryValue(route.query.page))
  const page = Number.isInteger(parsedPage) && parsedPage >= 1 ? parsedPage : 1
  const q = (firstQueryValue(route.query.q) ?? '').trim()
  return { q: q || undefined, page }
})

const searchTerm = computed(() => activeQuery.value.q ?? '')

const columns: DataTableColumn<Group>[] = [
  { key: 'name', label: 'Name', value: (row) => row.name },
  { key: 'description', label: 'Description' },
  // Restored at F6 — F5 left it out only because the API had no
  // `devices_count` yet (SoT F5 OQ-4); it now comes with every group.
  { key: 'devices_count', label: 'Số device', value: (row) => String(row.devices_count) },
  { key: 'actions', label: '', cellClass: 'actions-cell' },
]

// ---------- Create/edit modal ----------
const showModal = ref(false)
const modalMode = ref<'create' | 'edit'>('create')
const modalGroup = ref<Group | null>(null)

function openCreateModal() {
  modalMode.value = 'create'
  modalGroup.value = null
  showModal.value = true
}

function openEditModal(group: Group) {
  modalMode.value = 'edit'
  modalGroup.value = group
  showModal.value = true
}

function closeModal() {
  showModal.value = false
}

// ---------- Delete confirmation ----------
/** The row awaiting confirmation; `null` means the dialog is not mounted at all. */
const confirmTarget = ref<Group | null>(null)

const confirmMessage = computed(() =>
  confirmTarget.value
    ? `Xóa group "${confirmTarget.value.name}" sẽ gỡ toàn bộ liên kết với ${confirmTarget.value.devices_count} device và policy đang gán cho group này. Thiết bị và policy không bị xóa. Hành động không thể hoàn tác.`
    : '',
)

function openDeleteConfirm(group: Group) {
  confirmTarget.value = group
}

function closeDeleteConfirm() {
  confirmTarget.value = null
}

/**
 * Outcome handling is per status code, not per message body: a 500's body
 * must never be shown to the user (SoT F5 §7 / A13).
 *   204 -> close, toast, refetch (the row disappears only now — no
 *          optimistic delete)
 *   404 -> close (retrying is pointless), toast, refetch so the ghost row
 *          goes away (A12)
 *   else -> keep the dialog open so the user can retry, toast, and do NOT
 *          refetch: the row genuinely still exists (A13)
 */
async function handleDeleteConfirm() {
  const target = confirmTarget.value
  if (!target) return
  try {
    await store.deleteGroup(target.id)
    closeDeleteConfirm()
    toastStore.push(DELETE_SUCCESS_MESSAGE)
    load()
  } catch (error) {
    if (isNotFoundError(error)) {
      closeDeleteConfirm()
      toastStore.push(GROUP_MISSING_MESSAGE, 'error')
      load()
      return
    }
    toastStore.push(DELETE_FAILED_MESSAGE, 'error')
  }
}

/** Row navigation to Group Detail — added at F6 with the `/groups/:id` route. */
function viewDetail(group: Group) {
  router.push(`/groups/${group.id}`)
}

/** Three items since F6 — "Xem chi tiết" came back with the detail page. Nothing disabled. */
function rowActions(group: Group): ActionsMenuItem[] {
  return [
    { key: 'edit', label: 'Sửa', onClick: () => openEditModal(group), testId: 'group-action-edit' },
    {
      key: 'delete',
      label: 'Xóa',
      onClick: () => openDeleteConfirm(group),
      testId: 'group-action-delete',
    },
    { key: 'view', label: 'Xem chi tiết', onClick: () => viewDetail(group), testId: 'group-action-view' },
  ]
}

function onSaved(payload: { mode: 'create' | 'edit'; message: string }) {
  closeModal()
  toastStore.push(payload.message)
  if (payload.mode === 'create') {
    // Back to page 1 (keeping the search term) so the newest group — first
    // under `created_at DESC` — is actually on screen. Off page 1, dropping
    // `page` changes the URL and the `watch(activeQuery, ...)` below already
    // reloads for us — calling `load()` too would fire a second, redundant
    // GET for one create. Only page 1 needs the explicit call, since there
    // `replaceQuery` is a same-query no-op that the watcher won't see.
    const wasOnFirstPage = activeQuery.value.page === 1
    replaceQuery({ q: activeQuery.value.q })
    if (wasOnFirstPage) load()
    return
  }
  load()
}

/** Edit hit a 404: the group was deleted by someone else (A12). */
function onMissing() {
  closeModal()
  toastStore.push(GROUP_MISSING_MESSAGE, 'error')
  load()
}

// Empty only once a response has actually come back — before that the table
// shows skeleton rows, not "no groups" (UI_UX_design.md §9).
const showEmptyState = computed(
  () => !store.loading && store.meta !== null && store.meta.total_count === 0,
)

// The two empty variants are told apart by the FE's own `q`: the API
// deliberately returns an identical body for "org has no groups" and
// "search matched nothing" (F5-api.md §3). The A14 variant carries the only
// "+ Thêm Group" button on the page, so the list-head one hides while it is
// up (never two elements with the same testid).
const showEmptyStateNoGroups = computed(() => showEmptyState.value && !activeQuery.value.q)

function load() {
  return store.fetchGroups(activeQuery.value)
}

function replaceQuery(query: LocationQueryRaw) {
  router.replace({ query })
}

/** Changing the search term always resets to page 1 (SoT F5 §5.1) — the page key is simply dropped. */
function onSearchChange(value: string) {
  replaceQuery({ q: value || undefined })
}

function onSearchClear() {
  replaceQuery({})
}

/** Changing the page always keeps the current search term. */
function onPageChange(page: number) {
  replaceQuery({
    q: activeQuery.value.q,
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

// Remembers "where the list was" so Group Detail's "◀ Quay lại danh sách"
// restores the exact search/page (same mechanism DeviceListView has for F4).
watch(
  () => route.fullPath,
  (fullPath) => {
    store.lastListLocation = fullPath
  },
  { immediate: true },
)

// A page past the end of the result set would show a confusing blank table
// while data does exist — walk back instead. The second branch is what
// makes "delete the last row of page 2" land on a real page: when
// everything is gone `total_pages` is 0, so the first formula would sit
// still and leave a blank page behind (F5-frontend.md §3.4).
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
      <h3>Groups</h3>
      <button
        v-if="!showEmptyStateNoGroups"
        type="button"
        class="btn btn-primary"
        data-testid="add-group-button"
        @click="openCreateModal"
      >
        + Thêm Group
      </button>
    </div>

    <!-- Always visible, in every state — including while the table is in
         error (SoT F5 §7). -->
    <SearchInput
      :model-value="searchTerm"
      placeholder="Tìm theo tên group..."
      test-id="group-search-input"
      clear-test-id="search-clear-button"
      @change="onSearchChange"
      @clear="onSearchClear"
    />

    <ErrorState v-if="store.error" :message="store.error" @retry="load" />

    <EmptyState
      v-else-if="showEmptyState && activeQuery.q"
      title="Không tìm thấy group nào"
      description="Thử từ khóa khác hoặc xóa tìm kiếm."
    >
      <button
        type="button"
        class="btn btn-secondary"
        data-testid="empty-state-clear-search-button"
        @click="onSearchClear"
      >
        Xóa tìm kiếm
      </button>
    </EmptyState>

    <EmptyState
      v-else-if="showEmptyState"
      title="Chưa có group nào"
      description="Organization này chưa có Group nào."
    >
      <button type="button" class="btn btn-primary" data-testid="add-group-button" @click="openCreateModal">
        + Thêm Group
      </button>
    </EmptyState>

    <template v-else>
      <DataTable
        :columns="columns"
        :rows="store.groups"
        :row-key="(row: Group) => row.id"
        :loading="store.loading"
        :on-row-click="viewDetail"
        test-id="groups-table"
        row-test-id="group-row"
      >
        <template #cell-description="{ row }">
          <span class="cell-truncate" :title="(row as Group).description ?? undefined">
            {{ (row as Group).description ?? '—' }}
          </span>
        </template>
        <template #cell-actions="{ row }">
          <!-- Required now the row itself is clickable: without it, opening
               the "⋯" menu would also navigate to the detail page. -->
          <span @click.stop>
            <ActionsMenu :items="rowActions(row as Group)" />
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

  <GroupFormModal
    v-if="showModal"
    :mode="modalMode"
    :group="modalGroup"
    @saved="onSaved"
    @missing="onMissing"
    @cancel="closeModal"
  />

  <ConfirmModal
    v-if="confirmTarget"
    title="Xóa group?"
    :message="confirmMessage"
    confirm-label="Xóa"
    destructive
    :on-confirm="handleDeleteConfirm"
    test-id="confirm-modal"
    confirm-test-id="confirm-modal-confirm"
    cancel-test-id="confirm-modal-cancel"
    @cancel="closeDeleteConfirm"
  />
</template>
