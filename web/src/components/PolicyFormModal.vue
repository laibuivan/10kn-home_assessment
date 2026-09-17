<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import FormModal from './FormModal.vue'
import ConfirmModal from './ConfirmModal.vue'
import { usePoliciesStore } from '../stores/policies'
import { extractFormErrors } from '../utils/apiError'
import { DEACTIVATE_WARNING } from '../utils/policyMessages'
import type { Policy, PolicyCreatePayload, PolicyStatus, PolicyUpdatePayload } from '../types/policy'

/**
 * Create/edit form for Policy (docs/design/F7-frontend.md §2) — wraps
 * `FormModal :wide="true"`, which owns the modal shell; this component owns
 * the 4 fields (`name`/`type`/`configuration`/`status`), validation, and the
 * API call. Same shape as `GroupFormModal`/`DeviceFormModal`.
 *
 * `mode: 'edit'` mounts with `policy` already set, prefilled from the row
 * already in the store — there is no `GET /policies/:id` to call (F7-api.md
 * §1). The parent always mounts this with `v-if`, so switching between
 * create and edit is a fresh mount, not a state reset handled here.
 */
const props = withDefaults(
  defineProps<{
    mode: 'create' | 'edit'
    policy?: Policy | null
  }>(),
  { policy: null },
)

const emit = defineEmits<{
  saved: [payload: { mode: 'create' | 'edit'; message: string }]
  cancel: []
}>()

const GENERIC_ERROR_MESSAGE = 'Có lỗi xảy ra, vui lòng thử lại.'
/** Same wording as `Policy::NAME_BLANK_MESSAGE`, so the user sees one message whether the block came from the client or the API. */
const NAME_BLANK_MESSAGE = 'Tên policy không được để trống'
/** Same wording as `Policy::TYPE_BLANK_MESSAGE`. */
const TYPE_BLANK_MESSAGE = 'Loại (type) không được để trống'
/** = Policy::CONFIGURATION_INVALID_MESSAGE (F7-db.md §1) — same wording whether the block is client- or server-side. */
const CONFIGURATION_INVALID_MESSAGE = 'Cấu hình phải là một object JSON hợp lệ.'
const SUCCESS_MESSAGE: Record<'create' | 'edit', string> = {
  create: 'Đã tạo policy',
  edit: 'Đã cập nhật policy',
}

const policiesStore = usePoliciesStore()

interface FormState {
  name: string
  type: string
  /** Raw textarea contents — kept as text (not parsed) until blur/Format/submit (§2.2). */
  configurationRaw: string
  status: PolicyStatus
}

function buildInitialForm(): FormState {
  if (props.mode === 'edit' && props.policy) {
    return {
      name: props.policy.name,
      type: props.policy.type,
      configurationRaw: JSON.stringify(props.policy.configuration, null, 2),
      status: props.policy.status,
    }
  }
  return { name: '', type: '', configurationRaw: '', status: 'active' }
}

const form = reactive<FormState>(buildInitialForm())
const fieldErrors = ref<Record<string, string[]>>({})
const baseError = ref<string | null>(null)
const submitting = ref(false)

const title = computed(() => (props.mode === 'create' ? 'Thêm Policy' : 'Sửa Policy'))

/**
 * Combobox suggestions for `type` (§2.1, OQ-3) — distinct values already
 * present in `policiesStore.policies` (the list data already loaded when
 * this modal is opened). No extra network request: this is a convenience
 * suggestion, not validation — the user may still type any value.
 */
const typeSuggestions = computed(() =>
  Array.from(new Set(policiesStore.policies.map((p) => p.type))).sort(),
)

function fieldErrorText(field: string): string | null {
  return fieldErrors.value[field]?.[0] ?? null
}

/** Clears only that field's error — not `baseError`, which reports the whole request being rejected. */
function clearFieldError(field: string) {
  if (!(field in fieldErrors.value)) return
  const next = { ...fieldErrors.value }
  delete next[field]
  fieldErrors.value = next
}

