<script setup lang="ts">
/**
 * Shared status pill (UI_UX_design.md §8). Reuses the `.badge.<status>`
 * classes already in components.css. Kept string-typed rather than
 * Device-specific so Group/Policy statuses can render through it too.
 */
defineProps<{
  status: string
  label?: string
}>()
</script>

<template>
  <span class="badge" :class="status">{{ label ?? status }}</span>
</template>
