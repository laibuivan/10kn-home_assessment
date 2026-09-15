<script setup lang="ts">
// Root is intentionally just the router outlet — main.ts already resolves
// the initial auth hydrate() before mounting (see docs/design/F0-frontend.md
// §4), so there's no loading state to render here.
</script>

<template>
  <RouterView />
</template>
