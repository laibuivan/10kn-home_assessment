<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import AppShell from '../../components/AppShell.vue'
import DataTable from '../../components/DataTable.vue'
import EmptyState from '../../components/EmptyState.vue'
import ErrorState from '../../components/ErrorState.vue'
import StatusBadge from '../../components/StatusBadge.vue'
import ConfirmModal from '../../components/ConfirmModal.vue'
import PolicyFormModal from '../../components/PolicyFormModal.vue'
import PolicyGroupAssignModal from '../../components/PolicyGroupAssignModal.vue'
import PolicyDeviceAssignModal from '../../components/PolicyDeviceAssignModal.vue'
import { usePolicyAssignmentsStore } from '../../stores/policyAssignments'
import { useJobsStore } from '../../stores/jobs'
import { useToastStore } from '../../stores/toast'
import { fetchPolicy } from '../../api/policies'
import { extractErrorMessage, isNotFoundError } from '../../utils/apiError'
import type { Policy } from '../../types/policy'
import type { GroupSummary } from '../../types/policyAssignment'
import type { PolicyAssignmentJob } from '../../types/policyAssignmentJob'
import type { Device } from '../../types/device'
import type { DataTableColumn } from '../../types/ui'

/**
 * Policy Detail — docs/design/F8-frontend.md §2.2 (F7 OQ-7 carry-over).
 *
 * Header is one record, fetched straight into a local `ref` — same as
 * `GroupDetailView`'s header, no global store for a single record. The 2
 * tabs are backed by `stores/policyAssignments.ts`'s independent `policyGroups`/
 * `policyDevices` slices: Group loads in parallel with the header, Device is
 * lazy — only on the tab's first click (SoT §4-D step 2, avoids 3 requests
 * firing at once for nothing).
 */

const route = useRoute()
const store = usePolicyAssignmentsStore()
const jobsStore = useJobsStore()
const toastStore = useToastStore()

const HEADER_LOAD_ERROR = 'Không tải được thông tin policy.'
const COPY_SUCCESS_MESSAGE = 'Đã copy cấu hình'
const COPY_FAILED_MESSAGE = 'Không copy được, vui lòng thử lại.'
const ASSIGN_DISABLED_TITLE = 'Policy không active, không thể gán.'
const DEVICE_ASSIGN_SUCCESS_MESSAGE = 'Đã gán policy cho device'
const REMOVE_SUCCESS_MESSAGE = 'Đã gỡ policy'
const REMOVE_FAILED_MESSAGE = 'Không gỡ được policy, vui lòng thử lại.'

const policyId = computed(() => Number(route.params.id))

// ---------- Header ----------
const policy = ref<Policy | null>(null)
const headerLoading = ref(true)
const headerNotFound = ref(false)
const headerError = ref<string | null>(null)