/**
 * The single parse function for `configuration` — reused by blur, the
 * Format button, and submit (§2.2), so all three agree on what counts as
 * valid. Empty string, syntax errors, and any JSON value that isn't a plain
 * object (array/number/string/null) are all rejected with the same message
 * — the server does not distinguish "missing" from "invalid" either
 * (F7-api.md §2.4).
 */
function parseConfiguration(): { value: Record<string, unknown> | null; error: string | null } {
  const raw = form.configurationRaw.trim()
  if (!raw) return { value: null, error: CONFIGURATION_INVALID_MESSAGE }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { value: null, error: CONFIGURATION_INVALID_MESSAGE }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { value: null, error: CONFIGURATION_INVALID_MESSAGE }
  }
  return { value: parsed as Record<string, unknown>, error: null }
}

/**
 * Sets/clears the field error only — never rewrites `form.configurationRaw`
 * on error (SoT §7: the user's raw typed text must survive so they can fix
 * it in place, not have it silently wiped).
 */
function onConfigurationBlur() {
  const { error } = parseConfiguration()
  if (error) fieldErrors.value = { ...fieldErrors.value, configuration: [error] }
  else clearFieldError('configuration')
}

function onFormat() {
  const { value, error } = parseConfiguration()
  if (error) {
    fieldErrors.value = { ...fieldErrors.value, configuration: [error] }
    return
  }
  form.configurationRaw = JSON.stringify(value, null, 2)
  clearFieldError('configuration')
}

/**
 * Client-side checks that mirror rules the server enforces anyway (A4/A12,
 * SoT §7) — length limits are deliberately NOT checked here and the name/type
 * inputs carry no `maxlength`, same reasoning as Group/Device
 * (F5-frontend.md §5): the 100-char cap is the server's contract, and a
 * silently-truncating input would make that scenario impossible to exercise
 * through the UI. `configuration` is re-parsed here (not just relying on
 * blur having already run) because the user can hit "Lưu" without ever
 * blurring the textarea.
 */
function clientValidate(): Record<string, string[]> {
  const errors: Record<string, string[]> = {}
  if (!form.name.trim()) errors.name = [NAME_BLANK_MESSAGE]
  if (!form.type.trim()) errors.type = [TYPE_BLANK_MESSAGE]
  const { error } = parseConfiguration()
  if (error) errors.configuration = [error]
  return errors
}

/**
 * F8 — deactivate-with-assignments confirm (docs/design/F8-frontend.md §5,
 * same rule as `PolicyListView.toggleStatus`). Only `active -> inactive`
 * with a real `assignments_count > 0` needs a second look; activating
 * (`inactive -> active`) never does — there is nothing to warn about.
 */
const pendingDeactivateConfirm = ref(false)

function needsDeactivateConfirm(): boolean {
  return (
    props.mode === 'edit' &&
    form.status === 'inactive' &&
    props.policy!.status === 'active' &&
    props.policy!.assignments_count > 0
  )
}

async function performSubmit() {
  const { value: configuration } = parseConfiguration()

  submitting.value = true
  baseError.value = null
  try {
    if (props.mode === 'create') {
      const payload: PolicyCreatePayload = {
        name: form.name,
        type: form.type,
        configuration: configuration!,
        status: form.status,
      }
      await policiesStore.createPolicy(payload)
    } else {
      // PATCH always sends all 4 fields (not partial) — F7-frontend.md §3.3:
      // the form shows all 4 fields at once in both modes, so there is no
      // "field the user didn't touch" to omit, unlike Group's `description`.
      const payload: PolicyUpdatePayload = {
        name: form.name,
        type: form.type,
        configuration: configuration!,
        status: form.status,
      }
      await policiesStore.updatePolicy(props.policy!.id, payload)
    }
    emit('saved', { mode: props.mode, message: SUCCESS_MESSAGE[props.mode] })
  } catch (error) {
    const result = extractFormErrors(error, GENERIC_ERROR_MESSAGE)
    fieldErrors.value = result.fieldErrors
    baseError.value = result.baseError
  } finally {
    submitting.value = false
  }
}

