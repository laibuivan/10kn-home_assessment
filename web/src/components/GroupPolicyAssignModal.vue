<script setup lang="ts">
import { computed, ref } from 'vue'
import FormModal from './FormModal.vue'
import AsyncSearchSelect from './AsyncSearchSelect.vue'
import type { AsyncSearchSelectOption } from './AsyncSearchSelect.vue'
import { usePolicyAssignmentsStore } from '../stores/policyAssignments'
import { fetchPolicyList } from '../api/policies'
import { extractFormErrors } from '../utils/apiError'
import type { PolicyAssignmentJob } from '../types/policyAssignmentJob'

/**
 * "+ Gán policy" ở Group Detail tab Policies — docs/design/F8-frontend.md
 * §2.5.1. Thin wrapper: `FormModal` owns the shell/banner, `AsyncSearchSelect`
 * owns search/selection, this component owns only the Policy fetcher (scoped
 * to `status=active`, 5.1), the submit call, and the not-a-real-error
 * duplicate warning.
 */
const props = defineProps<{ groupId: number; assignedPolicyIds: number[] }>()

const emit = defineEmits<{ assigned: [job: PolicyAssignmentJob]; cancel: [] }>()

const GENERIC_ERROR_MESSAGE = 'Có lỗi xảy ra, vui lòng thử lại.'

const store = usePolicyAssignmentsStore()

const selected = ref<AsyncSearchSelectOption[]>([])
const baseError = ref<string | null>(null)
const submitting = ref(false)

const canSubmit = computed(() => selected.value.length > 0)

/** Only `active` Policies appear in results (5.1) — filtered at the request itself, not re-filtered client-side. */
async function searchActivePolicies(query: string): Promise<AsyncSearchSelectOption[]> {
  const response = await fetchPolicyList({ q: query, status: 'active', page: 1 })
  return response.policies.map((p) => ({ id: p.id, label: p.name, sublabel: p.type }))
}

/** 5.1 — a non-blocking warning, based on the list already loaded in the Policies tab (no extra API call). */
const isDuplicate = computed(
  () => selected.value.length > 0 && props.assignedPolicyIds.includes(selected.value[0].id),
)

async function onSubmit() {
  if (submitting.value || !canSubmit.value) return
  submitting.value = true
  baseError.value = null
  try {
    const job = await store.assignPolicyToGroup(props.groupId, selected.value[0].id)
    emit('assigned', job)
  } catch (error) {
    const result = extractFormErrors(error, GENERIC_ERROR_MESSAGE)
    baseError.value = result.fieldErrors.policy_id?.[0] ?? result.baseError
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <FormModal
    title="Gán policy cho group"
    submit-label="Gán"
    :submitting="submitting"
    :submit-disabled="!canSubmit"
    :base-error="baseError"
    test-id="group-policy-assign-modal"
    banner-test-id="group-policy-assign-banner"
    submit-test-id="group-policy-assign-submit"
    cancel-test-id="group-policy-assign-cancel"
    @submit="onSubmit"
    @cancel="emit('cancel')"
  >
    <div class="field">
      <label>Tìm policy</label>
      <AsyncSearchSelect
        v-model="selected"
        :search="searchActivePolicies"
        mode="single"
        placeholder="Tìm theo tên policy..."
        test-id="group-policy-assign-search"
      />
    </div>

    <div v-if="isDuplicate" class="warning-banner" data-testid="group-policy-assign-duplicate-warning">
      Policy này đã được gán cho group. Gán lại sẽ không tạo trùng.
    </div>
  </FormModal>
</template>
