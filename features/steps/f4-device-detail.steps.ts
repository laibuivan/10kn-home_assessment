import { createBdd } from 'playwright-bdd'
import { execSync } from 'node:child_process'
import { writeFileSync, unlinkSync, mkdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import type { Page } from '@playwright/test'
import { test, expect } from './fixtures'

const { Given, When, Then } = createBdd(test)

const REPO_ROOT = process.cwd()
const API_TMP_DIR = path.join(REPO_ROOT, 'api', 'tmp')
const API_URL = process.env.API_URL ?? 'http://localhost:3010'

/**
 * Target UI contract this file drives — NOT implemented yet (F4 is the first
 * feature to add the `/devices/:id` route; see docs/design/F4-frontend.md
 * §1/§2). Listed here so `slice-implementer` knows exactly which
 * data-testid hooks to wire up on the new `DeviceDetailView.vue` +
 * `ActionsMenu.vue`, and the extension to `DeviceListView.vue`'s `actions`
 * column:
 *
 *   [data-testid=device-detail-identifier]              identifier in the detail header
 *   [data-testid=device-detail-name]                    name in the detail header
 *   [data-testid=device-detail-status]                  StatusBadge in the detail header
 *   [data-testid=device-detail-edit-button]              "Sửa" — absent entirely (not disabled) when the device is retired
 *   [data-testid=device-detail-retired-banner]           neutral banner shown only when the device is retired
 *   [data-testid=device-detail-groups-empty]             "Groups đang thuộc" block (always the static empty text at F4)
 *   [data-testid=device-detail-policies-empty]           "Policy đang áp dụng" block (always the static empty text at F4)
 *   [data-testid=device-detail-back-link]                "◀ Quay lại danh sách" — both in the normal header AND inside the 404 empty-state slot
 *   [data-testid=empty-state]                            reused EmptyState component — full-page 404 (not-found id / cross-org / malformed id)
 *   [data-testid=error-banner] [data-testid=retry-button] reused ErrorState component — infra error while loading
 *   [data-testid=devices-table] [data-testid=device-row] [data-testid=actions-menu-trigger]  "⋯" trigger per row (replaces F3's standalone "Sửa" button)
 *   [data-testid=devices-table] [data-testid=device-row] [data-testid=device-action-edit]    "Sửa" item inside the row's actions menu
 *   [data-testid=devices-table] [data-testid=device-row] [data-testid=device-action-view]    "Xem chi tiết" item inside the row's actions menu
 */

// ---------- Rails-runner fixture plumbing (same pattern as f0/f2/f3 steps) ----------

function runRailsScript(ruby: string): string {
  mkdirSync(API_TMP_DIR, { recursive: true })
  const name = `e2e_${randomUUID()}.rb`
  const hostPath = path.join(API_TMP_DIR, name)
  writeFileSync(hostPath, ruby)
  try {
    return execSync(`docker compose exec -T api bin/rails runner tmp/${name}`, {
      cwd: REPO_ROOT,
      encoding: 'utf-8',
    })
  } finally {
    unlinkSync(hostPath)
  }
}

const rubyStr = (s: string) => JSON.stringify(s)

function ensureUser(orgName: string, email: string, password: string, status: 'active' | 'inactive') {
  runRailsScript(`
    org = Organization.find_or_create_by!(name: ${rubyStr(orgName)})
    user = User.find_or_initialize_by(organization: org, email: ${rubyStr(email)})
    user.password = ${rubyStr(password)}
    user.status = ${rubyStr(status)}
    user.save!
  `)
}

function getDeviceId(orgName: string, identifier: string): number {
  const out = runRailsScript(`
    org = Organization.find_by!(name: ${rubyStr(orgName)})
    d = Device.find_by!(organization: org, identifier: ${rubyStr(identifier)})
    puts d.id
  `)
  const lines = out.trim().split('\n')
  return parseInt(lines[lines.length - 1], 10)
}

async function apiLogin(request: import('@playwright/test').APIRequestContext, email: string, password: string): Promise<string> {
  const res = await request.post(`${API_URL}/api/v1/sessions`, { data: { email, password } })
  const body = await res.json()
  return body.token
}

async function safeJson(res: { json: () => Promise<any> }): Promise<any> {
  try {
    return await res.json()
  } catch {
    return undefined
  }
}

function deviceRow(page: Page, identifier: string) {
  return page.locator('[data-testid=devices-table] [data-testid=device-row]').filter({ hasText: identifier })
}

function waitForDeviceWriteResponse(page: Page, method: 'POST' | 'PATCH') {
  return page.waitForResponse(
    (res) => res.request().method() === method && res.url().includes('/api/v1/devices'),
    { timeout: 5_000 },
  )
}

// ================= Given (fixtures) =================

Given('the device-detail API is returning a server error', async ({ page }) => {
  // `**/api/v1/devices/*` (a path segment after `devices/`) matches only the
  // single-device GET, never the list endpoint (`/api/v1/devices` or
  // `/api/v1/devices?...`) — same distinguishing trick as F2/F3's route
  // interceptors, scoped to this one new endpoint.
  await page.route('**/api/v1/devices/*', (route) => {
    if (route.request().method() === 'GET') {
      route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Internal server error' }) })
    } else {
      route.continue()
    }
  })
})

// ================= When =================

When('I open the detail page for device {string}', async ({ page, world }, identifier: string) => {
  const org = Object.values(world.orgs ?? {})[0]
  if (!org) throw new Error('no org fixture in world')
  const id = getDeviceId(org.name, identifier)
  world.lastCreatedIdentifier = identifier
  await page.goto(`/devices/${id}`)
})

When('I open the detail page for a device id that does not exist', async ({ page }) => {
  await page.goto('/devices/999999999')
})

When('I open the detail page for a malformed device id', async ({ page }) => {
  await page.goto('/devices/not-a-number')
})

When('I click the Edit button on the detail page', async ({ page }) => {
  await page.locator('[data-testid=device-detail-edit-button]').click()
})

When('I edit that device from the detail page, changing its status to {string}', async ({ page }, status: string) => {
  await page.locator('[data-testid=device-detail-edit-button]').click()
  await page.locator('[data-testid=device-form-modal]').waitFor({ state: 'visible', timeout: 5_000 })
  const responseWait = waitForDeviceWriteResponse(page, 'PATCH')
  await page.locator('[data-testid=device-form-status]').selectOption(status)
  await page.locator('[data-testid=device-form-submit]').click()
  await responseWait
})

When('I click the row for device {string}', async ({ page }, identifier: string) => {
  await deviceRow(page, identifier).locator('[data-field=identifier]').click()
})

When('I choose {string} from the row actions for device {string}', async ({ page }, action: string, identifier: string) => {
  const row = deviceRow(page, identifier)
  await row.locator('[data-testid=actions-menu-trigger]').click()
  const testId = action === 'Xem chi tiết' ? 'device-action-view' : 'device-action-edit'
  await row.locator(`[data-testid=${testId}]`).click()
})

When('I navigate directly to the detail page URL for device {string}', async ({ page, world }, identifier: string) => {
  const org = Object.values(world.orgs ?? {})[0]
  if (!org) throw new Error('no org fixture in world')
  const id = getDeviceId(org.name, identifier)
  world.lastCreatedIdentifier = identifier
  await page.goto(`/devices/${id}`)
})

When('I click the row for the first device on that page', async ({ page }) => {
  const firstRow = page.locator('[data-testid=devices-table] [data-testid=device-row]').first()
  await firstRow.locator('[data-field=identifier]').click()
})

When('I click the back-to-list link on the detail page', async ({ page }) => {
  await page.locator('[data-testid=device-detail-back-link]').click()
})

When(
  'I call the device-detail API as {string} for the device with identifier {string}',
  async ({ request, world }, label: string, identifier: string) => {
    const org = world.orgs?.[label]
    const deviceId = world.deviceIdsByIdentifier?.[identifier]
    if (!org) throw new Error(`no org fixture for label "${label}"`)
    if (deviceId === undefined) throw new Error(`no device id fixture for identifier "${identifier}"`)
    const token = await apiLogin(request, org.email, org.password)
    const res = await request.get(`${API_URL}/api/v1/devices/${deviceId}`, { headers: { Authorization: `Bearer ${token}` } })
    world.lastStatus = res.status()
    world.lastBody = await safeJson(res)
  },
)

When(
  'I call the device-detail API for the device with identifier {string} without an authentication token',
  async ({ request, world }, identifier: string) => {
    const deviceId = world.deviceIdsByIdentifier?.[identifier]
    if (deviceId === undefined) throw new Error(`no device id fixture for identifier "${identifier}"`)
    const res = await request.get(`${API_URL}/api/v1/devices/${deviceId}`)
    world.lastStatus = res.status()
    world.lastBody = await safeJson(res)
  },
)

When('I call the device-detail API for the device with identifier {string} using that token', async ({ request, world }, identifier: string) => {
  const deviceId = world.deviceIdsByIdentifier?.[identifier]
  if (deviceId === undefined) throw new Error(`no device id fixture for identifier "${identifier}"`)
  const res = await request.get(`${API_URL}/api/v1/devices/${deviceId}`, {
    headers: { Authorization: `Bearer ${world.token}` },
  })
  world.lastStatus = res.status()
  world.lastBody = await safeJson(res)
})

When('I navigate directly to the detail page URL for device {string} while not logged in', async ({ page, world }, identifier: string) => {
  const org = Object.values(world.orgs ?? {})[0]
  if (!org) throw new Error('no org fixture in world')
  const id = getDeviceId(org.name, identifier)
  await page.goto(`/devices/${id}`)
})

// ================= Then =================

Then("I see the device's full information for {string}", async ({ page }, identifier: string) => {
  await expect(page.locator('[data-testid=device-detail-identifier]')).toContainText(identifier, { timeout: 5_000 })
  await expect(page.locator('[data-testid=device-detail-name]')).toBeVisible({ timeout: 5_000 })
  await expect(page.locator('[data-testid=device-detail-status]')).toBeVisible({ timeout: 5_000 })
})

Then('I see the message {string} in the Groups block', async ({ page }, message: string) => {
  await expect(page.locator('[data-testid=device-detail-groups-empty]')).toContainText(message, { timeout: 5_000 })
})

Then('I see the message {string} in the Policy block', async ({ page }, message: string) => {
  await expect(page.locator('[data-testid=device-detail-policies-empty]')).toContainText(message, { timeout: 5_000 })
})

Then('I see a button to go back to the list', async ({ page }) => {
  await expect(page.locator('[data-testid=device-detail-back-link]')).toBeVisible({ timeout: 5_000 })
})

Then('I do not see a working Edit button on the detail page', async ({ page }) => {
  await expect(page.locator('[data-testid=device-detail-edit-button]')).toHaveCount(0, { timeout: 5_000 })
})

Then('I see the banner {string} on the detail page', async ({ page }, message: string) => {
  await expect(page.locator('[data-testid=device-detail-retired-banner]')).toContainText(message, { timeout: 5_000 })
})

Then("the edit form opens prefilled with device {string}'s data", async ({ page }, identifier: string) => {
  await page.locator('[data-testid=device-form-modal]').waitFor({ state: 'visible', timeout: 5_000 })
  await expect(page.locator('[data-testid=device-form-identifier]')).toHaveValue(identifier, { timeout: 5_000 })
})

Then('I see an error banner with a {string} button on the detail page', async ({ page }, label: string) => {
  await expect(page.locator('[data-testid=error-banner]')).toBeVisible({ timeout: 5_000 })
  await expect(page.locator('[data-testid=retry-button]')).toContainText(label, { timeout: 5_000 })
})

Then('I am redirected to the login page', async ({ page }) => {
  await expect(page).toHaveURL(/\/login/, { timeout: 5_000 })
})

/**
 * Reads `last_seen_at` back through a fresh, independent API call (not the
 * page the scenario already loaded) — proves the value was actually
 * persisted server-side by viewing the detail page, not just rendered in
 * the DOM (F4 follow-up: `Device#record_seen!`).
 */
async function fetchLastSeenAt(request: import('@playwright/test').APIRequestContext, world: import('./fixtures').World, identifier: string): Promise<string | null> {
  const org = Object.values(world.orgs ?? {})[0]
  if (!org) throw new Error('no org fixture in world')
  const deviceId = getDeviceId(org.name, identifier)
  const token = await apiLogin(request, org.email, org.password)
  const res = await request.get(`${API_URL}/api/v1/devices/${deviceId}`, { headers: { Authorization: `Bearer ${token}` } })
  const parsed = await safeJson(res)
  return parsed?.device?.last_seen_at ?? null
}

Then('last_seen_at for device {string} is now very recent', async ({ request, world }, identifier: string) => {
  const lastSeenAt = await fetchLastSeenAt(request, world, identifier)
  expect(lastSeenAt).not.toBeNull()
  expect(Date.now() - new Date(lastSeenAt!).getTime()).toBeLessThan(30_000)
})

Then('last_seen_at for device {string} was not updated', async ({ request, world }, identifier: string) => {
  const lastSeenAt = await fetchLastSeenAt(request, world, identifier)
  // The fixture (`Device.create!` via rails runner, not the RSpec factory)
  // never sets last_seen_at, so it starts out null — viewing a retired
  // device must leave it that way.
  expect(lastSeenAt).toBeNull()
})

/**
 * Distinguishes a real org-scoped 404 (ApplicationController's
 * `render_not_found`, F4-api.md §3: `{ "error": "Not found" }`) from a
 * coincidental 404 that Rails' default routing-error page also happens to
 * return for an unmatched route before `:show` exists — both are status
 * 404, but only one has this exact body. Without this assertion the
 * cross-org scenario would look falsely green before the feature is built.
 */
Then('the response body says {string}', async ({ world }, message: string) => {
  expect(world.lastBody?.error).toBe(message)
})
