<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import ToastContainer from './ToastContainer.vue'

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()
const menuOpen = ref(false)

/**
 * Which sidebar section is highlighted (F5-frontend.md §2.2 / OQ-FE-3).
 *
 * RouterLink's own `active-class` was the first choice, but it only matches
 * when the current route's matched record IS the link's target: `/devices`
 * and `/devices/:id` are two sibling top-level records, not nested ones, so
 * the Devices item went dark on F4's detail page — exactly the regression
 * OQ-FE-3 set out to avoid. The alternative that OQ-FE-3 spells out for
 * this case is a path prefix test, which is what this is (`startsWith`,
 * never `===`). The trailing "/" keeps a future `/devices-archive` from
 * lighting up Devices.
 */
function isSectionActive(prefix: string): boolean {
  return route.path === prefix || route.path.startsWith(`${prefix}/`)
}

function toggleMenu() {
  menuOpen.value = !menuOpen.value
}

function closeMenuOnOutsideClick(event: MouseEvent) {
  const target = event.target as HTMLElement
  if (!target.closest('.user-menu')) menuOpen.value = false
}

onMounted(() => document.addEventListener('click', closeMenuOnOutsideClick))
onUnmounted(() => document.removeEventListener('click', closeMenuOnOutsideClick))

function logout() {
  menuOpen.value = false
  auth.logout()
  router.push('/login')
}
</script>

<template>
  <div class="shell">
    <aside class="sidebar">
      <div class="brand">
        <span class="mark">DC</span>
        <span class="name">Device Console</span>
      </div>
      <!--
        Only Policies is still a placeholder — it becomes a link when F7
        adds the route. Highlighting: see `isSectionActive` above.
      -->
      <RouterLink
        to="/devices"
        class="nav-item"
        :class="{ active: isSectionActive('/devices') }"
        data-testid="nav-devices"
      >
        <span class="ic">▣</span> Devices
      </RouterLink>
      <RouterLink
        to="/groups"
        class="nav-item"
        :class="{ active: isSectionActive('/groups') }"
        data-testid="nav-groups"
      >
        <span class="ic">▣</span> Groups
      </RouterLink>
      <span class="nav-item future"><span class="ic">▢</span> Policies</span>
      <div class="sidebar-note">Policies hiện khi F7 thêm route</div>
    </aside>

    <div class="shell-main">
      <div class="topbar">
        <span class="org-pill">
          <span class="ic">◆</span>
          <span data-testid="org-name">{{ auth.organization?.name }}</span>
        </span>
        <div class="user-menu">
          <button class="user-btn" type="button" @click="toggleMenu">
            {{ auth.user?.email }} ▾
          </button>
          <div class="user-dd" :class="{ open: menuOpen }">
            <button type="button" @click="logout">Đăng xuất</button>
          </div>
        </div>
      </div>
      <div class="shell-content">
        <slot />
      </div>
    </div>
  </div>

  <ToastContainer />
</template>
