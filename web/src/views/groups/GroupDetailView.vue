<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { LocationQueryRaw } from 'vue-router'
import AppShell from '../../components/AppShell.vue'
import FilterBar from '../../components/FilterBar.vue'
import DataTable from '../../components/DataTable.vue'
import PaginationBar from '../../components/PaginationBar.vue'
import StatusBadge from '../../components/StatusBadge.vue'
import EmptyState from '../../components/EmptyState.vue'
import ErrorState from '../../components/ErrorState.vue'
import GroupFormModal from '../../components/GroupFormModal.vue'
import ConfirmModal from '../../components/ConfirmModal.vue'
import GroupMemberAddModal from '../../components/GroupMemberAddModal.vue'
import GroupPolicyAssignModal from '../../components/GroupPolicyAssignModal.vue'
import { useGroupsStore } from '../../stores/groups'
import { useGroupMembershipsStore } from '../../stores/group-memberships'
import { usePolicyAssignmentsStore } from '../../stores/policyAssignments'
import { useJobsStore } from '../../stores/jobs'
import { useToastStore } from '../../stores/toast'
import { fetchGroup } from '../../api/groups'
import { extractErrorMessage, isNotFoundError } from '../../utils/apiError'
import { firstQueryValue } from '../../utils/queryParams'
import {
  DEVICE_PLATFORMS,
  DEVICE_STATUSES,
  isDevicePlatform,
  isDeviceStatus,
  type Device,
} from '../../types/device'
import type { Group, GroupDevicesQueryParams } from '../../types/group'
import type { PolicySummary } from '../../types/policyAssignment'
import type { PolicyAssignmentJob } from '../../types/policyAssignmentJob'
import type { DataTableColumn, FilterDefinition } from '../../types/ui'

/**
 * Group Detail — docs/design/F6-frontend.md §2.1/§2.2, tab Policies dựng
 * thật ở F8 (docs/design/F8-frontend.md §2.4).
 *
 * Independent data sources on one screen: the header (one group, fetched
 * straight into a local `ref` — a single record needs no global store, same
 * call F4 made for `DeviceDetailView`), the "Thành viên" tab
 * (`stores/group-memberships.ts`) and the "Policies" tab
 * (`stores/policyAssignments.ts`'s `groupPolicies` slice). They load
 * independently and fail independently: a broken tab must not hide the
 * group's name, and a broken header must not hide either tab (A28).
 */

const route = useRoute()
const router = useRouter()
const groupsStore = useGroupsStore()
const membershipsStore = useGroupMembershipsStore()
const policyAssignmentsStore = usePolicyAssignmentsStore()
const jobsStore = useJobsStore()
const toastStore = useToastStore()

const HEADER_LOAD_ERROR = 'Không tải được thông tin group.'
const GROUP_MISSING_MESSAGE = 'Group không tồn tại hoặc đã bị xóa'
const DELETE_SUCCESS_MESSAGE = 'Đã xóa group'
const DELETE_FAILED_MESSAGE = 'Không xóa được group, vui lòng thử lại.'
const REMOVE_SUCCESS_MESSAGE = 'Đã gỡ thiết bị khỏi group'
const REMOVE_FAILED_MESSAGE = 'Không gỡ được thiết bị, vui lòng thử lại.'
const MEMBERSHIP_MISSING_MESSAGE = 'Thiết bị không còn là thành viên của group này.'
const REMOVE_POLICY_SUCCESS_MESSAGE = 'Đã gỡ policy'
const REMOVE_POLICY_FAILED_MESSAGE = 'Không gỡ được policy, vui lòng thử lại.'

// ---------- Header ----------
const group = ref<Group | null>(null)
const headerLoading = ref(true)
const headerNotFound = ref(false)
const headerError = ref<string | null>(null)

const groupId = computed(() => Number(route.params.id))
const backLocation = computed(() => groupsStore.lastListLocation ?? '/groups')

