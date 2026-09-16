<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import AppShell from '../../components/AppShell.vue'
import StatusBadge from '../../components/StatusBadge.vue'
import EmptyState from '../../components/EmptyState.vue'
import ErrorState from '../../components/ErrorState.vue'
import DeviceFormModal from '../../components/DeviceFormModal.vue'
import { useDevicesStore } from '../../stores/devices'
import { useToastStore } from '../../stores/toast'
import { fetchDevice } from '../../api/devices'
import { extractErrorMessage, isNotFoundError } from '../../utils/apiError'
import type { Device } from '../../types/device'

/**
 * Device Detail (docs/design/F4-frontend.md §1–§4). Fetch state is local to
 * this component, not the Pinia store — nothing else on screen needs to read
 * this one device (same reasoning F3 applied to form state).
 *
 * "Groups đang thuộc" / "Policy đang áp dụng" are permanently the static
 * empty state at F4 (SoT OQ-1): there is no Group/Policy model yet, so no
 * API call, no loading/error of their own — F6/F9 will replace their
 * content without touching this page's route/layout.
 */

const route = useRoute()
const store = useDevicesStore()
const toastStore = useToastStore()

const GENERIC_LOAD_ERROR = 'Không tải được thông tin thiết bị.'

const device = ref<Device | null>(null)
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
          <div data-testid="device-detail-groups-empty">
            <div class="placeholder-box">
              <span class="ic" aria-hidden="true">▣</span>
              <span>Chưa thuộc group nào.</span>
            </div>
          </div>
        </div>
        <div class="detail-block">
          <h4>Policy đang áp dụng</h4>
          <div data-testid="device-detail-policies-empty">
            <div class="placeholder-box">
              <span class="ic" aria-hidden="true">▣</span>
              <span>Chưa có policy nào áp dụng.</span>
            </div>
          </div>
        </div>
      </div>
    </template>
  </AppShell>

  <DeviceFormModal v-if="showModal && device" mode="edit" :device="device" @saved="onSaved" @cancel="closeModal" />
</template>
