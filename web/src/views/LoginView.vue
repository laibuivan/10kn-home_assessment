<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore, type ApiErrorBody } from '../stores/auth'

const router = useRouter()
const auth = useAuthStore()

const email = ref('')
const password = ref('')
const showPassword = ref(false)
const submitting = ref(false)
const errorMessage = ref('')

// docs/design/F0-api.md §0: 401 -> {"error": "..."}, 422 -> {"errors": {...}}.
// Both render into the same banner here — SoT F0-foundation.md §12 OQ-1: a
// single generic message covers every login failure reason on purpose.
function extractErrorMessage(body: ApiErrorBody | undefined): string {
  if (body?.error) return body.error
  const firstFieldErrors = body?.errors && Object.values(body.errors)[0]
  if (firstFieldErrors?.[0]) return firstFieldErrors[0]
  return 'Không thể kết nối máy chủ, thử lại sau.'
}

async function handleSubmit() {
  errorMessage.value = ''
  submitting.value = true
  try {
    await auth.login(email.value, password.value)
    router.push('/devices')
  } catch (err) {
    const response = (err as { response?: { data?: ApiErrorBody } }).response
    errorMessage.value = extractErrorMessage(response?.data)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="login-stage">
    <div class="login-card">
      <div class="brand">
        <span class="mark">DC</span>
        <span class="name">Device Console</span>
      </div>

      <form class="card-body" novalidate @submit.prevent="handleSubmit">
        <h3>Đăng nhập</h3>

        <div class="field">
          <label for="email">Email</label>
          <input
            id="email"
            v-model="email"
            type="email"
            placeholder="admin@acme.example"
            autocomplete="username"
            required
          />
        </div>

        <div class="field">
          <label for="password">Mật khẩu</label>
          <div class="pw-row">
            <input
              id="password"
              v-model="password"
              :type="showPassword ? 'text' : 'password'"
              placeholder="••••••••"
              autocomplete="current-password"
              required
            />
            <button type="button" class="pw-toggle" @click="showPassword = !showPassword">
              {{ showPassword ? 'ẨN' : 'HIỆN' }}
            </button>
          </div>
        </div>

        <div v-if="errorMessage" class="error-banner" data-testid="login-error">
          <span aria-hidden="true">⚠</span>
          <span>{{ errorMessage }}</span>
        </div>

        <button
          type="submit"
          class="submit-btn"
          data-testid="login-submit"
          :disabled="submitting"
          :data-busy="submitting"
        >
          <span class="btn-label">Đăng nhập</span>
          <span class="spinner" aria-hidden="true"></span>
        </button>
      </form>
    </div>
  </div>
</template>
