<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'

/**
 * Shared "⋯" row-actions dropdown (docs/design/F4-frontend.md §1) — replaces
 * F3's standalone "Sửa" button on the Devices list so the same row also
 * exposes "Xem chi tiết" (OQ-2). Built once as a generic component so
 * Groups/Policies lists (F5/F7) can reuse it unchanged (UI_UX_design.md
 * §6.1 also specs a "⋯" column).
 *
 * Each row mounts its own instance — outside-click/`Escape` closes just
 * that instance, same mechanism `AppShell.vue`'s `.user-menu` already uses.
 * Clicking a second row's trigger closes the first instance naturally (its
 * own outside-click listener fires) before the second opens.
 */
export interface ActionsMenuItem {
  key: string
  label: string
  onClick: () => void
  disabled?: boolean
  disabledTitle?: string
  testId?: string
}

defineProps<{
  items: ActionsMenuItem[]
}>()

const open = ref(false)
const rootEl = ref<HTMLElement | null>(null)

function toggle() {
  open.value = !open.value
}

function selectItem(item: ActionsMenuItem) {
  if (item.disabled) return
  item.onClick()
  open.value = false
}

function onOutsideClick(event: MouseEvent) {
  if (!open.value) return
  const target = event.target as HTMLElement
  if (rootEl.value && !rootEl.value.contains(target)) open.value = false
}

function onEscape(event: KeyboardEvent) {
  if (event.key === 'Escape') open.value = false
}

onMounted(() => {
  document.addEventListener('click', onOutsideClick)
  document.addEventListener('keydown', onEscape)
})
onUnmounted(() => {
  document.removeEventListener('click', onOutsideClick)
  document.removeEventListener('keydown', onEscape)
})
</script>

<template>
  <span ref="rootEl" style="position: relative; display: inline-block">
    <button type="button" class="dropdown-trigger" data-testid="actions-menu-trigger" @click="toggle">⋯</button>
    <div class="dropdown-menu" :class="{ open }">
      <span
        v-for="item in items"
        :key="item.key"
        class="tooltip-wrap"
        :title="item.disabled ? item.disabledTitle : undefined"
        :data-testid="item.testId ? `${item.testId}-tooltip` : undefined"
      >
        <button
          type="button"
          class="dropdown-item"
          :data-testid="item.testId"
          :disabled="item.disabled"
          @click="selectItem(item)"
        >
          {{ item.label }}
        </button>
      </span>
    </div>
  </span>
</template>
