import { createApp } from 'vue'
import { createPinia } from 'pinia'
import './styles/tokens.css'
import './styles/components.css'
import App from './App.vue'
import router from './router'
import { useAuthStore } from './stores/auth'

const app = createApp(App)
app.use(createPinia())
app.use(router)

// Resolve any existing session BEFORE the router makes its first routing
// decision, so the guard in router/index.ts never has to guess at a stale
// isAuthenticated — see docs/design/F0-frontend.md §4.
const authStore = useAuthStore()
authStore.hydrate().finally(() => {
  app.mount('#app')
})
