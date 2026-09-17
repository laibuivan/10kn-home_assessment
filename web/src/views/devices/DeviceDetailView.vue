<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import AppShell from '../../components/AppShell.vue'
import StatusBadge from '../../components/StatusBadge.vue'
import EmptyState from '../../components/EmptyState.vue'
import ErrorState from '../../components/ErrorState.vue'
import DeviceFormModal from '../../components/DeviceFormModal.vue'
import ConfirmModal from '../../components/ConfirmModal.vue'
import DeviceGroupAddModal from '../../components/DeviceGroupAddModal.vue'
import AppliedPoliciesBlock from '../../components/AppliedPoliciesBlock.vue'
import { useDevicesStore } from '../../stores/devices'
import { useToastStore } from '../../stores/toast'
import { fetchDevice } from '../../api/devices'
import { removeGroupDevice } from '../../api/group-memberships'
import { extractErrorMessage, isNotFoundError } from '../../utils/apiError'
import type { DeviceDetail, DeviceGroupRef } from '../../types/device'

/**
 * Device Detail (docs/design/F4-frontend.md §1–§4). Fetch state is local to
 * this component, not the Pinia store — nothing else on screen needs to read
 * this one device (same reasoning F3 applied to form state).
 *
 * "Groups đang thuộc" became real at F6: `groups` arrives inside the very
 * same `GET /api/v1/devices/:id` response (F6-api.md §2.6), so the block
 * still has no fetch state of its own — it shares this page's
 * loading/error/notFound, and every add/remove simply calls `load()` again.
 * "Policy đang áp dụng" became real at F9: `AppliedPoliciesBlock` mounts
 * once `device` exists and fetches its own data through a separate
 * endpoint, with its own loading/error state independent of this page's
 * (docs/design/F9-frontend.md §3.1).
 */

const route = useRoute()
const store = useDevicesStore()
const toastStore = useToastStore()

const GENERIC_LOAD_ERROR = 'Không tải được thông tin thiết bị.'
const REMOVE_SUCCESS_MESSAGE = 'Đã gỡ thiết bị khỏi group'
const REMOVE_FAILED_MESSAGE = 'Không gỡ được thiết bị, vui lòng thử lại.'
const MEMBERSHIP_MISSING_MESSAGE = 'Thiết bị không còn là thành viên của group này.'
const ADD_SUCCESS_MESSAGE = 'Đã thêm vào group'

const device = ref<DeviceDetail | null>(null)
const loadingDetail = ref(true)
const notFound = ref(false)
const loadError = ref<string | null>(null)

async function load() {
  loadingDetail.value = true
  notFound.value = false
  loadError.value = null
  try {
    const response = await fetchDevice(route.params.id as string)
    device.value = response.device
  } catch (error) {
    if (isNotFoundError(error)) {
      notFound.value = true
    } else {
      loadError.value = extractErrorMessage(error, GENERIC_LOAD_ERROR)
    }
  } finally {
    loadingDetail.value = false
  }
}

// Watches the param (not onMounted) so navigating between two detail pages
// (a future group/policy-source link) re-fetches instead of reusing stale
// data from the previously mounted route.
watch(() => route.params.id, load, { immediate: true })

const backLocation = computed(() => store.lastListLocation ?? '/devices')

// ---------- Edit modal (reuses F3's DeviceFormModal unchanged) ----------
const showModal = ref(false)

function openEditModal() {
  showModal.value = true
}

function closeModal() {
  showModal.value = false
}

function onSaved(payload: { mode: 'create' | 'edit'; message: string }) {
  closeModal()
  toastStore.push(payload.message)
  // Refetch THIS page, not the list (SoT F4 §4 "Sửa từ Device Detail" bước 2,
  // A6) — the header (StatusBadge, retired banner) must reflect the change
  // immediately without the user reloading.
  load()
}

// ---------- Groups đang thuộc (F6) ----------
/** Every button in this block is hidden for a retired device (A26) — the list itself stays readable. */
const canEditGroups = computed(() => device.value !== null && device.value.status !== 'retired')

const showAddGroupModal = ref(false)
/** The group row awaiting confirmation; `null` means no dialog is mounted. */
const removeTarget = ref<DeviceGroupRef | null>(null)

const removeMessage = computed(() =>
  device.value && removeTarget.value
    ? `Gỡ thiết bị "${device.value.identifier}" khỏi group "${removeTarget.value.name}"?`
    : '',
)

function onGroupAdded() {
  showAddGroupModal.value = false
  toastStore.push(ADD_SUCCESS_MESSAGE)
  // Refetch the whole device: `groups` only ever comes back from the server,
  // never patched client-side.
  load()
}

/**
 * Unlike the members tab on Group Detail (inline confirm, big table), this
 * short list uses the shared `ConfirmModal` — UI_UX_design.md §5 does not
 * forbid a dialog here, and there is no row to expand into.
 */
