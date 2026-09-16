<script setup lang="ts">
import { computed, ref } from 'vue'
import FormModal from './FormModal.vue'
import AsyncSearchSelect from './AsyncSearchSelect.vue'
import type { AsyncSearchSelectOption } from './AsyncSearchSelect.vue'
import { useGroupMembershipsStore } from '../stores/group-memberships'
import { fetchDeviceList } from '../api/devices'
import { extractFormErrors } from '../utils/apiError'
import type { Device } from '../types/device'

/**
 * "+ Thêm device vào group" — docs/design/F6-frontend.md §2.3.
 *
 * A thin wrapper: `FormModal` owns the shell and the banner,
 * `AsyncSearchSelect` owns the search/selection, this component owns only
 * the device fetcher, the submit call and how each status code reads.
 *
 * It deliberately does NOT receive the group's current members to filter
 * them out of the results (SoT F6 OQ-7): re-adding an existing member is a
 * successful no-op server-side, and hiding devices would mean fetching the
 * whole membership just to build a search box.
 */
const props = defineProps<{ groupId: number }>()

const emit = defineEmits<{
  added: [payload: { addedCount: number; devicesCount: number }]
  cancel: []
}>()

const GENERIC_ERROR_MESSAGE = 'Có lỗi xảy ra, vui lòng thử lại.'

const membershipsStore = useGroupMembershipsStore()

const selected = ref<AsyncSearchSelectOption[]>([])
const baseError = ref<string | null>(null)
const submitting = ref(false)

const canSubmit = computed(() => selected.value.length > 0)

function toOption(device: Device): AsyncSearchSelectOption {
  return {
    id: device.id,
    label: device.identifier,
    sublabel: `${device.name} · ${device.platform}`,
  }
}

/** Page 1 only — the dropdown is a search box, not a browsable list (F6-frontend.md §2.4 point 9). */
async function searchDevices(query: string): Promise<AsyncSearchSelectOption[]> {
  const response = await fetchDeviceList({ q: query, page: 1 })
  return response.devices.map(toOption)
}

async function onSubmit() {
  if (submitting.value || !canSubmit.value) return
  submitting.value = true
  baseError.value = null
  try {
    const result = await membershipsStore.addMembers(
      props.groupId,
      selected.value.map((option) => option.id),
    )
    // The parent closes the modal, toasts and refetches — this component
    // cannot know what else needs refreshing (F6-frontend.md §2.3).
    emit('added', { addedCount: result.added_count, devicesCount: result.devices_count })
  } catch (error) {
    // Every 422 variant (retired device in the batch / nothing valid left /
    // over the 500 cap / empty) lands in the same banner: there is no
    // per-field input to hang `device_ids` under — the field IS the search
    // select. The server's wording is rendered verbatim, never remapped.
    const result = extractFormErrors(error, GENERIC_ERROR_MESSAGE)
    baseError.value = result.fieldErrors.device_ids?.[0] ?? result.baseError
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <FormModal
    title="Thêm device vào group"
    submit-label="Thêm đã chọn"
    :submitting="submitting"
    :submit-disabled="!canSubmit"
    :base-error="baseError"
    test-id="group-member-add-modal"
    banner-test-id="group-member-add-banner"
    submit-test-id="group-member-add-submit"
    cancel-test-id="group-member-add-cancel"
    @submit="onSubmit"
    @cancel="emit('cancel')"
  >
    <div class="field">
      <label>Tìm device</label>
      <AsyncSearchSelect
        v-model="selected"
        :search="searchDevices"
        mode="multiple"
        placeholder="Tìm theo identifier hoặc tên..."
        test-id="group-member-add-search"
      />
    </div>
  </FormModal>
</template>
