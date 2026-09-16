import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import LoginView from '../views/LoginView.vue'
import DeviceListView from '../views/devices/DeviceListView.vue'
import DeviceDetailView from '../views/devices/DeviceDetailView.vue'
import GroupListView from '../views/groups/GroupListView.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/devices' },
    { path: '/login', name: 'login', component: LoginView },
    { path: '/devices', name: 'devices', component: DeviceListView },
    { path: '/devices/:id', name: 'device-detail', component: DeviceDetailView, props: true },
    // No `/groups/:id`: F5 has no group detail page (SoT F5 OQ-5).
    { path: '/groups', name: 'groups', component: GroupListView },
  ],
})

// F0-frontend.md §3: `hydrate()` already ran (and resolved) once in main.ts
// before the router is used, so this guard can check auth state
// synchronously — no loading flicker mid-navigation.
router.beforeEach((to) => {
  const auth = useAuthStore()
  if (to.path !== '/login' && !auth.isAuthenticated) {
    return { path: '/login' }
  }
  if (to.path === '/login' && auth.isAuthenticated) {
    return { path: '/devices' }
  }
  return true
})

export default router
