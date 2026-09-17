<script setup lang="ts">
import { computed, ref } from 'vue'
import FormModal from './FormModal.vue'
import AsyncSearchSelect from './AsyncSearchSelect.vue'
import type { AsyncSearchSelectOption } from './AsyncSearchSelect.vue'
import { usePolicyAssignmentsStore } from '../stores/policyAssignments'
import { fetchDeviceList } from '../api/devices'
import { extractFormErrors } from '../utils/apiError'
import type { Device } from '../types/device'

/**
 * "Gán thêm cho Device" ở Policy Detail tab Device — docs/design/
 * F8-frontend.md §2.5.3. Đồng bộ (201, không job): submit gọi thẳng
 * `POST /policies/:id/device_assignments`, thành công trả về `Device`.
 */
const props = defineProps<{ policyId: number }>()

const emit = defineEmits<{ assigned: [device: Device]; cancel: [] }>()

const GENERIC_ERROR_MESSAGE = 'Có lỗi xảy ra, vui lòng thử lại.'
/** = Device::RETIRED_POLICY_MESSAGE (F8-api.md §3) — same wording whether the block is client- or server-side. */
const RETIRED_POLICY_MESSAGE = 'Thiết bị đã retired, không thể gán policy trực tiếp.'

const store = usePolicyAssignmentsStore()

const selected = ref<AsyncSearchSelectOption[]>([])
/**
 * `AsyncSearchSelect` only hands back `{id,label,sublabel}` — the real
 * Device (needed for `status`) is cached here by id from the search
 * response itself, no extra request.
 */
const devicesById = ref<Map<number, Device>>(new Map())
const baseError = ref<string | null>(null)
const submitting = ref(false)

/** Device `retired` still appears in results (5.1) — hiding it would read as if the system had lost the device; it is blocked at selection instead. */
async function searchDevices(query: string): Promise<AsyncSearchSelectOption[]> {
  const response = await fetchDeviceList({ q: query, page: 1 })
  response.devices.forEach((d) => devicesById.value.set(d.id, d))
  return response.devices.map((d) => ({
    id: d.id,
    label: d.identifier,
    sublabel: d.status === 'retired' ? `${d.name} · retired` : `${d.name} · ${d.platform}`,
  }))
}

const selectedDevice = computed<Device | null>(() =>
  selected.value.length > 0 ? devicesById.value.get(selected.value[0].id) ?? null : null,
)
const selectedIsRetired = computed(() => selectedDevice.value?.status === 'retired')
const canSubmit = computed(() => selected.value.length > 0 && !selectedIsRetired.value)

async function onSubmit() {
  if (submitting.value || !canSubmit.value) return
  submitting.value = true
  baseError.value = null
  try {
    const device = await store.assignDeviceToPolicy(props.policyId, selected.value[0].id)
    emit('assigned', device)
  } catch (error) {
    // §2.5.3: blocking early in the UI is an optimization, not a substitute
    // for server validation — a race (device retired between search and
    // submit) still lands here and reads the same 422 `base` message.
    const result = extractFormErrors(error, GENERIC_ERROR_MESSAGE)
    baseError.value = result.fieldErrors.device_id?.[0] ?? result.baseError
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <FormModal
    title="Gán thêm cho device"
    submit-label="Gán"
    :submitting="submitting"
    :submit-disabled="!canSubmit"
    :base-error="baseError"
    test-id="policy-device-assign-modal"
    banner-test-id="policy-device-assign-banner"
    submit-test-id="policy-device-assign-submit"
    cancel-test-id="policy-device-assign-cancel"
    @submit="onSubmit"
    @cancel="emit('cancel')"
  >
    <div class="field">
      <label>Tìm device</label>
      <AsyncSearchSelect
        v-model="selected"
        :search="searchDevices"
        mode="single"
        placeholder="Tìm theo identifier hoặc tên..."
        test-id="policy-device-assign-search"
      />
    </div>

    <div v-if="selectedIsRetired" class="error-banner" data-testid="policy-device-assign-retired-warning">
      <span aria-hidden="true">⚠</span>
      <span>{{ RETIRED_POLICY_MESSAGE }}</span>
    </div>
  </FormModal>
</template>
