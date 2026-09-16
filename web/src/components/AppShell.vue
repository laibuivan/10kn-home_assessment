<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import ToastContainer from './ToastContainer.vue'

const auth = useAuthStore()
const router = useRouter()
const menuOpen = ref(false)

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
        F0 only ever has the Devices route — "active" is hard-coded here on
        purpose. F5/F7 add real Groups/Policies routes; whichever feature
        does that also has to make this nav highlight the current route
        instead (see docs/design/F0-frontend.md §5 risk note).
      -->
      <RouterLink to="/devices" class="nav-item active">
        <span class="ic">▣</span> Devices
      </RouterLink>
      <span class="nav-item future"><span class="ic">▢</span> Groups</span>
      <span class="nav-item future"><span class="ic">▢</span> Policies</span>
      <div class="sidebar-note">Groups/Policies ẩn ở F0 —<br />hiện khi F5/F7 thêm route</div>
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
