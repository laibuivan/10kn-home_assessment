<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { useJobsStore } from '../stores/jobs'
import ToastContainer from './ToastContainer.vue'
import AsyncJobBanner from './AsyncJobBanner.vue'

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()
const jobsStore = useJobsStore()
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
      <!-- Highlighting: see `isSectionActive` above. -->
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
      <!-- F7 pays off the last F0/F5 nav placeholder — Policies is now a
           real link, same pattern as Devices/Groups above. -->
      <RouterLink
        to="/policies"
        class="nav-item"
        :class="{ active: isSectionActive('/policies') }"
        data-testid="nav-policies"
      >
        <span class="ic">▢</span> Policies
      </RouterLink>
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

  <!-- F8 — mounted once here (not per-view): a job can be started from
       either Group Detail or Policy Detail, and must keep being tracked
       across a route change between the two (F8-frontend.md §2.3). -->
  <div class="job-banner-stack" data-testid="job-banner-stack">
    <AsyncJobBanner
      v-for="job in jobsStore.jobs"
      :key="job.id"
      :job="job"
      @retry="jobsStore.retry(job)"
      @dismiss="jobsStore.dismiss(job.id)"
    />
  </div>
</template>
