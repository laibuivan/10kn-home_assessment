import { createBdd } from 'playwright-bdd'
import { execSync } from 'node:child_process'
import { writeFileSync, unlinkSync, mkdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import type { APIRequestContext, Page } from '@playwright/test'
import { test, expect } from './fixtures'
import type { DeviceSpec, OrgFixture } from './fixtures'

const { Given, When, Then } = createBdd(test)

const REPO_ROOT = process.cwd()
const API_TMP_DIR = path.join(REPO_ROOT, 'api', 'tmp')
const API_URL = process.env.API_URL ?? 'http://localhost:3010'

/**
 * F2-api.md §1 (approved) — decided contract this suite asserts against:
 *   default per_page = 20, max per_page (server clamp) = 100.
 */
const DEFAULT_PAGE_SIZE = 20
const MAX_PAGE_SIZE = 100

/**
 * Target UI contract this file drives — NOT implemented yet (F2 is still the
 * F0 placeholder, see web/src/views/devices/DeviceListView.vue). Listed here
 * so `slice-implementer` knows exactly which data-testid/data-field hooks to
 * wire up on DeviceListView.vue + its FilterBar/DataTable/PaginationBar/
 * EmptyState/ErrorState children (docs/design/F2-frontend.md §1):
 *
 *   [data-testid=devices-table]                 <table> with real device rows
 *   [data-testid=devices-table] [data-testid=device-row]   one per device, each containing:
 *     [data-field=identifier|name|platform|os_version|status|last_seen_at]
 *   [data-testid=filter-platform]               <select> Platform filter
 *   [data-testid=filter-status]                 <select> Status filter
 *   [data-testid=filter-clear-button]           "Xóa lọc" in the filter bar (only rendered while a filter is active)
 *   [data-testid=empty-state]                   empty-state container (text)
 *   [data-testid=empty-state-clear-button]      "Xóa lọc" inside the empty state (A2 only)
 *   [data-testid=error-banner]                  error banner container (A11)
 *   [data-testid=retry-button]                  "Thử lại" inside the error banner
 *   [data-testid=pagination-info]               "Hiển thị x–y / tổng" text
 *   [data-testid=pagination-page-indicator]     "Trang N / M" text
 */

// ---------- Rails-runner fixture plumbing (same pattern as f0-foundation.steps.ts) ----------

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
const rubyOrNil = (s: string | null | undefined) => (s == null ? 'nil' : `Time.parse(${rubyStr(s)})`)

function ensureUser(orgName: string, email: string, password: string, status: 'active' | 'inactive') {
  runRailsScript(`
    org = Organization.find_or_create_by!(name: ${rubyStr(orgName)})
    user = User.find_or_initialize_by(organization: org, email: ${rubyStr(email)})
    user.password = ${rubyStr(password)}
    user.status = ${rubyStr(status)}
    user.save!
  `)
}

/**
 * Creates a brand-new, uniquely-named organization + active user so device
 * counts/totals asserted by a scenario can never be polluted by another
 * scenario running in parallel (`fullyParallel: true`) against a shared org
 * name. `label` is only used for the fixture's human-readable name prefix —
 * scenario steps must read the real name back from `world.orgs[label]`.
 *
 * NOTE (expected to fail until F2 is implemented): `Device` does not exist
 * yet in api/app/models — any step that goes on to create devices via
 * `createDevices` below will raise `NameError: uninitialized constant
 * Device` inside the rails runner. That is the intended RED reason.
 */
function createOrgWithUser(label: string, password = 'Password123!'): OrgFixture {
  const suffix = randomUUID().slice(0, 8)
  const name = `${label} ${suffix}`
  const email = `f2.${suffix}@example.test`
  ensureUser(name, email, password, 'active')
  return { name, email, password }
}

function createDevices(orgName: string, specs: DeviceSpec[]): void {
  if (specs.length === 0) return
  const rows = specs
    .map(
      (s) =>
        `{ identifier: ${rubyStr(s.identifier)}, name: ${rubyStr(s.name)}, platform: ${rubyStr(s.platform)}, status: ${rubyStr(s.status)}, last_seen_at: ${rubyOrNil(s.lastSeenAt)} }`,
    )
    .join(",\n      ")
  runRailsScript(`
    org = Organization.find_or_create_by!(name: ${rubyStr(orgName)})
    rows = [
      ${rows}
    ]
    rows.each do |row|
      Device.find_or_create_by!(organization: org, identifier: row[:identifier]) do |d|
        d.name = row[:name]
        d.platform = row[:platform]
        d.status = row[:status]
        d.last_seen_at = row[:last_seen_at]
      end
    end
  `)
}

/** Deterministically cycles through all 9 platform/status combos. Used where the exact mix doesn't matter, only the count. */
function genDevicesFlat(prefix: string, count: number): DeviceSpec[] {
  const platforms = ['ios', 'android', 'macos']
  const statuses = ['active', 'inactive', 'retired']
  const specs: DeviceSpec[] = []
  for (let i = 1; i <= count; i++) {
    const id = `${prefix}-${String(i).padStart(5, '0')}`
    specs.push({
      identifier: id,
      name: id,
      platform: platforms[i % platforms.length],
      status: statuses[i % statuses.length],
    })
  }
  return specs
}

/** Builds an exact, controlled mix of platform/status combos (for filter scenarios that assert precise counts). */
function buildDeviceSet(prefix: string, rows: Array<{ platform: string; status: string; count: number }>): DeviceSpec[] {
  const specs: DeviceSpec[] = []
  let i = 1
  for (const row of rows) {
    for (let j = 0; j < row.count; j++) {
      const id = `${prefix}-${String(i).padStart(5, '0')}`
      specs.push({ identifier: id, name: id, platform: row.platform, status: row.status })
      i++
    }
  }
  return specs
}

async function apiLogin(request: APIRequestContext, email: string, password: string): Promise<string> {
  const res = await request.post(`${API_URL}/api/v1/sessions`, { data: { email, password } })
  const body = await res.json()
  return body.token
}

async function loginUi(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login')
  await page.locator('#email').fill(email)
  await page.locator('#password').fill(password)
  await page.locator('[data-testid=login-submit]').click()
  await page.waitForURL(/\/devices/, { timeout: 10_000 })
}

async function safeJson(res: { json: () => Promise<any> }): Promise<any> {
  try {
    return await res.json()
  } catch {
    return undefined
  }
}

async function readVisibleDeviceRows(page: Page): Promise<Array<Record<string, string>>> {
  const rows = page.locator('[data-testid=devices-table] [data-testid=device-row]')
  const count = await rows.count()
  const fields = ['identifier', 'name', 'platform', 'os_version', 'status', 'last_seen_at']
  const out: Array<Record<string, string>> = []
  for (let i = 0; i < count; i++) {
    const row = rows.nth(i)
    const rec: Record<string, string> = {}
    for (const f of fields) {
      rec[f] = ((await row.locator(`[data-field=${f}]`).innerText().catch(() => '')) ?? '').trim()
    }
    out.push(rec)
  }
  return out
}

function apiDeviceUrl(params: Record<string, string | number | undefined>): string {
  const qp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined) qp.set(k, String(v))
  const qs = qp.toString()
  return `${API_URL}/api/v1/devices${qs ? `?${qs}` : ''}`
}

