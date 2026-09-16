<script setup lang="ts">
/**
 * Renders the toast stack (docs/design/F3-frontend.md §1) — mounted once in
 * `AppShell.vue` so every post-login page shares it. Each toast also has a
 * manual "×" so the user doesn't have to wait out the ~3s auto-dismiss
 * (UI_UX_design.md §0.1 — no dead affordance).
 */
import { useToastStore } from '../stores/toast'

const toastStore = useToastStore()
</script>

<template>
  <div class="toast-stack">
    <div
      v-for="toast in toastStore.toasts"
      :key="toast.id"
      class="toast"
      :class="toast.variant"
      data-testid="toast"
    >
      <span>{{ toast.message }}</span>
      <button
        type="button"
        aria-label="Đóng"
        style="background: none; border: none; cursor: pointer; color: inherit; font-size: 14px; line-height: 1; padding: 0"
        @click="toastStore.dismiss(toast.id)"
      >
        ×
      </button>
    </div>
  </div>
</template>
