import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import LoginView from '../views/LoginView.vue'
import DeviceListView from '../views/devices/DeviceListView.vue'
import DeviceDetailView from '../views/devices/DeviceDetailView.vue'
import GroupListView from '../views/groups/GroupListView.vue'
import GroupDetailView from '../views/groups/GroupDetailView.vue'
import PolicyListView from '../views/policies/PolicyListView.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/devices' },
    { path: '/login', name: 'login', component: LoginView },
    { path: '/devices', name: 'devices', component: DeviceListView },
    { path: '/devices/:id', name: 'device-detail', component: DeviceDetailView, props: true },
    { path: '/groups', name: 'groups', component: GroupListView },
    // Added at F6 — same shape as `device-detail`: `props: true` is declared
    // for consistency, but the component reads `route.params.id` itself.
    { path: '/groups/:id', name: 'group-detail', component: GroupDetailView, props: true },
    // Added at F7 — no `/policies/:id` (SoT OQ-7): no `GET /policies/:id`
    // route exists, and no detail page is built for it.
    { path: '/policies', name: 'policies', component: PolicyListView },
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
