<script setup lang="ts">
/**
 * Shared empty state (UI_UX_design.md §8/§9). Deliberately generic so every
 * list/detail screen from F2 onward reuses it: the caller supplies the copy
 * and — optionally — a CTA through the default slot (F2's A2 variant passes
 * a "Xóa lọc" button; A1 passes nothing, because F2 has no "create" action
 * yet and a dead CTA is forbidden by UI_UX_design.md §0.1).
 */
withDefaults(
  defineProps<{
    title: string
    description?: string
    icon?: string
  }>(),
  { description: '', icon: '▣' },
)
</script>

<template>
  <div class="placeholder-box" data-testid="empty-state">
    <span class="ic" aria-hidden="true">{{ icon }}</span>
    <strong>{{ title }}</strong>
    <span v-if="description">{{ description }}</span>
    <slot />
  </div>
</template>