async function handleRemoveGroup() {
  const target = removeTarget.value
  const current = device.value
  if (!target || !current) return
  try {
    await removeGroupDevice(target.id, current.id)
    removeTarget.value = null
    toastStore.push(REMOVE_SUCCESS_MESSAGE)
    load()
  } catch (error) {
    removeTarget.value = null
    if (isNotFoundError(error)) {
      // The link is already gone — refetch so the block shows reality.
      toastStore.push(MEMBERSHIP_MISSING_MESSAGE, 'error')
      load()
      return
    }
    // 422 (device retired, A27) / 500: the membership genuinely still
    // exists, so nothing is refetched.
    toastStore.push(extractErrorMessage(error, REMOVE_FAILED_MESSAGE), 'error')
  }
}

function formatTimestamp(value: string | null): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
</script>

<template>
  <AppShell>
    <template v-if="notFound">
      <EmptyState title="Không tìm thấy thiết bị" description="Thiết bị này không tồn tại hoặc bạn không có quyền xem.">
        <RouterLink :to="backLocation" class="btn btn-secondary" data-testid="device-detail-back-link">
          ◀ Quay lại danh sách
        </RouterLink>
      </EmptyState>
    </template>

    <template v-else-if="loadError">
      <ErrorState :message="loadError" @retry="load" />
    </template>

    <template v-else-if="loadingDetail">
      <div class="detail-header">
        <div style="width: 100%">
          <span class="skeleton-cell" style="width: 180px; height: 16px; display: block; margin-bottom: 10px"></span>
          <span class="skeleton-cell" style="width: 320px; height: 12px; display: block"></span>
        </div>
      </div>
    </template>

    <template v-else-if="device">
      <RouterLink :to="backLocation" class="detail-back" data-testid="device-detail-back-link">
        ◀ Quay lại danh sách
      </RouterLink>

      <div v-if="device.status === 'retired'" class="neutral-banner" data-testid="device-detail-retired-banner">
        <span aria-hidden="true">🔒</span>
        <span>Thiết bị đã retired — không thể chỉnh sửa.</span>
      </div>

      <div class="detail-header">
        <div>
          <div class="id-row">
            <span data-testid="device-detail-identifier">{{ device.identifier }}</span>
            <StatusBadge data-testid="device-detail-status" :status="device.status" />
          </div>
          <div class="meta-row">
            <span data-testid="device-detail-name">{{ device.name }}</span>
            <span>{{ device.platform }}</span>
            <span>{{ device.os_version ?? '—' }}</span>
            <span>Last seen: {{ formatTimestamp(device.last_seen_at) ?? '—' }}</span>
          </div>
        </div>
        <button
          v-if="device.status !== 'retired'"
          type="button"
          class="btn btn-secondary"
          data-testid="device-detail-edit-button"
          @click="openEditModal"
        >
          Sửa
        </button>
      </div>

      <div class="detail-grid">
        <div class="detail-block">
          <h4>Groups đang thuộc</h4>
          <ul v-if="device.groups.length > 0" class="group-link-list" data-testid="device-detail-groups-list">
            <li v-for="groupRef in device.groups" :key="groupRef.id" data-testid="device-detail-group-row">
              <RouterLink :to="`/groups/${groupRef.id}`">{{ groupRef.name }}</RouterLink>
              <button
                v-if="canEditGroups"
                type="button"
                class="btn btn-secondary btn-sm"
                title="Gỡ khỏi group"
                data-testid="device-detail-group-remove-button"
                @click="removeTarget = groupRef"
              >
                ×
              </button>
            </li>
          </ul>
          <!-- Same testid as F4, but now it only shows when the device
               really belongs to nothing (A25). -->
          <div v-else data-testid="device-detail-groups-empty">
            <div class="placeholder-box">
              <span class="ic" aria-hidden="true">▣</span>
              <span>Chưa thuộc group nào.</span>
            </div>
          </div>
          <button
            v-if="canEditGroups"
            type="button"
            class="btn btn-secondary"
            style="width: 100%; justify-content: center; margin-top: 10px"
            data-testid="device-detail-add-group-button"
            @click="showAddGroupModal = true"
          >
            + Thêm vào group
          </button>
        </div>
        <div class="detail-block">
          <h4>Policy đang áp dụng</h4>
          <AppliedPoliciesBlock :device-id="device.id" />
        </div>
      </div>
    </template>
  </AppShell>

  <DeviceFormModal v-if="showModal && device" mode="edit" :device="device" @saved="onSaved" @cancel="closeModal" />

  <DeviceGroupAddModal
    v-if="showAddGroupModal && device"
    :device-id="device.id"
    :device-identifier="device.identifier"
    @added="onGroupAdded"
    @cancel="showAddGroupModal = false"
  />

  <ConfirmModal
    v-if="removeTarget && device"
    title="Gỡ khỏi group?"
    :message="removeMessage"
    confirm-label="Gỡ"
    destructive
    :on-confirm="handleRemoveGroup"
    test-id="confirm-modal"
    confirm-test-id="confirm-modal-confirm"
    cancel-test-id="confirm-modal-cancel"
    @cancel="removeTarget = null"
  />
</template>
