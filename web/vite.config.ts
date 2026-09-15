import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  server: {
    // Reachable from other containers in docker-compose (bind 0.0.0.0).
    host: true,
    port: 5173,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    // No specs exist yet (skeleton only) — don't fail `/gate` until F0+ adds some.
    passWithNoTests: true,
  },
})
