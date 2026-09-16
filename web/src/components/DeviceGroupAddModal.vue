<script setup lang="ts">
import { computed, ref } from 'vue'
import FormModal from './FormModal.vue'
import AsyncSearchSelect from './AsyncSearchSelect.vue'
import type { AsyncSearchSelectOption } from './AsyncSearchSelect.vue'
import { addGroupDevices } from '../api/group-memberships'
import { fetchGroupList } from '../api/groups'
import { extractFormErrors, isNotFoundError } from '../utils/apiError'
import type { Group } from '../types/group'

/**
 * "+ Thêm vào group" on Device Detail — docs/design/F6-frontend.md §2.6.
 *
 * Same shape as `GroupMemberAddModal`, pointing the other way: it searches
 * Groups and adds THIS device to the one picked. There is no dedicated
 * "add group to device" endpoint and there must not be one — this calls the
 * very same `POST /groups/:group_id/devices` (SoT F6 §4D bước 1), so both
 * directions go through one implementation of the business rules.
 *
 * `mode="single"` (OQ-FE-3): picking several groups at once would need a
 * "partially succeeded" state that no acceptance scenario covers.
 */
const props = defineProps<{ deviceId: number; deviceIdentifier: string }>()

const emit = defineEmits<{ added: []; cancel: [] }>()

const GENERIC_ERROR_MESSAGE = 'Có lỗi xảy ra, vui lòng thử lại.'
const GROUP_MISSING_MESSAGE = 'Group đã chọn không còn tồn tại hoặc đã bị xóa.'

const selected = ref<AsyncSearchSelectOption[]>([])
const baseError = ref<string | null>(null)
const submitting = ref(false)

const canSubmit = computed(() => selected.value.length > 0)

const title = computed(() => `Thêm "${props.deviceIdentifier}" vào group`)

function toOption(group: Group): AsyncSearchSelectOption {
  return { id: group.id, label: group.name, sublabel: group.description ?? undefined }
}

/** Reuses F5's `q` on the groups list — no new endpoint for this screen. */
async function searchGroups(query: string): Promise<AsyncSearchSelectOption[]> {
  const response = await fetchGroupList({ q: query, page: 1 })
  return response.groups.map(toOption)
}

async function onSubmit() {
  if (submitting.value || !canSubmit.value) return
  submitting.value = true
  baseError.value = null
  try {
    await addGroupDevices(selected.value[0].id, [props.deviceId])
    emit('added')
  } catch (error) {
    if (isNotFoundError(error)) {
      // The group disappeared between searching and submitting. The modal
      // stays open so the user can pick another one without starting over.
      baseError.value = GROUP_MISSING_MESSAGE
      return
    }
    // 422 here means the server blocked it even though the UI hides these
    // buttons for a retired device (A27) — e.g. it was retired while this
    // modal was open. Server wording is shown verbatim.
    const result = extractFormErrors(error, GENERIC_ERROR_MESSAGE)
    baseError.value = result.fieldErrors.device_ids?.[0] ?? result.baseError
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <FormModal
    :title="title"
    submit-label="Thêm"
    :submitting="submitting"
    :submit-disabled="!canSubmit"
    :base-error="baseError"
    test-id="device-group-add-modal"
    banner-test-id="device-group-add-banner"
    submit-test-id="device-group-add-submit"
    cancel-test-id="device-group-add-cancel"
    @submit="onSubmit"
    @cancel="emit('cancel')"
  >
    <div class="field">
      <label>Tìm group</label>
      <AsyncSearchSelect
        v-model="selected"
        :search="searchGroups"
        mode="single"
        placeholder="Tìm theo tên group..."
        test-id="device-group-add-search"
      />
    </div>
  </FormModal>
</template>