async function onSubmit() {
  if (submitting.value) return

  const clientErrors = clientValidate()
  if (Object.keys(clientErrors).length > 0) {
    fieldErrors.value = clientErrors
    return
  }

  if (needsDeactivateConfirm()) {
    pendingDeactivateConfirm.value = true
    return
  }

  await performSubmit()
}

async function confirmDeactivate() {
  pendingDeactivateConfirm.value = false
  await performSubmit()
}

function onCancel() {
  emit('cancel')
}
</script>

<template>
  <FormModal
    :title="title"
    :submitting="submitting"
    :base-error="baseError"
    :wide="true"
    test-id="policy-form-modal"
    banner-test-id="policy-form-banner"
    submit-test-id="policy-form-submit"
    cancel-test-id="policy-form-cancel"
    @submit="onSubmit"
    @cancel="onCancel"
  >
    <div class="field" :class="{ 'has-error': fieldErrorText('name') }">
      <label for="policy-form-name">Tên policy</label>
      <input
        id="policy-form-name"
        v-model="form.name"
        type="text"
        data-testid="policy-form-name"
        placeholder="vd. Wifi mặc định"
        @input="clearFieldError('name')"
      />
      <span v-if="fieldErrorText('name')" class="field-error" data-testid="field-error-name">
        {{ fieldErrorText('name') }}
      </span>
    </div>

    <div class="field" :class="{ 'has-error': fieldErrorText('type') }">
      <label for="policy-form-type">Loại (type)</label>
      <input
        id="policy-form-type"
        v-model="form.type"
        type="text"
        list="policy-type-suggestions"
        data-testid="policy-form-type"
        placeholder="vd. password, wifi, device_lock..."
        autocomplete="off"
        @input="clearFieldError('type')"
      />
      <datalist id="policy-type-suggestions">
        <option v-for="t in typeSuggestions" :key="t" :value="t" />
      </datalist>
      <span v-if="fieldErrorText('type')" class="field-error" data-testid="field-error-type">
        {{ fieldErrorText('type') }}
      </span>
    </div>

    <div class="field" :class="{ 'has-error': fieldErrorText('configuration') }">
      <div class="field-label-row">
        <label for="policy-form-configuration">Cấu hình (JSON)</label>
        <button
          type="button"
          class="btn btn-secondary btn-sm"
          data-testid="policy-form-configuration-format"
          @click="onFormat"
        >
          Format
        </button>
      </div>
      <textarea
        id="policy-form-configuration"
        v-model="form.configurationRaw"
        rows="8"
        class="json-editor"
        data-testid="policy-form-configuration"
        placeholder='{&#10;  "key": "value"&#10;}'
        @input="clearFieldError('configuration')"
        @blur="onConfigurationBlur"
      ></textarea>
      <span v-if="fieldErrorText('configuration')" class="field-error" data-testid="field-error-configuration">
        {{ fieldErrorText('configuration') }}
      </span>
    </div>

    <div class="field" :class="{ 'has-error': fieldErrorText('status') }">
      <label for="policy-form-status">Trạng thái</label>
      <select
        id="policy-form-status"
        v-model="form.status"
        data-testid="policy-form-status"
        @change="clearFieldError('status')"
      >
        <option value="active">active</option>
        <option value="inactive">inactive</option>
      </select>
      <span v-if="fieldErrorText('status')" class="field-error" data-testid="field-error-status">
        {{ fieldErrorText('status') }}
      </span>
    </div>
  </FormModal>

  <ConfirmModal
    v-if="pendingDeactivateConfirm && policy"
    title="Chuyển Policy sang inactive?"
    :message="DEACTIVATE_WARNING(policy.assignments_count)"
    confirm-label="Chuyển sang inactive"
    :on-confirm="confirmDeactivate"
    test-id="policy-deactivate-confirm"
    confirm-test-id="policy-deactivate-confirm-confirm"
    cancel-test-id="policy-deactivate-confirm-cancel"
    @cancel="pendingDeactivateConfirm = false"
  />
</template>