// ================= Given (fixtures) =================

Given('I am an active user of organization {string} and it has many devices', async ({ page, world }, label: string) => {
  const org = createOrgWithUser(label)
  const specs = genDevicesFlat('DEV', 25)
  createDevices(org.name, specs)
  world.orgs = { ...world.orgs, [label]: org }
  world.createdDevices = specs
  world.totalDeviceCount = specs.length
  world.totalPages = Math.ceil(specs.length / DEFAULT_PAGE_SIZE)
  await loginUi(page, org.email, org.password)
})

Given('organization {string} has devices across multiple platforms', async ({ page, world }, label: string) => {
  const org = createOrgWithUser(label)
  const specs = buildDeviceSet('DEV', [
    { platform: 'ios', status: 'active', count: 4 },
    { platform: 'android', status: 'active', count: 4 },
    { platform: 'macos', status: 'active', count: 4 },
  ])
  createDevices(org.name, specs)
  world.orgs = { ...world.orgs, [label]: org }
  world.createdDevices = specs
  await loginUi(page, org.email, org.password)
})

Given('organization {string} has devices in multiple statuses', async ({ page, world }, label: string) => {
  const org = createOrgWithUser(label)
  const specs = buildDeviceSet('DEV', [
    { platform: 'ios', status: 'active', count: 3 },
    { platform: 'ios', status: 'inactive', count: 3 },
    { platform: 'ios', status: 'retired', count: 3 },
  ])
  createDevices(org.name, specs)
  world.orgs = { ...world.orgs, [label]: org }
  world.createdDevices = specs
  await loginUi(page, org.email, org.password)
})