async function loadHeader(): Promise<void> {
  headerLoading.value = true
  headerError.value = null
  try {
    const response = await fetchGroup(route.params.id as string)
    group.value = response.group
    headerNotFound.value = false
  } catch (error) {
    if (isNotFoundError(error)) {
      headerNotFound.value = true
    } else {
      headerError.value = extractErrorMessage(error, HEADER_LOAD_ERROR)
    }
  } finally {
    headerLoading.value = false
  }
}

// Watches the param (not onMounted) so navigating straight from one group's
// page to another's re-fetches instead of showing the previous group.
watch(() => route.params.id, loadHeader, { immediate: true })

// ---------- Members tab: the URL is the single source of truth ----------
/**
 * Same formula as `DeviceListView`/`GroupListView` — hand-edited junk is
 * sanitized here rather than sent to the API. A `tab=` key is read by
 * nobody on purpose: F6 has exactly one working tab, and an unknown value
 * must not break the page (F6-frontend.md §2.2).
 */
const activeQuery = computed<GroupDevicesQueryParams>(() => {
  const parsedPage = Number(firstQueryValue(route.query.page))
  const page = Number.isInteger(parsedPage) && parsedPage >= 1 ? parsedPage : 1
  const rawPlatform = firstQueryValue(route.query.platform)
  const rawStatus = firstQueryValue(route.query.status)
  return {
    page,
    platform: isDevicePlatform(rawPlatform) ? rawPlatform : undefined,
    status: isDeviceStatus(rawStatus) ? rawStatus : undefined,
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

/** Four data columns only (SoT F6 §4A bước 4) — no OS Version/Last seen, unlike the Devices list. */
const columns: DataTableColumn<Device>[] = [
  { key: 'identifier', label: 'Identifier', cellClass: 'mono', value: (row) => row.identifier },
  { key: 'name', label: 'Name', value: (row) => row.name },
  { key: 'platform', label: 'Platform', value: (row) => row.platform },
  { key: 'status', label: 'Status' },
  { key: 'actions', label: '', cellClass: 'actions-cell' },
]

function loadMembers(): Promise<void> {
  // A group that answered 404 for its header will answer 404 for its members
  // too — the page has already switched to "Không tìm thấy Group", so this
  // would only add a round-trip nobody reads (F6-frontend.md §5).
  if (headerNotFound.value) return Promise.resolve()
  return membershipsStore.fetchMembers(groupId.value, activeQuery.value)
}

watch(activeQuery, () => loadMembers(), { immediate: true })

function replaceQuery(query: LocationQueryRaw) {
  router.replace({ query })
}

/** Changing a filter always resets to page 1 — the page key is simply dropped. */
function onFilterChange(values: Record<string, string>) {
  replaceQuery({
    platform: values.platform || undefined,
    status: values.status || undefined,
  })
}

function onClearFilters() {
  replaceQuery({})
}

/** Changing the page always keeps the current filter. */
function onPageChange(page: number) {
  replaceQuery({
    platform: activeQuery.value.platform,
    status: activeQuery.value.status,
    page: page === 1 ? undefined : String(page),
  })
}

// Walking back off a page that no longer exists — the second branch is what
// rescues "removed the last member of page 2" (F5-frontend.md §3.4).
watch(
  () => membershipsStore.meta,
  (meta) => {
    if (!meta) return
    if (meta.total_pages > 0 && activeQuery.value.page > meta.total_pages) {
      onPageChange(meta.total_pages)
    } else if (meta.total_count === 0 && activeQuery.value.page > 1) {
      onPageChange(1)
    }
  },
)

function viewDevice(device: Device) {
  router.push(`/devices/${device.id}`)
}

// Empty only once a response has actually come back — before that the table
// shows skeleton rows, not "no members" (UI_UX_design.md §9).
const showEmptyState = computed(
  () =>
    !membershipsStore.loading &&
    membershipsStore.meta !== null &&
    membershipsStore.meta.total_count === 0,
)
/** A19: the group is genuinely empty — the only variant that carries the "+ Thêm device" CTA. */
const showEmptyStateNoMembers = computed(() => showEmptyState.value && !hasActiveFilter.value)

// ---------- Header: edit / delete ----------
const showEditModal = ref(false)
const showDeleteConfirm = ref(false)

const deleteMessage = computed(() =>
  group.value
    ? `Xóa group "${group.value.name}" sẽ gỡ toàn bộ liên kết với ${group.value.devices_count} device và policy đang gán cho group này. Thiết bị và policy không bị xóa. Hành động không thể hoàn tác.`
    : '',
)

function onGroupSaved(payload: { mode: 'create' | 'edit'; message: string }) {
  showEditModal.value = false
  toastStore.push(payload.message)
  loadHeader()
}

/** The group was deleted by someone else while its own detail page was open. */
function onGroupMissing() {
  showEditModal.value = false
  toastStore.push(GROUP_MISSING_MESSAGE, 'error')
  headerNotFound.value = true
}

async function handleDeleteGroup() {
  try {
    await groupsStore.deleteGroup(groupId.value)
    showDeleteConfirm.value = false
    toastStore.push(DELETE_SUCCESS_MESSAGE)
    router.push(backLocation.value)
  } catch (error) {
    if (isNotFoundError(error)) {
      showDeleteConfirm.value = false
      toastStore.push(GROUP_MISSING_MESSAGE, 'error')
      router.push(backLocation.value)
      return
    }
    // Keep the dialog open so the user can retry (same rule as F5 A13).
    toastStore.push(DELETE_FAILED_MESSAGE, 'error')
  }
}

// ---------- Members: inline remove ----------
/** Row currently asking "Gỡ khỏi group?" — inline, never a full modal (SoT F6 §4C bước 1). */
const confirmRemoveId = ref<number | null>(null)
/** Row whose DELETE is in flight — disables the button so a double click cannot send twice. */
const removingId = ref<number | null>(null)

function askRemove(device: Device) {
  confirmRemoveId.value = device.id
}

function cancelRemove() {
  confirmRemoveId.value = null
}

async function confirmRemove(device: Device) {
  if (removingId.value !== null) return
  removingId.value = device.id
  try {
    await membershipsStore.removeMember(groupId.value, device.id)
    confirmRemoveId.value = null
    toastStore.push(REMOVE_SUCCESS_MESSAGE)
    // The header is refetched too — `devices_count` is never adjusted by
    // hand on the client (UI_UX_design.md §0.3).
    await Promise.all([loadHeader(), loadMembers()])
  } catch (error) {
    confirmRemoveId.value = null
    if (isNotFoundError(error)) {
      toastStore.push(MEMBERSHIP_MISSING_MESSAGE, 'error')
      // Refetching the header as well is deliberate: if the cause was the
      // whole group being deleted, `loadHeader()` 404s and the page switches
      // to "Không tìm thấy Group" on its own.
      await Promise.all([loadHeader(), loadMembers()])
      return
    }
    if (isValidationError(error)) {
      // 422 = the device is retired (A9). The row genuinely is still a
      // member, so nothing is refetched — the table already shows the truth.
      toastStore.push(extractErrorMessage(error, REMOVE_FAILED_MESSAGE), 'error')
      return
    }
    toastStore.push(REMOVE_FAILED_MESSAGE, 'error')
  } finally {
    removingId.value = null
  }
}

function isValidationError(error: unknown): boolean {
  return (error as { response?: { status?: number } } | undefined)?.response?.status === 422
}

// ---------- Members: add ----------
const showAddModal = ref(false)

function onMembersAdded(payload: { addedCount: number; devicesCount: number }) {
  showAddModal.value = false
  toastStore.push(`Đã thêm ${payload.addedCount} thiết bị vào group`)
  // Back to page 1 so the newest members are actually on screen. Off page 1,
  // dropping `page` already re-triggers `watch(activeQuery, ...)` — calling
  // `loadMembers()` too would fire a second, redundant GET (same reasoning
  // as GroupListView's create flow).
  const wasOnFirstPage = activeQuery.value.page === 1
  replaceQuery({ platform: activeQuery.value.platform, status: activeQuery.value.status })
  loadHeader()
  if (wasOnFirstPage) loadMembers()
}

// ---------- Policies tab (F8) ----------
/** Local state, not synced to the URL (OQ-FE-1, F8-frontend.md §5). */
const activeTab = ref<'members' | 'policies'>('members')
const groupPoliciesLoadedOnce = ref(false)

function loadGroupPolicies(): Promise<void> {
  return policyAssignmentsStore.fetchGroupPolicies(groupId.value, { page: 1 })
}

function selectTab(tab: 'members' | 'policies') {
  activeTab.value = tab
  if (tab === 'policies' && !groupPoliciesLoadedOnce.value) {
    groupPoliciesLoadedOnce.value = true
    loadGroupPolicies()
  }
}

const policyColumns: DataTableColumn<PolicySummary>[] = [
  { key: 'name', label: 'Name', value: (row) => row.name },
  { key: 'type', label: 'Type', value: (row) => row.type },
  { key: 'status', label: 'Status' },
  { key: 'actions', label: '', cellClass: 'actions-cell' },
]

const showPoliciesEmpty = computed(
  () =>
    !policyAssignmentsStore.groupPolicies.loading &&
    policyAssignmentsStore.groupPolicies.meta !== null &&
    policyAssignmentsStore.groupPolicies.meta.total_count === 0,
)

const assignedPolicyIds = computed(() => policyAssignmentsStore.groupPolicies.items.map((p) => p.id))

// A17/§6.3 point 6 — re-attach runs on mount regardless of which tab is
// active, so a banner reappears even while the user is looking at
// "Thành viên".
onMounted(() => {
  jobsStore.reattachForGroup(groupId.value)
})

// ---------- Policies: assign ----------
const showPolicyAssignModal = ref(false)

function onPolicyAssigned(job: PolicyAssignmentJob) {
  showPolicyAssignModal.value = false
  jobsStore.track(job)
  // No toast (§2.5.1/§4): 202 means the assignment isn't real yet — the job
  // banner (global, mounted in AppShell) is the feedback for this step.
}

// ---------- Policies: remove ----------
const confirmRemovePolicy = ref<PolicySummary | null>(null)

const removePolicyMessage = computed(() =>
  confirmRemovePolicy.value && group.value
    ? `Gỡ policy "${confirmRemovePolicy.value.name}" khỏi group "${group.value.name}"? Thiết bị trong ` +
      `group sẽ không còn nhận policy này qua group (không ảnh hưởng policy gán trực tiếp cho từng device).`
    : '',
)

async function handleRemovePolicy() {
  const target = confirmRemovePolicy.value
  if (!target) return
  try {
    await policyAssignmentsStore.unassignPolicyFromGroup(groupId.value, target.id)
    confirmRemovePolicy.value = null
    toastStore.push(REMOVE_POLICY_SUCCESS_MESSAGE)
    await loadGroupPolicies()
  } catch (error) {
    confirmRemovePolicy.value = null
    toastStore.push(extractErrorMessage(error, REMOVE_POLICY_FAILED_MESSAGE), 'error')
  }
}

/**
 * Refetch when a job for THIS group just finished — Phương án A only writes
 * the real `policy_assignments` row while the job is `running`, so the tab
 * is not accurate right after the `202` (F8-frontend.md §2.4).
 */
const seenDoneJobIds = new Set<number>()
watch(
  () => jobsStore.jobs,
  (jobs) => {
    const justDone = jobs.filter(
      (j) => j.status === 'done' && j.group?.id === groupId.value && !seenDoneJobIds.has(j.id),
    )
    justDone.forEach((j) => seenDoneJobIds.add(j.id))
    if (justDone.length === 0) return
    if (activeTab.value === 'policies') loadGroupPolicies()
    else groupPoliciesLoadedOnce.value = false // not active -> force a reload next time the tab is opened
  },
  { deep: true },
)
</script>

<template>
  <AppShell>
    <template v-if="headerNotFound">
      <EmptyState
        title="Không tìm thấy Group"
        description="Group này không tồn tại hoặc bạn không có quyền xem."
      >
        <RouterLink :to="backLocation" class="btn btn-secondary" data-testid="group-detail-back-link">
          ◀ Quay lại danh sách
        </RouterLink>
      </EmptyState>
    </template>

    <template v-else>
      <RouterLink :to="backLocation" class="detail-back" data-testid="group-detail-back-link">
        ◀ Quay lại danh sách
      </RouterLink>

      <!-- Header block. Its error state stays inside this block: the members
           tab below keeps working (A28). -->
      <ErrorState v-if="headerError" :message="headerError" @retry="loadHeader" />

      <div v-else-if="headerLoading" class="detail-header">
        <div style="width: 100%">
          <span class="skeleton-cell" style="width: 180px; height: 16px; display: block; margin-bottom: 10px"></span>
          <span class="skeleton-cell" style="width: 320px; height: 12px; display: block"></span>
        </div>
      </div>

      <div v-else-if="group" class="detail-header">
        <div>
          <div class="id-row" style="font-family: var(--font-display)">
            <span data-testid="group-detail-name">{{ group.name }}</span>
          </div>
          <div class="meta-row">
            <span data-testid="group-detail-description">
              {{ group.description ?? 'Không có mô tả' }}
            </span>
          </div>
        </div>
        <div style="display: flex; gap: 8px; flex: none">
          <button
            type="button"
            class="btn btn-secondary"
            data-testid="group-detail-edit-button"
            @click="showEditModal = true"
          >
            Sửa
          </button>
          <button
            type="button"
            class="btn btn-secondary"
            data-testid="group-detail-delete-button"
            @click="showDeleteConfirm = true"
          >
            Xóa
          </button>
        </div>
      </div>

      <!-- F8 — both are now real <button>s, and "Policies" has real content (§2.4). -->
      <div class="tabs">
        <button
          type="button"
          class="tab-item"
          :class="{ active: activeTab === 'members' }"
          data-testid="group-detail-members-tab"
          @click="selectTab('members')"
        >
          Thành viên ({{ group ? group.devices_count : '…' }})
        </button>
        <button
          type="button"
          class="tab-item"
          :class="{ active: activeTab === 'policies' }"
          data-testid="group-detail-policies-tab"
          @click="selectTab('policies')"
        >
          Policies
        </button>
      </div>

      <!-- Tab: Thành viên -->
      <template v-if="activeTab === 'members'">
        <FilterBar
          :filters="filters"
          :model-value="filterValues"
          @change="onFilterChange"
          @clear="onClearFilters"
        />

        <div class="list-head" style="margin-bottom: 10px">
          <span></span>
          <!-- Hidden while A19's empty state shows its own CTA, so there is
               never a second element with this testid. -->
          <button
            v-if="!showEmptyStateNoMembers"
            type="button"
            class="btn btn-primary"
            data-testid="add-devices-button"
            @click="showAddModal = true"
          >
            + Thêm device vào group
          </button>
        </div>

        <ErrorState
          v-if="membershipsStore.error"
          :message="membershipsStore.error"
          @retry="loadMembers"
        />

        <EmptyState
          v-else-if="showEmptyState && hasActiveFilter"
          title="Không tìm thấy thiết bị"
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
          title="Group chưa có thiết bị nào"
          description="Thêm device vào group để bắt đầu quản lý theo nhóm."
        >
          <button
            type="button"
            class="btn btn-primary"
            data-testid="add-devices-button"
            @click="showAddModal = true"
          >
            + Thêm device vào group
          </button>
        </EmptyState>

        <template v-else>
          <DataTable
            :columns="columns"
            :rows="membershipsStore.members"
            :row-key="(row: Device) => row.id"
            :loading="membershipsStore.loading"
            :on-row-click="viewDevice"
            test-id="group-members-table"
            row-test-id="group-member-row"
          >
            <template #cell-status="{ row }">
              <StatusBadge :status="(row as Device).status" />
            </template>
            <template #cell-actions="{ row }">
              <span @click.stop>
                <span v-if="confirmRemoveId === (row as Device).id" class="inline-confirm">
                  <span>Gỡ khỏi group?</span>
                  <button
                    type="button"
                    class="btn btn-danger btn-sm"
                    data-testid="group-member-remove-confirm"
                    :disabled="removingId === (row as Device).id"
                    :data-busy="removingId === (row as Device).id"
                    @click="confirmRemove(row as Device)"
                  >
                    <span class="btn-label">Có, gỡ</span>
                    <span class="spinner" aria-hidden="true"></span>
                  </button>
                  <button
                    type="button"
                    class="btn btn-secondary btn-sm"
                    data-testid="group-member-remove-cancel"
                    :disabled="removingId === (row as Device).id"
                    @click="cancelRemove"
                  >
                    Hủy
                  </button>
                </span>
                <button
                  v-else
                  type="button"
                  class="btn btn-secondary btn-sm"
                  data-testid="group-member-remove-button"
                  @click="askRemove(row as Device)"
                >
                  Gỡ khỏi group
                </button>
              </span>
            </template>
          </DataTable>

          <PaginationBar
            v-if="membershipsStore.meta"
            :current-page="membershipsStore.meta.current_page"
            :per-page="membershipsStore.meta.per_page"
            :total-count="membershipsStore.meta.total_count"
            :total-pages="membershipsStore.meta.total_pages"
            :loading="membershipsStore.loading"
            @change="onPageChange"
          />
        </template>
      </template>

      <!-- Tab: Policies (F8) -->
      <template v-else>
        <div class="list-head" style="margin-bottom: 10px">
          <span></span>
          <button
            v-if="!showPoliciesEmpty"
            type="button"
            class="btn btn-primary"
            data-testid="group-policy-assign-button"
            @click="showPolicyAssignModal = true"
          >
            + Gán policy
          </button>
        </div>

        <ErrorState
          v-if="policyAssignmentsStore.groupPolicies.error"
          :message="policyAssignmentsStore.groupPolicies.error"
          @retry="loadGroupPolicies"
        />

        <EmptyState v-else-if="showPoliciesEmpty" title="Group chưa được gán Policy nào.">
          <button
            type="button"
            class="btn btn-primary"
            data-testid="group-policy-assign-button"
            @click="showPolicyAssignModal = true"
          >
            + Gán policy
          </button>
        </EmptyState>

        <DataTable
          v-else
          :columns="policyColumns"
          :rows="policyAssignmentsStore.groupPolicies.items"
          :row-key="(row: PolicySummary) => row.id"
          :loading="policyAssignmentsStore.groupPolicies.loading"
          test-id="group-policies-table"
          row-test-id="group-policy-row"
        >
          <template #cell-status="{ row }">
            <StatusBadge :status="(row as PolicySummary).status" />
          </template>
          <template #cell-actions="{ row }">
            <button
              type="button"
              class="btn btn-secondary btn-sm"
              data-testid="group-policy-remove-button"
              @click="confirmRemovePolicy = row as PolicySummary"
            >
              Gỡ
            </button>
          </template>
        </DataTable>
      </template>
    </template>
  </AppShell>

  <GroupFormModal
    v-if="showEditModal && group"
    mode="edit"
    :group="group"
    @saved="onGroupSaved"
    @missing="onGroupMissing"
    @cancel="showEditModal = false"
  />

  <ConfirmModal
    v-if="showDeleteConfirm && group"
    title="Xóa group?"
    :message="deleteMessage"
    confirm-label="Xóa"
    destructive
    :on-confirm="handleDeleteGroup"
    test-id="confirm-modal"
    confirm-test-id="confirm-modal-confirm"
    cancel-test-id="confirm-modal-cancel"
    @cancel="showDeleteConfirm = false"
  />

  <GroupMemberAddModal
    v-if="showAddModal"
    :group-id="groupId"
    @added="onMembersAdded"
    @cancel="showAddModal = false"
  />

  <GroupPolicyAssignModal
    v-if="showPolicyAssignModal"
    :group-id="groupId"
    :assigned-policy-ids="assignedPolicyIds"
    @assigned="onPolicyAssigned"
    @cancel="showPolicyAssignModal = false"
  />

  <ConfirmModal
    v-if="confirmRemovePolicy"
    title="Gỡ policy khỏi group?"
    :message="removePolicyMessage"
    confirm-label="Gỡ"
    :on-confirm="handleRemovePolicy"
    test-id="confirm-modal"
    confirm-test-id="confirm-modal-confirm"
    cancel-test-id="confirm-modal-cancel"
    @cancel="confirmRemovePolicy = null"
  />
</template>
