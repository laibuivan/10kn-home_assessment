import { defineConfig, devices } from '@playwright/test'
import { defineBddConfig } from 'playwright-bdd'

// Acceptance suite drives the REAL stack (api + web) already up via
// `docker compose up --build -d` — no webServer block here on purpose, see
// README/skill "verify". API base used directly by API-only steps; UI steps
// go through `baseURL`.
const testDir = defineBddConfig({
  features: 'features/**/*.feature',
  steps: 'features/steps/**/*.ts',
})

export default defineConfig({
  testDir,
  fullyParallel: true,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.WEB_URL ?? 'http://localhost:5173',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
})