Given('organization {string} has devices spanning multiple platforms and statuses', async ({ page, world }, label: string) => {
  const org = createOrgWithUser(label)
  const specs = buildDeviceSet('DEV', [
    { platform: 'android', status: 'active', count: 2 },
    { platform: 'android', status: 'inactive', count: 2 },
    { platform: 'ios', status: 'active', count: 2 },
    { platform: 'ios', status: 'inactive', count: 2 },
  ])
  createDevices(org.name, specs)
  world.orgs = { ...world.orgs, [label]: org }
  world.createdDevices = specs
  await loginUi(page, org.email, org.password)
})

Given('organization {string} has no devices at all', async ({ page, world }, label: string) => {
  const org = createOrgWithUser(label)
  world.orgs = { ...world.orgs, [label]: org }
  world.createdDevices = []
  await loginUi(page, org.email, org.password)
})

Given('organization {string} has no devices with platform {string}', async ({ page, world }, label: string, _excludedPlatform: string) => {
  const org = createOrgWithUser(label)
  const specs = buildDeviceSet('DEV', [
    { platform: 'ios', status: 'active', count: 3 },
    { platform: 'android', status: 'active', count: 2 },
  ])
  createDevices(org.name, specs)
  world.orgs = { ...world.orgs, [label]: org }
  world.createdDevices = specs
  await loginUi(page, org.email, org.password)
})

Given('organization {string} has a number of devices not evenly divisible by the page size', async ({ page, world }, label: string) => {
  const org = createOrgWithUser(label)
  const specs = genDevicesFlat('DEV', 47) // 47 / 20 -> pages of 20, 20, 7
  createDevices(org.name, specs)
  world.orgs = { ...world.orgs, [label]: org }
  world.createdDevices = specs
  world.totalDeviceCount = specs.length
  world.totalPages = Math.ceil(specs.length / DEFAULT_PAGE_SIZE)
  await loginUi(page, org.email, org.password)
})

Given('organization {string} only has enough devices for {int} pages', async ({ world }, label: string, pages: number) => {
  const org = createOrgWithUser(label)
  const specs = genDevicesFlat('DEV', pages * DEFAULT_PAGE_SIZE - 10) // < pages full pages, last one partial
  createDevices(org.name, specs)
  world.orgs = { ...world.orgs, [label]: org }
  world.createdDevices = specs
  world.totalDeviceCount = specs.length
  world.totalPages = Math.ceil(specs.length / DEFAULT_PAGE_SIZE)
  // No token fetched here on purpose — the `request` fixture isn't available
  // in this Given. The When step below (`I call the device list API with
  // page ...`) looks up `world.orgs` and logs in via the API itself.
})

Given('I am an active user of organization {string}', async ({ world }, label: string) => {
  const org = createOrgWithUser(label)
  world.orgs = { ...world.orgs, [label]: org }
  // Same note as above: token is fetched lazily by the When step via `world.orgs`.
})

Given('organization {string} has more devices than the maximum allowed page size', async ({ world }, label: string) => {
  const org = createOrgWithUser(label)
  const count = MAX_PAGE_SIZE + 50
  const specs = genDevicesFlat('DEV', count)
  createDevices(org.name, specs)
  world.orgs = { ...world.orgs, [label]: org }
  world.createdDevices = specs
  world.clampCreatedCount = count
})

