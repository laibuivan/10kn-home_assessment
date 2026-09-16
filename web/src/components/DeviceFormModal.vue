<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import FormModal from './FormModal.vue'
import { useDevicesStore } from '../stores/devices'
import { extractFormErrors } from '../utils/apiError'
import {
  DEVICE_PLATFORMS,
  DEVICE_STATUSES,
  type Device,
  type DeviceCreatePayload,
  type DevicePlatform,
  type DeviceStatus,
  type DeviceUpdatePayload,
} from '../types/device'

/**
 * Feature-specific create/edit form for Device (docs/design/F3-frontend.md
 * §1/§3). Wraps `FormModal` — this component owns the fields, client-side
 * required-field validation, and the create/update API call; `FormModal`
 * only owns the modal shell.
 *
 * `mode: 'edit'` mounts with `device` already set (prefilled from the row
 * already in `store.devices` — no extra `GET` call, F3 has no `show`
 * action). The parent always mounts this with `v-if`, so switching from
 * editing one device to creating another is a fresh mount, not a state
 * reset this component has to manage itself.
 */
const props = withDefaults(
  defineProps<{
    mode: 'create' | 'edit'
    device?: Device | null
  }>(),
  { device: null },
)

const emit = defineEmits<{
  saved: [payload: { mode: 'create' | 'edit'; message: string }]
  cancel: []
}>()

const GENERIC_ERROR_MESSAGE = 'Có lỗi xảy ra, vui lòng thử lại.'
const SUCCESS_MESSAGE: Record<'create' | 'edit', string> = {
  create: 'Đã tạo device',
  edit: 'Đã cập nhật device',
}

const devicesStore = useDevicesStore()

interface FormState {
  identifier: string
  name: string
  platform: DevicePlatform | ''
  os_version: string
  status: DeviceStatus | ''
}

function buildInitialForm(): FormState {
  if (props.mode === 'edit' && props.device) {
    return {
      identifier: props.device.identifier,
      name: props.device.name,
      platform: props.device.platform,
      os_version: props.device.os_version ?? '',
      status: props.device.status,
    }
  }
  return { identifier: '', name: '', platform: '', os_version: '', status: '' }
}

const form = reactive<FormState>(buildInitialForm())
const fieldErrors = ref<Record<string, string[]>>({})
const baseError = ref<string | null>(null)
const submitting = ref(false)

const title = computed(() => (props.mode === 'create' ? 'Thêm Device' : 'Sửa Device'))

function fieldErrorText(field: string): string | null {
  return fieldErrors.value[field]?.[0] ?? null
}

/**
 * Clears only the given field's server/client error — NOT `baseError`
 * (F3-frontend.md §2: editing one input doesn't retroactively fix a
 * whole-request rejection like the retired-block banner).
 */
function clearFieldError(field: string) {
  if (!(field in fieldErrors.value)) return
  const next = { ...fieldErrors.value }
  delete next[field]
  fieldErrors.value = next
}

function clientValidate(): Record<string, string[]> {
  const errors: Record<string, string[]> = {}
  if (props.mode === 'create' && !form.identifier.trim()) {
    errors.identifier = ["can't be blank"]
  }
  if (!form.name.trim()) {
    errors.name = ["can't be blank"]
  }
  if (!form.platform) {
    errors.platform = ["can't be blank"]
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
      const payload: DeviceCreatePayload = {
        identifier: form.identifier,
        name: form.name,
        platform: form.platform as DevicePlatform,
        os_version: form.os_version.trim() || undefined,
      }
      await devicesStore.createDevice(payload)
    } else {
      const payload: DeviceUpdatePayload = {
        name: form.name,
        platform: form.platform as DevicePlatform,
        os_version: form.os_version.trim() || undefined,
        status: form.status as DeviceStatus,
      }
      await devicesStore.updateDevice(props.device!.id, payload)
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

function onCancel() {
  emit('cancel')
}
</script>

<template>
  <FormModal
    :title="title"
    :submitting="submitting"
    :base-error="baseError"
    test-id="device-form-modal"
    banner-test-id="device-form-banner"
    submit-test-id="device-form-submit"
    cancel-test-id="device-form-cancel"
    @submit="onSubmit"
    @cancel="onCancel"
  >
    <div class="field" :class="{ 'has-error': fieldErrorText('identifier') }">
      <label for="device-form-identifier">Identifier</label>
      <input
        id="device-form-identifier"
        v-model="form.identifier"
        type="text"
        data-testid="device-form-identifier"
        placeholder="vd. IPHONE-042"
        :disabled="mode === 'edit'"
        @input="clearFieldError('identifier')"
      />
      <span v-if="fieldErrorText('identifier')" class="field-error" data-testid="field-error-identifier">
        {{ fieldErrorText('identifier') }}
      </span>
    </div>

    <div class="field" :class="{ 'has-error': fieldErrorText('name') }">
      <label for="device-form-name">Name</label>
      <input
        id="device-form-name"
        v-model="form.name"
        type="text"
        data-testid="device-form-name"
        placeholder="vd. iPhone của Alice"
        @input="clearFieldError('name')"
      />
      <span v-if="fieldErrorText('name')" class="field-error" data-testid="field-error-name">
        {{ fieldErrorText('name') }}
      </span>
    </div>

    <div class="field" :class="{ 'has-error': fieldErrorText('platform') }">
      <label for="device-form-platform">Platform</label>
      <select
        id="device-form-platform"
        v-model="form.platform"
        data-testid="device-form-platform"
        @change="clearFieldError('platform')"
      >
        <option v-if="mode === 'create'" value="">-- Chọn --</option>
        <option v-for="platform in DEVICE_PLATFORMS" :key="platform" :value="platform">{{ platform }}</option>
      </select>
      <span v-if="fieldErrorText('platform')" class="field-error" data-testid="field-error-platform">
        {{ fieldErrorText('platform') }}
      </span>
    </div>

    <div class="field" :class="{ 'has-error': fieldErrorText('os_version') }">
      <label for="device-form-os-version">OS Version <span style="font-weight: 400">(tùy chọn)</span></label>
      <input
        id="device-form-os-version"
        v-model="form.os_version"
        type="text"
        data-testid="device-form-os-version"
        placeholder="vd. 17.4.1"
        @input="clearFieldError('os_version')"
      />
      <span v-if="fieldErrorText('os_version')" class="field-error" data-testid="field-error-os_version">
        {{ fieldErrorText('os_version') }}
      </span>
    </div>

    <div v-if="mode === 'edit'" class="field" :class="{ 'has-error': fieldErrorText('status') }">
      <label for="device-form-status">Status</label>
      <select
        id="device-form-status"
        v-model="form.status"
        data-testid="device-form-status"
        @change="clearFieldError('status')"
      >
        <option v-for="status in DEVICE_STATUSES" :key="status" :value="status">{{ status }}</option>
      </select>
      <span v-if="fieldErrorText('status')" class="field-error" data-testid="field-error-status">
        {{ fieldErrorText('status') }}
      </span>
    </div>
  </FormModal>
</template>
