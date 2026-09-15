import { createApp } from 'vue'
import { createPinia } from 'pinia'
import './styles/tokens.css'
import './styles/components.css'
import App from './App.vue'
import router from './router'
import { useAuthStore } from './stores/auth'

const app = createApp(App)
app.use(createPinia())

// Resolve any existing session BEFORE the router makes its first routing
// decision, so the guard in router/index.ts never has to guess at a stale
// isAuthenticated — see docs/design/F0-frontend.md §4.
//
// `app.use(router)` has to come *after* hydrate() resolves: installing the
// router is what kicks off the first navigation (and therefore the first
// run of the auth guard). Installing it up front meant a hard load of a
// protected URL — opening /devices directly, or F5 — was judged against an
// un-hydrated store and always bounced to /login, even with a perfectly
// valid token.
const authStore = useAuthStore()
authStore.hydrate().finally(() => {
  app.use(router)
  app.mount('#app')
})
