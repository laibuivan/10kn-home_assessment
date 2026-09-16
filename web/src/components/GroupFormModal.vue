<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import FormModal from './FormModal.vue'
import { useGroupsStore } from '../stores/groups'
import { extractFormErrors, isNotFoundError } from '../utils/apiError'
import type { Group, GroupCreatePayload, GroupUpdatePayload } from '../types/group'

/**
 * Create/edit form for Group (docs/design/F5-frontend.md §2) — wraps
 * `FormModal`, which owns the modal shell; this component owns the fields,
 * the one client-side check, and the API call.
 *
 * `mode: 'edit'` mounts with `group` already set, prefilled from the row
 * already in the store — there is no `GET /groups/:id` to call (F5-api.md
 * §1). The parent always mounts this with `v-if`, so switching between
 * create and edit is a fresh mount, not a state reset handled here.
 */
const props = withDefaults(
  defineProps<{
    mode: 'create' | 'edit'
    group?: Group | null
  }>(),
  { group: null },
)

const emit = defineEmits<{
  saved: [payload: { mode: 'create' | 'edit'; message: string }]
  /** Edit mode only: the group was deleted by someone else (404 — A12). */
  missing: []
  cancel: []
}>()

const GENERIC_ERROR_MESSAGE = 'Có lỗi xảy ra, vui lòng thử lại.'
/** Same wording as the server's `Group::NAME_BLANK_MESSAGE`, so the user sees one message whether the block came from the client or the API. */
const NAME_BLANK_MESSAGE = 'Tên group không được để trống'
const SUCCESS_MESSAGE: Record<'create' | 'edit', string> = {
  create: 'Đã tạo group',
  edit: 'Đã cập nhật group',
}

const groupsStore = useGroupsStore()

interface FormState {
  name: string
  description: string
}

function buildInitialForm(): FormState {
  if (props.mode === 'edit' && props.group) {
    return { name: props.group.name, description: props.group.description ?? '' }
  }
  return { name: '', description: '' }
}

const form = reactive<FormState>(buildInitialForm())
const fieldErrors = ref<Record<string, string[]>>({})
const baseError = ref<string | null>(null)
const submitting = ref(false)

const title = computed(() => (props.mode === 'create' ? 'Thêm Group' : 'Sửa Group'))

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
 * The only client-side rule: a blank name is a request guaranteed to fail
 * (A4). Length limits are deliberately NOT checked here and the inputs carry
 * no `maxlength` — the 100/500 caps are the server's contract (422
 * field-level), and a browser that silently truncates the typed value would
 * make that rule impossible to exercise through the UI (F5-frontend.md §5).
 */
function clientValidate(): Record<string, string[]> {
  const errors: Record<string, string[]> = {}
  if (!form.name.trim()) {
    errors.name = [NAME_BLANK_MESSAGE]
  }
  return errors
}

async function onSubmit() {
  if (submitting.value) return

  const clientErrors = clientValidate()
  if (Object.keys(clientErrors).length > 0) {
    fieldErrors.value = clientErrors
    return
  }

  submitting.value = true
  baseError.value = null
  try {
    if (props.mode === 'create') {
      const payload: GroupCreatePayload = {
        name: form.name,
        // Left out of the body entirely when blank (axios drops
        // `undefined`) — the server stores NULL either way, and not sending
        // an empty string keeps "create" honest about what was filled in.
        description: form.description.trim() || undefined,
      }
      await groupsStore.createGroup(payload)
    } else {
      const payload: GroupUpdatePayload = {
        name: form.name,
        // Always sent, `''` included — PATCH is partial, so omitting the
        // field would keep the old description and make "clear the
        // description" impossible (F5-frontend.md §2).
        description: form.description,
      }
      await groupsStore.updateGroup(props.group!.id, payload)
    }
    emit('saved', { mode: props.mode, message: SUCCESS_MESSAGE[props.mode] })
  } catch (error) {
    // 404 first: the group was deleted under us (A12). Left to
    // `extractFormErrors` it would render the API's raw English "Not found"
    // as a banner; instead the parent closes the modal and refreshes.
    if (isNotFoundError(error)) {
      emit('missing')
      return
    }
    const result = extractFormErrors(error, GENERIC_ERROR_MESSAGE)
    fieldErrors.value = result.fieldErrors
    baseError.value = result.baseError
  } finally {
    submitting.value = false
  }
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
    test-id="group-form-modal"
    banner-test-id="group-form-banner"
    submit-test-id="group-form-submit"
    cancel-test-id="group-form-cancel"
    @submit="onSubmit"
    @cancel="onCancel"
  >
    <div class="field" :class="{ 'has-error': fieldErrorText('name') }">
      <label for="group-form-name">Tên group</label>
      <input
        id="group-form-name"
        v-model="form.name"
        type="text"
        data-testid="group-form-name"
        placeholder="vd. Sales Team"
        @input="clearFieldError('name')"
      />
      <span v-if="fieldErrorText('name')" class="field-error" data-testid="field-error-name">
        {{ fieldErrorText('name') }}
      </span>
    </div>

    <div class="field" :class="{ 'has-error': fieldErrorText('description') }">
      <label for="group-form-description">Mô tả <span style="font-weight: 400">(tùy chọn)</span></label>
      <textarea
        id="group-form-description"
        v-model="form.description"
        rows="3"
        data-testid="group-form-description"
        placeholder="Tối đa 500 ký tự"
        @input="clearFieldError('description')"
      ></textarea>
      <span
        v-if="fieldErrorText('description')"
        class="field-error"
        data-testid="field-error-description"
      >
        {{ fieldErrorText('description') }}
      </span>
    </div>
  </FormModal>
</template>