Given(
  'organization {string} has its own devices and organization {string} also has its own devices',
  async ({ world }, labelA: string, labelB: string) => {
    const orgA = createOrgWithUser(labelA)
    const orgB = createOrgWithUser(labelB)
    const devicesA = genDevicesFlat('ACME', 12)
    const devicesB = genDevicesFlat('GLOBEX', 18)
    createDevices(orgA.name, devicesA)
    createDevices(orgB.name, devicesB)
    world.orgs = { ...world.orgs, [labelA]: orgA, [labelB]: orgB }
    world.orgDeviceIdentifiers = {
      [labelA]: devicesA.map((d) => d.identifier),
      [labelB]: devicesB.map((d) => d.identifier),
    }
    world.totalDeviceCount = devicesA.length
  },
)

Given('the device list API is returning a server error', async ({ page, world }) => {
  const org = createOrgWithUser('ErrorOrg')
  world.orgs = { ...world.orgs, ErrorOrg: org }
  await page.route('**/api/v1/devices**', (route) =>
    route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Internal server error' }),
    }),
  )
  await loginUi(page, org.email, org.password)
})

Given('I have applied platform filter {string} and am on page {int}', async ({ page, world }, platform: string, pageNum: number) => {
  const org = createOrgWithUser('ReloadOrg')
  const specs = buildDeviceSet('DEV', [{ platform, status: 'active', count: 25 }]) // 25 -> page 1 (20) + page 2 (5)
  createDevices(org.name, specs)
  world.orgs = { ...world.orgs, ReloadOrg: org }
  world.createdDevices = specs
  await loginUi(page, org.email, org.password)
  await page.goto(`/devices?platform=${encodeURIComponent(platform)}&page=${pageNum}`)
})

// ================= When =================

When('I open the Devices page without any filter', async ({ page }) => {
  await page.goto('/devices')
})

When('I open the Devices page', async ({ page }) => {
  await page.goto('/devices')
})

When('I filter the device list by platform {string}', async ({ page }, platform: string) => {
  await page.locator('[data-testid=filter-platform]').selectOption(platform, { timeout: 5_000 })
  await page.waitForURL(new RegExp(`platform=${platform}`), { timeout: 5_000 })
})

When('I filter the device list by status {string}', async ({ page }, status: string) => {
  await page.locator('[data-testid=filter-status]').selectOption(status, { timeout: 5_000 })
  await page.waitForURL(new RegExp(`status=${status}`), { timeout: 5_000 })
})

When(
  'I filter the device list by platform {string} and status {string} at the same time',
  async ({ page }, platform: string, status: string) => {
    await page.locator('[data-testid=filter-platform]').selectOption(platform, { timeout: 5_000 })
    await page.locator('[data-testid=filter-status]').selectOption(status, { timeout: 5_000 })
    await page.waitForURL(new RegExp(`platform=${platform}.*status=${status}|status=${status}.*platform=${platform}`), {
      timeout: 5_000,
    })
  },
)

When('I go to the last page', async ({ page, world }) => {
  const lastPage = world.totalPages ?? 1
  await page.goto(`/devices?page=${lastPage}`)
})

