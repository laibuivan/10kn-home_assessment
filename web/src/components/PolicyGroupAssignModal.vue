<script setup lang="ts">
import { computed, ref } from 'vue'
import FormModal from './FormModal.vue'
import AsyncSearchSelect from './AsyncSearchSelect.vue'
import type { AsyncSearchSelectOption } from './AsyncSearchSelect.vue'
import { usePolicyAssignmentsStore } from '../stores/policyAssignments'
import { fetchGroupList } from '../api/groups'
import { extractFormErrors } from '../utils/apiError'
import type { PolicyAssignmentJob } from '../types/policyAssignmentJob'

/**
 * "Gán thêm cho Group" ở Policy Detail tab Group — docs/design/
 * F8-frontend.md §2.5.2. Đối xứng `GroupPolicyAssignModal` (search Group
 * thay Policy, gọi CÙNG hàm `assignPolicyToGroup` với tham số đảo — cùng
 * endpoint 2 chiều).
 */
const props = defineProps<{ policyId: number; policyName: string; assignedGroupIds: number[] }>()

const emit = defineEmits<{ assigned: [job: PolicyAssignmentJob]; cancel: [] }>()

const GENERIC_ERROR_MESSAGE = 'Có lỗi xảy ra, vui lòng thử lại.'

const store = usePolicyAssignmentsStore()

const selected = ref<AsyncSearchSelectOption[]>([])
const baseError = ref<string | null>(null)
const submitting = ref(false)

const canSubmit = computed(() => selected.value.length > 0)

/** Group has no `status` field — search is not scoped by any state (§5.1). */
async function searchGroups(query: string): Promise<AsyncSearchSelectOption[]> {
  const response = await fetchGroupList({ q: query, page: 1 })
  return response.groups.map((g) => ({ id: g.id, label: g.name }))
}

const isDuplicate = computed(
  () => selected.value.length > 0 && props.assignedGroupIds.includes(selected.value[0].id),
)

async function onSubmit() {
  if (submitting.value || !canSubmit.value) return
  submitting.value = true
  baseError.value = null
  try {
    const job = await store.assignPolicyToGroup(selected.value[0].id, props.policyId)
    emit('assigned', job)
  } catch (error) {
    const result = extractFormErrors(error, GENERIC_ERROR_MESSAGE)
    baseError.value = result.fieldErrors.group_id?.[0] ?? result.baseError
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <FormModal
    title="Gán thêm cho group"
    submit-label="Gán"
    :submitting="submitting"
    :submit-disabled="!canSubmit"
    :base-error="baseError"
    test-id="policy-group-assign-modal"
    banner-test-id="policy-group-assign-banner"
    submit-test-id="policy-group-assign-submit"
    cancel-test-id="policy-group-assign-cancel"
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
        test-id="policy-group-assign-search"
      />
    </div>

    <div v-if="isDuplicate" class="warning-banner" data-testid="policy-group-assign-duplicate-warning">
      Group này đã được gán Policy "{{ policyName }}". Gán lại sẽ không tạo trùng.
    </div>
  </FormModal>
</template>
