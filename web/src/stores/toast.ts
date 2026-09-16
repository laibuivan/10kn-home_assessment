import { defineStore } from 'pinia'

export interface ToastItem {
  id: number
  message: string
  variant: 'success' | 'error'
}

interface ToastState {
  toasts: ToastItem[]
  nextId: number
}

const AUTO_DISMISS_MS = 3000

/**
 * Toast stack store — docs/design/F3-frontend.md §3.
 *
 * Rendered once by `ToastContainer.vue` (mounted in `AppShell.vue`), so any
 * feature can `push()` a confirmation from anywhere without knowing about
 * the UI. Each toast auto-dismisses after ~3s; `ToastContainer` also offers
 * a manual "×" to close early (UI_UX_design.md §0.1 — no dead affordance).
 * F3 only ever pushes `variant: 'success'` — `'error'` is here for later
 * features (F6/F8 async job failures) that need a toast outside a form.
 */
export const useToastStore = defineStore('toast', {
  state: (): ToastState => ({
    toasts: [],
    nextId: 1,
  }),

  actions: {
    push(message: string, variant: 'success' | 'error' = 'success') {
      const id = this.nextId++
      this.toasts.push({ id, message, variant })
      setTimeout(() => this.dismiss(id), AUTO_DISMISS_MS)
    },

    dismiss(id: number) {
      this.toasts = this.toasts.filter((toast) => toast.id !== id)
    },
  },
})