When('I call the device list API with page {string}', async ({ request, world }, pageStr: string) => {
  const token = world.token || (await apiLogin(request, Object.values(world.orgs ?? {})[0]?.email ?? '', Object.values(world.orgs ?? {})[0]?.password ?? ''))
  const res = await request.get(apiDeviceUrl({ page: pageStr }), {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  world.lastStatus = res.status()
  world.lastBody = await safeJson(res)
})

When('I call the device list API with platform {string}', async ({ request, world }, platform: string) => {
  const org = Object.values(world.orgs ?? {})[0]
  const token = world.token || (org ? await apiLogin(request, org.email, org.password) : '')
  const res = await request.get(apiDeviceUrl({ platform }), {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  world.lastStatus = res.status()
  world.lastBody = await safeJson(res)
})

When('I call the device list API with per_page {string}', async ({ request, world }, perPage: string) => {
  const org = Object.values(world.orgs ?? {})[0]
  const token = org ? await apiLogin(request, org.email, org.password) : ''
  const res = await request.get(apiDeviceUrl({ per_page: perPage }), {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  world.lastStatus = res.status()
  world.lastBody = await safeJson(res)
})

When(
  'a user from {string} calls the device list API without any filter, across all pages',
  async ({ request, world }, label: string) => {
    const org = world.orgs?.[label]
    if (!org) throw new Error(`no org fixture for label "${label}"`)
    const token = await apiLogin(request, org.email, org.password)
    const perPage = 5
    let page = 1
    let totalPages = 1
    const collected: any[] = []
    do {
      const res = await request.get(apiDeviceUrl({ page, per_page: perPage }), {
        headers: { Authorization: `Bearer ${token}` },
      })
      world.lastStatus = res.status()
      const body = await safeJson(res)
      world.lastBody = body
      if (!res.ok() || !body) break
      collected.push(...(body.devices ?? []))
      totalPages = body.meta?.total_pages ?? 1
      page++
    } while (page <= totalPages)
    world.collectedDevices = collected
  },
)

When('I call the device list API without an authentication token', async ({ request, world }) => {
  const res = await request.get(apiDeviceUrl({}))
  world.lastStatus = res.status()
  world.lastBody = await safeJson(res)
})

When('I call the device list API with that token', async ({ request, world }) => {
  const res = await request.get(apiDeviceUrl({}), {
    headers: { Authorization: `Bearer ${world.token}` },
  })
  world.lastStatus = res.status()
  world.lastBody = await safeJson(res)
})

When('I reload the page', async ({ page }) => {
  await page.reload()
})

// ================= Then =================

Then('I see the device list for {string} on the first page', async ({ page, world }, _label: string) => {
  await expect(page.locator('[data-testid=devices-table]')).toBeVisible({ timeout: 5_000 })
  const rows = await readVisibleDeviceRows(page)
  const expectedCount = Math.min(DEFAULT_PAGE_SIZE, world.createdDevices?.length ?? 0)
  expect(rows.length).toBe(expectedCount)
})

Then('I see the correct total device count and total number of pages', async ({ page, world }) => {
  const total = world.totalDeviceCount ?? 0
  const totalPages = world.totalPages ?? 1
  await expect(page.locator('[data-testid=pagination-info]')).toContainText(String(total), { timeout: 5_000 })
  await expect(page.locator('[data-testid=pagination-page-indicator]')).toContainText(`/ ${totalPages}`, {
    timeout: 5_000,
  })
})

Then('I only see devices with platform {string} belonging to {string}', async ({ page, world }, platform: string, _label: string) => {
  const rows = await readVisibleDeviceRows(page)
  const expectedIds = (world.createdDevices ?? []).filter((d) => d.platform === platform).map((d) => d.identifier).sort()
  const actualIds = rows.map((r) => r.identifier).sort()
  expect(actualIds).toEqual(expectedIds)
  for (const r of rows) expect(r.platform).toBe(platform)
})

Then('the list returns to page 1', async ({ page }) => {
  const url = new URL(page.url())
  const pageParam = url.searchParams.get('page')
  expect(pageParam === null || pageParam === '1').toBeTruthy()
})

Then('I only see devices with status {string} belonging to {string}', async ({ page, world }, status: string, _label: string) => {
  const rows = await readVisibleDeviceRows(page)
  const expectedIds = (world.createdDevices ?? []).filter((d) => d.status === status).map((d) => d.identifier).sort()
  const actualIds = rows.map((r) => r.identifier).sort()
  expect(actualIds).toEqual(expectedIds)
  for (const r of rows) expect(r.status).toBe(status)
})

Then('I only see devices that have both platform {string} and status {string}', async ({ page, world }, platform: string, status: string) => {
  const rows = await readVisibleDeviceRows(page)
  const expectedIds = (world.createdDevices ?? [])
    .filter((d) => d.platform === platform && d.status === status)
    .map((d) => d.identifier)
    .sort()
  const actualIds = rows.map((r) => r.identifier).sort()
  expect(actualIds).toEqual(expectedIds)
  for (const r of rows) {
    expect(r.platform).toBe(platform)
    expect(r.status).toBe(status)
  }
})

Then('I see the message {string}', async ({ page }, message: string) => {
  await expect(page.locator('[data-testid=empty-state]')).toContainText(message, { timeout: 5_000 })
})

Then('I do not see a {string} button', async ({ page }, _label: string) => {
  await expect(page.locator('[data-testid=filter-clear-button]')).toHaveCount(0)
})

Then('I see the empty-filter message with a {string} button', async ({ page }, label: string) => {
  await expect(page.locator('[data-testid=empty-state]')).toBeVisible({ timeout: 5_000 })
  await expect(page.locator('[data-testid=empty-state-clear-button]')).toContainText(label, { timeout: 5_000 })
})

Then('I see exactly the remaining devices for that page, no more and no less', async ({ page, world }) => {
  const total = world.createdDevices?.length ?? 0
  const remainder = total % DEFAULT_PAGE_SIZE || DEFAULT_PAGE_SIZE
  const rows = await readVisibleDeviceRows(page)
  expect(rows.length).toBe(remainder)
})

Then('I receive an empty device list', async ({ world }) => {
  expect(world.lastBody?.devices).toEqual([])
})

Then('the pagination metadata still reflects the true total device count and total pages', async ({ world }) => {
  expect(world.lastBody?.meta?.total_count).toBe(world.totalDeviceCount)
  expect(world.lastBody?.meta?.total_pages).toBe(world.totalPages)
})

Then('I receive a field-level error for {string}', async ({ world }, field: string) => {
  const errors = world.lastBody?.errors
  expect(Array.isArray(errors?.[field]) && errors[field].length > 0).toBeTruthy()
})

Then('the returned page size is clamped to the maximum allowed', async ({ world }) => {
  expect(world.lastBody?.meta?.per_page).toBe(MAX_PAGE_SIZE)
})

Then('not all devices are returned in a single response', async ({ world }) => {
  expect(world.lastBody?.devices?.length).toBe(MAX_PAGE_SIZE)
  expect(world.lastBody?.devices?.length).toBeLessThan(world.clampCreatedCount ?? Infinity)
})

Then('I only see devices belonging to {string}', async ({ world }, label: string) => {
  const actualIds = (world.collectedDevices ?? []).map((d: any) => d.identifier).sort()
  const expectedIds = [...(world.orgDeviceIdentifiers?.[label] ?? [])].sort()
  expect(actualIds).toEqual(expectedIds)
  for (const [otherLabel, ids] of Object.entries(world.orgDeviceIdentifiers ?? {})) {
    if (otherLabel === label) continue
    for (const id of ids) expect(actualIds).not.toContain(id)
  }
})

Then('the total device count in the pagination metadata only counts {string} devices', async ({ world }, _label: string) => {
  expect(world.lastBody?.meta?.total_count).toBe(world.totalDeviceCount)
})

Then('I see an error banner with a {string} button in the table area', async ({ page }, label: string) => {
  await expect(page.locator('[data-testid=error-banner]')).toBeVisible({ timeout: 5_000 })
  await expect(page.locator('[data-testid=retry-button]')).toContainText(label, { timeout: 5_000 })
})

Then('the filter bar still works normally', async ({ page }) => {
  await expect(page.locator('[data-testid=filter-platform]')).toBeEnabled({ timeout: 5_000 })
  await expect(page.locator('[data-testid=filter-status]')).toBeEnabled({ timeout: 5_000 })
})

Then('I still see filter {string} applied and page {int} as before reloading', async ({ page }, platform: string, pageNum: number) => {
  await expect(page.locator('[data-testid=filter-platform]')).toHaveValue(platform, { timeout: 5_000 })
  await expect(page.locator('[data-testid=pagination-page-indicator]')).toContainText(`Trang ${pageNum}`, {
    timeout: 5_000,
  })
})