async function loadHeader(): Promise<void> {
  headerLoading.value = true
  headerError.value = null
  try {
    const response = await fetchPolicy(route.params.id as string)
    policy.value = response.policy
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

// ---------- Tabs ----------
const activeTab = ref<'group' | 'device'>('group')
const deviceLoadedOnce = ref(false)

function loadGroupTab(): Promise<void> {
  return store.fetchPolicyGroups(policyId.value, { page: 1 })
}

function loadDeviceTab(): Promise<void> {
  return store.fetchPolicyDevices(policyId.value, { page: 1 })
}

function selectTab(tab: 'group' | 'device') {
  activeTab.value = tab
  if (tab === 'device' && !deviceLoadedOnce.value) {
    deviceLoadedOnce.value = true
    loadDeviceTab()
  }
}

// Re-fetch everything when navigating from one policy's page straight to
// another's (watches the param, not onMounted — same reason GroupDetailView
// does).
watch(
  () => route.params.id,
  () => {
    headerNotFound.value = false
    activeTab.value = 'group'
    deviceLoadedOnce.value = false
    loadHeader()
    loadGroupTab()
  },
  { immediate: true },
)

const groupColumns: DataTableColumn<GroupSummary>[] = [
  { key: 'name', label: 'Name', value: (row) => row.name },
  { key: 'actions', label: '', cellClass: 'actions-cell' },
]

const deviceColumns: DataTableColumn<Device>[] = [
  { key: 'identifier', label: 'Identifier', cellClass: 'mono', value: (row) => row.identifier },
  { key: 'name', label: 'Name', value: (row) => row.name },
  { key: 'platform', label: 'Platform', value: (row) => row.platform },
  { key: 'status', label: 'Status' },
  { key: 'actions', label: '', cellClass: 'actions-cell' },
]

const showGroupEmpty = computed(
  () =>
    !store.policyGroups.loading && store.policyGroups.meta !== null && store.policyGroups.meta.total_count === 0,
)
const showDeviceEmpty = computed(
  () =>
    !store.policyDevices.loading &&
    store.policyDevices.meta !== null &&
    store.policyDevices.meta.total_count === 0,
)

const assignDisabled = computed(() => policy.value?.status === 'inactive')

// ---------- Header: edit ----------
const showEditModal = ref(false)

function onPolicySaved(payload: { mode: 'create' | 'edit'; message: string }) {
  showEditModal.value = false
  toastStore.push(payload.message)
  loadHeader()
}

// ---------- Copy configuration ----------
async function copyConfiguration() {
  if (!policy.value) return
  try {
    await navigator.clipboard.writeText(JSON.stringify(policy.value.configuration, null, 2))
    toastStore.push(COPY_SUCCESS_MESSAGE)
  } catch {
    toastStore.push(COPY_FAILED_MESSAGE, 'error')
  }
}

// ---------- Tab Group: assign / remove ----------
const showGroupAssignModal = ref(false)
const assignedGroupIds = computed(() => store.policyGroups.items.map((g) => g.id))

function onGroupAssigned(job: PolicyAssignmentJob) {
  showGroupAssignModal.value = false
  jobsStore.track(job)
  // No toast here (§2.5.1/§4): 202 means the assignment isn't real yet — the
  // job banner (mounted globally in AppShell) is the feedback for this.
}

const confirmRemoveGroup = ref<GroupSummary | null>(null)

const removeGroupMessage = computed(() =>
  confirmRemoveGroup.value && policy.value
    ? `Gỡ policy "${policy.value.name}" khỏi group "${confirmRemoveGroup.value.name}"?`
    : '',
)

async function handleRemoveGroup() {
  const target = confirmRemoveGroup.value
  if (!target || !policy.value) return
  try {
    await store.unassignPolicyFromGroup(target.id, policy.value.id)
    confirmRemoveGroup.value = null
    toastStore.push(REMOVE_SUCCESS_MESSAGE)
    await loadGroupTab()
  } catch (error) {
    confirmRemoveGroup.value = null
    toastStore.push(extractErrorMessage(error, REMOVE_FAILED_MESSAGE), 'error')
  }
}

// ---------- Tab Device: assign / remove ----------
const showDeviceAssignModal = ref(false)

function onDeviceAssigned() {
  showDeviceAssignModal.value = false
  toastStore.push(DEVICE_ASSIGN_SUCCESS_MESSAGE)
  loadDeviceTab()
}

const confirmRemoveDevice = ref<Device | null>(null)

const removeDeviceMessage = computed(() =>
  confirmRemoveDevice.value && policy.value
    ? `Gỡ policy "${policy.value.name}" khỏi device "${confirmRemoveDevice.value.identifier}"?`
    : '',
)

async function handleRemoveDevice() {
  const target = confirmRemoveDevice.value
  if (!target || !policy.value) return
  try {
    await store.unassignDeviceFromPolicy(policy.value.id, target.id)
    confirmRemoveDevice.value = null
    toastStore.push(REMOVE_SUCCESS_MESSAGE)
    await loadDeviceTab()
  } catch (error) {
    confirmRemoveDevice.value = null
    toastStore.push(extractErrorMessage(error, REMOVE_FAILED_MESSAGE), 'error')
  }
}
</script>

<template>
  <AppShell>
    <template v-if="headerNotFound">
      <EmptyState
        title="Không tìm thấy Policy"
        description="Policy này không tồn tại hoặc bạn không có quyền xem."
      >
        <RouterLink to="/policies" class="btn btn-secondary" data-testid="policy-detail-back-link">
          ◀ Quay lại danh sách
        </RouterLink>
      </EmptyState>
    </template>

    <template v-else>
      <RouterLink to="/policies" class="detail-back" data-testid="policy-detail-back-link">
        ◀ Quay lại danh sách
      </RouterLink>

      <!-- Header. Its error state stays inside this block: both tabs below keep working. -->
      <ErrorState v-if="headerError" :message="headerError" @retry="loadHeader" />

      <div v-else-if="headerLoading" class="detail-header">
        <div style="width: 100%">
          <span class="skeleton-cell" style="width: 180px; height: 16px; display: block; margin-bottom: 10px"></span>
          <span class="skeleton-cell" style="width: 320px; height: 12px; display: block"></span>
        </div>
      </div>

      <div v-else-if="policy" class="detail-header">
        <div>
          <div class="id-row" style="font-family: var(--font-display)">
            <span data-testid="policy-detail-name">{{ policy.name }}</span>
            <StatusBadge :status="policy.status" />
          </div>
          <div class="meta-row">
            <span data-testid="policy-detail-type">Type: {{ policy.type }}</span>
          </div>
        </div>
        <div style="display: flex; gap: 8px; flex: none">
          <button
            type="button"
            class="btn btn-secondary"
            data-testid="policy-detail-edit-button"
            @click="showEditModal = true"
          >
            Sửa
          </button>
        </div>
      </div>

      <div v-if="policy" class="detail-block">
        <h4>Cấu hình</h4>
        <pre
          class="code-block"
          data-testid="policy-detail-configuration"
        >{{ JSON.stringify(policy.configuration, null, 2) }}</pre>
        <button
          type="button"
          class="btn btn-secondary btn-sm"
          data-testid="policy-detail-configuration-copy"
          @click="copyConfiguration"
        >
          Copy
        </button>
      </div>

      <div class="tabs">
        <button
          type="button"
          class="tab-item"
          :class="{ active: activeTab === 'group' }"
          data-testid="policy-detail-tab-group"
          @click="selectTab('group')"
        >
          Đang gán cho Group ({{ store.policyGroups.meta?.total_count ?? '…' }})
        </button>
        <button
          type="button"
          class="tab-item"
          :class="{ active: activeTab === 'device' }"
          data-testid="policy-detail-tab-device"
          @click="selectTab('device')"
        >
          Đang gán cho Device ({{ store.policyDevices.meta?.total_count ?? '…' }})
        </button>
      </div>

      <!-- Tab: Group -->
      <template v-if="activeTab === 'group'">
        <div class="list-head" style="margin-bottom: 10px">
          <span></span>
          <button
            v-if="!showGroupEmpty"
            type="button"
            class="btn btn-primary"
            data-testid="policy-group-assign-button"
            :disabled="assignDisabled"
            :title="assignDisabled ? ASSIGN_DISABLED_TITLE : undefined"
            @click="showGroupAssignModal = true"
          >
            Gán thêm cho Group
          </button>
        </div>

        <ErrorState v-if="store.policyGroups.error" :message="store.policyGroups.error" @retry="loadGroupTab" />

        <EmptyState v-else-if="showGroupEmpty" title="Chưa gán cho Group nào.">
          <button
            type="button"
            class="btn btn-primary"
            data-testid="policy-group-assign-button"
            :disabled="assignDisabled"
            :title="assignDisabled ? ASSIGN_DISABLED_TITLE : undefined"
            @click="showGroupAssignModal = true"
          >
            Gán thêm cho Group
          </button>
        </EmptyState>

        <DataTable
          v-else
          :columns="groupColumns"
          :rows="store.policyGroups.items"
          :row-key="(row: GroupSummary) => row.id"
          :loading="store.policyGroups.loading"
          test-id="policy-groups-table"
          row-test-id="policy-group-row"
        >
          <template #cell-actions="{ row }">
            <button
              type="button"
              class="btn btn-secondary btn-sm"
              data-testid="policy-group-remove-button"
              @click="confirmRemoveGroup = row as GroupSummary"
            >
              Gỡ
            </button>
          </template>
        </DataTable>
      </template>

      <!-- Tab: Device -->
      <template v-if="activeTab === 'device'">
        <div class="list-head" style="margin-bottom: 10px">
          <span></span>
          <button
            v-if="!showDeviceEmpty"
            type="button"
            class="btn btn-primary"
            data-testid="policy-device-assign-button"
            :disabled="assignDisabled"
            :title="assignDisabled ? ASSIGN_DISABLED_TITLE : undefined"
            @click="showDeviceAssignModal = true"
          >
            Gán thêm cho Device
          </button>
        </div>

        <ErrorState v-if="store.policyDevices.error" :message="store.policyDevices.error" @retry="loadDeviceTab" />

        <EmptyState v-else-if="showDeviceEmpty" title="Chưa gán trực tiếp cho Device nào.">
          <button
            type="button"
            class="btn btn-primary"
            data-testid="policy-device-assign-button"
            :disabled="assignDisabled"
            :title="assignDisabled ? ASSIGN_DISABLED_TITLE : undefined"
            @click="showDeviceAssignModal = true"
          >
            Gán thêm cho Device
          </button>
        </EmptyState>

        <DataTable
          v-else
          :columns="deviceColumns"
          :rows="store.policyDevices.items"
          :row-key="(row: Device) => row.id"
          :loading="store.policyDevices.loading"
          test-id="policy-devices-table"
          row-test-id="policy-device-row"
        >
          <template #cell-status="{ row }">
            <StatusBadge :status="(row as Device).status" />
          </template>
          <template #cell-actions="{ row }">
            <button
              type="button"
              class="btn btn-secondary btn-sm"
              data-testid="policy-device-remove-button"
              @click="confirmRemoveDevice = row as Device"
            >
              Gỡ
            </button>
          </template>
        </DataTable>
      </template>
    </template>
  </AppShell>

  <PolicyFormModal
    v-if="showEditModal && policy"
    mode="edit"
    :policy="policy"
    @saved="onPolicySaved"
    @cancel="showEditModal = false"
  />

  <PolicyGroupAssignModal
    v-if="showGroupAssignModal && policy"
    :policy-id="policy.id"
    :policy-name="policy.name"
    :assigned-group-ids="assignedGroupIds"
    @assigned="onGroupAssigned"
    @cancel="showGroupAssignModal = false"
  />

  <PolicyDeviceAssignModal
    v-if="showDeviceAssignModal && policy"
    :policy-id="policy.id"
    @assigned="onDeviceAssigned"
    @cancel="showDeviceAssignModal = false"
  />

  <ConfirmModal
    v-if="confirmRemoveGroup"
    title="Gỡ policy khỏi group?"
    :message="removeGroupMessage"
    confirm-label="Gỡ"
    :on-confirm="handleRemoveGroup"
    test-id="confirm-modal"
    confirm-test-id="confirm-modal-confirm"
    cancel-test-id="confirm-modal-cancel"
    @cancel="confirmRemoveGroup = null"
  />

  <ConfirmModal
    v-if="confirmRemoveDevice"
    title="Gỡ policy khỏi device?"
    :message="removeDeviceMessage"
    confirm-label="Gỡ"
    :on-confirm="handleRemoveDevice"
    test-id="confirm-modal"
    confirm-test-id="confirm-modal-confirm"
    cancel-test-id="confirm-modal-cancel"
    @cancel="confirmRemoveDevice = null"
  />
</template>
