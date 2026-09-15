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
  // Scenarios share one running Postgres/Rails stack (docker compose, no
  // per-worker DB) and create fixtures straight into it via `rails runner` —
  // there is no transactional rollback or isolation between scenarios, let
  // alone between workers. Any scenario asserting a *global* count (e.g.
  // F0's "running the seed script twice") is racy against other scenarios
  // creating Organizations/Users concurrently. `workers: 1` trades suite
  // wall-clock time for correctness, which fits a shared-mutable-DB setup.
  fullyParallel: false,
  workers: 1,
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
