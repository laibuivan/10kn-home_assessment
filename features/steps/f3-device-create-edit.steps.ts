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
 * Target UI contract this file drives — NOT implemented yet (F3 is the first
 * feature to add write actions to the Devices page; see docs/design/F3-frontend.md
 * §1/§2). Listed here so `slice-implementer` knows exactly which
 * data-testid hooks to wire up on DeviceListView.vue + the new FormModal.vue/
 * DeviceFormModal.vue/ToastContainer.vue components:
 *
 *   [data-testid=add-device-button]                    "+ Thêm Device" (list head, and the EmptyState A1 CTA)
 *   [data-testid=device-form-modal]                     the modal container (FormModal wrapping DeviceFormModal)
 *   [data-testid=device-form-identifier]                identifier <input> (disabled in edit mode)
 *   [data-testid=device-form-name]                      name <input>
 *   [data-testid=device-form-platform]                  platform <select>
 *   [data-testid=device-form-os-version]                os_version <input>
 *   [data-testid=device-form-status]                    status <select> (edit mode only — hidden on create)
 *   [data-testid=device-form-submit]                    "Lưu" submit button
 *   [data-testid=device-form-cancel]                    "Hủy" cancel button
 *   [data-testid=device-form-banner]                    banner for `errors.base` (retired-block) / infra-error message
 *   [data-testid=field-error-<field>]                   field-level error text under a given field, e.g. field-error-identifier
 *   [data-testid=devices-table] [data-testid=device-row] [data-testid=actions-menu-trigger]      "⋯" trigger per row
 *   [data-testid=devices-table] [data-testid=device-row] [data-testid=device-action-edit]        "Sửa" item inside the row's actions menu (superseded by
 *       F4-frontend.md §1/§2, OQ-2 — was a standalone [data-testid=edit-device-button] until F4)
 *   [data-testid=devices-table] [data-testid=device-row] [data-testid=device-action-edit-tooltip] wrapping <span title="..."> around the disabled "Sửa" item on a retired row
 *   [data-testid=toast]                                 one rendered toast item (ToastContainer, mounted once in AppShell)
 */

// ---------- Rails-runner fixture plumbing (same pattern as f0/f2 steps) ----------

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

/** Creates a brand-new, uniquely-named organization + active user (same convention as F2). */
function createOrgWithUser(label: string, password = 'Password123!'): OrgFixture {
  const suffix = randomUUID().slice(0, 8)
  const name = `${label} ${suffix}`
  const email = `f3.${suffix}@example.test`
  ensureUser(name, email, password, 'active')
  return { name, email, password }
}

function createDevices(orgName: string, specs: DeviceSpec[]): void {
  if (specs.length === 0) return
  const rows = specs
    .map(
      (s) =>
        `{ identifier: ${rubyStr(s.identifier)}, name: ${rubyStr(s.name)}, platform: ${rubyStr(s.platform)}, status: ${rubyStr(s.status)} }`,
    )
    .join(",\n      ")
  runRailsScript(`
    org = Organization.find_or_create_by!(name: ${rubyStr(orgName)})
    rows = [
      ${rows}
    ]
    rows.each do |row|
      Device.create!(organization: org, identifier: row[:identifier], name: row[:name], platform: row[:platform], status: row[:status])
    end
  `)
}

/** Creates one device directly via the DB and returns its numeric id, so PATCH steps can address `/api/v1/devices/:id` without going through `GET /devices` (F3 has no `show` action — see F3-api.md §5). */
function createDeviceReturningId(orgName: string, spec: DeviceSpec): number {
  const out = runRailsScript(`
    org = Organization.find_or_create_by!(name: ${rubyStr(orgName)})
    d = Device.create!(organization: org, identifier: ${rubyStr(spec.identifier)}, name: ${rubyStr(spec.name)}, platform: ${rubyStr(spec.platform)}, status: ${rubyStr(spec.status)})
    puts d.id
  `)
  const lines = out.trim().split('\n')
  return parseInt(lines[lines.length - 1], 10)
}

function getOrganizationId(orgName: string): number {
  const out = runRailsScript(`
    org = Organization.find_by!(name: ${rubyStr(orgName)})
    puts org.id
  `)
  const lines = out.trim().split('\n')
  return parseInt(lines[lines.length - 1], 10)
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

async function createDeviceViaApi(request: APIRequestContext, org: OrgFixture, data: Record<string, unknown>) {
  const token = await apiLogin(request, org.email, org.password)
  const res = await request.post(`${API_URL}/api/v1/devices`, {
    headers: { Authorization: `Bearer ${token}` },
    data,
  })
  return { status: res.status(), body: await safeJson(res) }
}

async function patchDeviceViaApi(request: APIRequestContext, org: OrgFixture, deviceId: number, data: Record<string, unknown>) {
  const token = await apiLogin(request, org.email, org.password)
  const res = await request.patch(`${API_URL}/api/v1/devices/${deviceId}`, {
    headers: { Authorization: `Bearer ${token}` },
    data,
  })
  return { status: res.status(), body: await safeJson(res) }
}

function waitForDeviceWriteResponse(page: Page, method: 'POST' | 'PATCH') {
  return page.waitForResponse(
    (res) => res.request().method() === method && res.url().includes('/api/v1/devices'),
    { timeout: 5_000 },
  )
}

function deviceRow(page: Page, identifier: string) {
  return page.locator('[data-testid=devices-table] [data-testid=device-row]').filter({ hasText: identifier })
}

/**
 * "Sửa" now lives inside the row's "⋯" ActionsMenu, not as a standalone
 * button (F4-frontend.md §1/§2, OQ-2) — open the menu, then click the item.
 */
async function clickEditAction(page: Page, identifier: string) {
  const row = deviceRow(page, identifier)
  await row.locator('[data-testid=actions-menu-trigger]').click()
  await row.locator('[data-testid=device-action-edit]').click()
}

// ================= Given (fixtures) =================

Given('I am logged in as an active user of organization {string}', async ({ page, world }, label: string) => {
  const org = createOrgWithUser(label)
  world.orgs = { ...world.orgs, [label]: org }
  await loginUi(page, org.email, org.password)
})

Given(
  'I am an active user of organization {string}, which already has a device with identifier {string}',
  async ({ page, world }, label: string, identifier: string) => {
    const org = createOrgWithUser(label)
    createDevices(org.name, [{ identifier, name: 'Existing Device', platform: 'ios', status: 'active' }])
    world.orgs = { ...world.orgs, [label]: org }
    await loginUi(page, org.email, org.password)
  },
)

Given('organization {string} already has a device with identifier {string}', async ({ world }, label: string, identifier: string) => {
  const org = createOrgWithUser(label)
  createDevices(org.name, [{ identifier, name: 'Existing Device', platform: 'ios', status: 'active' }])
  world.orgs = { ...world.orgs, [label]: org }
})

Given('organization {string} also exists', async ({ world }, label: string) => {
  const org = createOrgWithUser(label)
  world.orgs = { ...world.orgs, [label]: org }
})

Given('organization {string} has a device {string}', async ({ world }, label: string, identifier: string) => {
  const org = createOrgWithUser(label)
  const id = createDeviceReturningId(org.name, { identifier, name: identifier, platform: 'ios', status: 'active' })
  world.orgs = { ...world.orgs, [label]: org }
  world.deviceIdsByIdentifier = { ...world.deviceIdsByIdentifier, [identifier]: id }
})

Given('organization {string} has a device {string} with status {string}', async ({ world }, label: string, identifier: string, status: string) => {
  const org = createOrgWithUser(label)
  const id = createDeviceReturningId(org.name, { identifier, name: identifier, platform: 'ios', status })
  world.orgs = { ...world.orgs, [label]: org }
  world.deviceIdsByIdentifier = { ...world.deviceIdsByIdentifier, [identifier]: id }
  world.originalDevice = { identifier, name: identifier, platform: 'ios', os_version: null, status }
})

Given(
  'I am logged in as an active user of organization {string} with a device {string} that is {string}',
  async ({ page, world }, label: string, identifier: string, status: string) => {
    const org = createOrgWithUser(label)
    createDevices(org.name, [{ identifier, name: identifier, platform: 'ios', status }])
    world.orgs = { ...world.orgs, [label]: org }
    world.lastCreatedIdentifier = identifier
    await loginUi(page, org.email, org.password)
  },
)

Given(
  'I have an already-expired authentication token for an active user of organization {string} which has a device {string}',
  async ({ world }, orgLabel: string, identifier: string) => {
    const suffix = randomUUID().slice(0, 8)
    const name = `${orgLabel} ${suffix}`
    const email = `f3.expired.${suffix}@example.test`
    ensureUser(name, email, 'Password123!', 'active')
    const id = createDeviceReturningId(name, { identifier, name: identifier, platform: 'ios', status: 'active' })
    const out = runRailsScript(`
      user = User.find_by!(email: ${rubyStr(email)})
      puts JsonWebToken.encode({ user_id: user.id, organization_id: user.organization_id }, -1)
    `)
    world.token = out.trim().split('\n').pop()
    world.deviceIdsByIdentifier = { ...world.deviceIdsByIdentifier, [identifier]: id }
  },
)

Given('the create-device API is returning a server error', async ({ page }) => {
  await page.route('**/api/v1/devices', (route) => {
    if (route.request().method() === 'POST') {
      route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Internal server error' }) })
    } else {
      route.continue()
    }
  })
})

// ================= When =================

When('I create a new device with identifier {string}, name {string} and platform {string}', async ({ page, world }, identifier: string, name: string, platform: string) => {
  world.lastCreatedIdentifier = identifier
  await page.locator('[data-testid=add-device-button]').click()
  await page.locator('[data-testid=device-form-modal]').waitFor({ state: 'visible', timeout: 5_000 })
  await page.locator('[data-testid=device-form-identifier]').fill(identifier)
  await page.locator('[data-testid=device-form-name]').fill(name)
  await page.locator('[data-testid=device-form-platform]').selectOption(platform)
  const responseWait = waitForDeviceWriteResponse(page, 'POST')
  await page.locator('[data-testid=device-form-submit]').click()
  const res = await responseWait
  world.lastStatus = res.status()
  world.lastBody = await safeJson(res)
})

When('I open the row actions menu for that device', async ({ page, world }) => {
  const identifier = world.lastCreatedIdentifier!
  await deviceRow(page, identifier).locator('[data-testid=actions-menu-trigger]').click()
})

When(
  'I edit that device changing its name, platform and OS version',
  async ({ page, world }) => {
    const identifier = world.lastCreatedIdentifier!
    await clickEditAction(page, identifier)
    await page.locator('[data-testid=device-form-modal]').waitFor({ state: 'visible', timeout: 5_000 })
    await page.locator('[data-testid=device-form-name]').fill('Updated Name')
    await page.locator('[data-testid=device-form-platform]').selectOption('android')
    await page.locator('[data-testid=device-form-os-version]').fill('9.9.9')
    const responseWait = waitForDeviceWriteResponse(page, 'PATCH')
    await page.locator('[data-testid=device-form-submit]').click()
    const res = await responseWait
    world.lastStatus = res.status()
    world.lastBody = await safeJson(res)
  },
)

When('I edit that device changing its status to {string}', async ({ page, world }, status: string) => {
  const identifier = world.lastCreatedIdentifier!
  await clickEditAction(page, identifier)
  await page.locator('[data-testid=device-form-modal]').waitFor({ state: 'visible', timeout: 5_000 })
  const responseWait = waitForDeviceWriteResponse(page, 'PATCH')
  await page.locator('[data-testid=device-form-status]').selectOption(status)
  await page.locator('[data-testid=device-form-submit]').click()
  const res = await responseWait
  world.lastStatus = res.status()
  world.lastBody = await safeJson(res)
})

When(
  'I call the create-device API for {string} with identifier {string}, name {string} and platform {string}',
  async ({ request, world }, label: string, identifier: string, name: string, platform: string) => {
    const org = world.orgs?.[label]
    if (!org) throw new Error(`no org fixture for label "${label}"`)
    world.lastCreatedIdentifier = identifier
    const { status, body } = await createDeviceViaApi(request, org, { identifier, name, platform })
    world.lastStatus = status
    world.lastBody = body
  },
)

When(
  'I call the create-device API for {string} with identifier {string}, name {string}, platform {string} and status {string}',
  async ({ request, world }, label: string, identifier: string, name: string, platform: string, status: string) => {
    const org = world.orgs?.[label]
    if (!org) throw new Error(`no org fixture for label "${label}"`)
    world.lastCreatedIdentifier = identifier
    const { status: httpStatus, body } = await createDeviceViaApi(request, org, { identifier, name, platform, status })
    world.lastStatus = httpStatus
    world.lastBody = body
  },
)

When(
  'I call the create-device API for {string} with identifier {string}, name {string}, platform {string} and organization_id of {string}',
  async ({ request, world }, actingLabel: string, identifier: string, name: string, platform: string, targetLabel: string) => {
    const actingOrg = world.orgs?.[actingLabel]
    const targetOrg = world.orgs?.[targetLabel]
    if (!actingOrg) throw new Error(`no org fixture for label "${actingLabel}"`)
    if (!targetOrg) throw new Error(`no org fixture for label "${targetLabel}"`)
    const targetOrgId = getOrganizationId(targetOrg.name)
    world.lastCreatedIdentifier = identifier
    const { status, body } = await createDeviceViaApi(request, actingOrg, { identifier, name, platform, organization_id: targetOrgId })
    world.lastStatus = status
    world.lastBody = body
  },
)

When('I call the create-device API for {string} with no identifier, name or platform', async ({ request, world }, label: string) => {
  const org = world.orgs?.[label]
  if (!org) throw new Error(`no org fixture for label "${label}"`)
  const { status, body } = await createDeviceViaApi(request, org, {})
  world.lastStatus = status
  world.lastBody = body
})

When('I call the create-device API without an authentication token', async ({ request, world }) => {
  const res = await request.post(`${API_URL}/api/v1/devices`, { data: { identifier: 'NO-TOKEN-001', name: 'No Token', platform: 'ios' } })
  world.lastStatus = res.status()
  world.lastBody = await safeJson(res)
})

When(
  'I send 2 requests to create a device with identifier {string} in {string} at nearly the same time',
  async ({ request, world }, identifier: string, label: string) => {
    const org = world.orgs?.[label]
    if (!org) throw new Error(`no org fixture for label "${label}"`)
    const token = await apiLogin(request, org.email, org.password)
    const payload = { identifier, name: 'Race Device', platform: 'ios' }
    const [res1, res2] = await Promise.all([
      request.post(`${API_URL}/api/v1/devices`, { headers: { Authorization: `Bearer ${token}` }, data: payload }),
      request.post(`${API_URL}/api/v1/devices`, { headers: { Authorization: `Bearer ${token}` }, data: payload }),
    ])
    world.raceResults = [
      { status: res1.status(), body: await safeJson(res1) },
      { status: res2.status(), body: await safeJson(res2) },
    ]
  },
)

When(
  'I call the update-device API as {string} for the device with identifier {string} and status {string}',
  async ({ request, world }, label: string, identifier: string, status: string) => {
    const org = world.orgs?.[label]
    const deviceId = world.deviceIdsByIdentifier?.[identifier]
    if (!org) throw new Error(`no org fixture for label "${label}"`)
    if (deviceId === undefined) throw new Error(`no device id fixture for identifier "${identifier}"`)
    const { status: httpStatus, body } = await patchDeviceViaApi(request, org, deviceId, { status })
    world.lastStatus = httpStatus
    world.lastBody = body
  },
)

When(
  'I call the update-device API as {string} for the device with identifier {string} and name {string}',
  async ({ request, world }, label: string, identifier: string, name: string) => {
    const org = world.orgs?.[label]
    const deviceId = world.deviceIdsByIdentifier?.[identifier]
    if (!org) throw new Error(`no org fixture for label "${label}"`)
    if (deviceId === undefined) throw new Error(`no device id fixture for identifier "${identifier}"`)
    const { status: httpStatus, body } = await patchDeviceViaApi(request, org, deviceId, { name })
    world.lastStatus = httpStatus
    world.lastBody = body
  },
)

When(
  'I call the update-device API as {string} for the device with identifier {string}, attempting to change identifier to {string}',
  async ({ request, world }, label: string, identifier: string, newIdentifier: string) => {
    const org = world.orgs?.[label]
    const deviceId = world.deviceIdsByIdentifier?.[identifier]
    if (!org) throw new Error(`no org fixture for label "${label}"`)
    if (deviceId === undefined) throw new Error(`no device id fixture for identifier "${identifier}"`)
    const { status: httpStatus, body } = await patchDeviceViaApi(request, org, deviceId, { identifier: newIdentifier })
    world.lastStatus = httpStatus
    world.lastBody = body
  },
)

When('I call the update-device API for the device with identifier {string} using that token', async ({ request, world }, identifier: string) => {
  const deviceId = world.deviceIdsByIdentifier?.[identifier]
  if (deviceId === undefined) throw new Error(`no device id fixture for identifier "${identifier}"`)
  const res = await request.patch(`${API_URL}/api/v1/devices/${deviceId}`, {
    headers: { Authorization: `Bearer ${world.token}` },
    data: { name: 'New Name' },
  })
  world.lastStatus = res.status()
  world.lastBody = await safeJson(res)
})

// ================= Then =================

Then('the device is created successfully belonging to {string}', async ({ page, world }, _label: string) => {
  await expect(page.locator('[data-testid=device-form-modal]')).toHaveCount(0, { timeout: 5_000 })
  const identifier = world.lastCreatedIdentifier!
  await expect(deviceRow(page, identifier)).toBeVisible({ timeout: 5_000 })
})

Then('the new device has default status {string}', async ({ page, world }, status: string) => {
  const identifier = world.lastCreatedIdentifier!
  await expect(deviceRow(page, identifier).locator('[data-field=status]')).toContainText(status, { timeout: 5_000 })
})

Then('I see the toast {string}', async ({ page }, message: string) => {
  await expect(page.locator('[data-testid=toast]').filter({ hasText: message })).toBeVisible({ timeout: 5_000 })
})

Then('I see a field-level error under the {string} field saying {string}', async ({ page }, field: string, message: string) => {
  await expect(page.locator(`[data-testid=field-error-${field}]`)).toContainText(message, { timeout: 5_000 })
})

Then('the created device belongs to organization {string}', async ({ request, world }, label: string) => {
  const org = world.orgs?.[label]
  if (!org) throw new Error(`no org fixture for label "${label}"`)
  const token = await apiLogin(request, org.email, org.password)
  const res = await request.get(`${API_URL}/api/v1/devices`, { headers: { Authorization: `Bearer ${token}` } })
  const body = await safeJson(res)
  const identifiers = (body?.devices ?? []).map((d: any) => d.identifier)
  expect(identifiers).toContain(world.lastCreatedIdentifier)
})

Then('the created device has status {string}', async ({ world }, status: string) => {
  expect(world.lastBody?.device?.status).toBe(status)
})

Then('the device is updated successfully with the new data', async ({ page, world }) => {
  await expect(page.locator('[data-testid=device-form-modal]')).toHaveCount(0, { timeout: 5_000 })
  const identifier = world.lastCreatedIdentifier!
  const row = deviceRow(page, identifier)
  await expect(row.locator('[data-field=name]')).toContainText('Updated Name', { timeout: 5_000 })
  await expect(row.locator('[data-field=platform]')).toContainText('android', { timeout: 5_000 })
})

Then('the device is updated successfully with status {string}', async ({ page, world }, status: string) => {
  await expect(page.locator('[data-testid=device-form-modal]')).toHaveCount(0, { timeout: 5_000 })
  const identifier = world.lastCreatedIdentifier!
  await expect(deviceRow(page, identifier).locator('[data-field=status]')).toContainText(status, { timeout: 5_000 })
})

Then('the error message is {string}', async ({ world }, message: string) => {
  expect(world.lastBody?.errors?.base?.[0]).toBe(message)
})

Then('no field of the device with identifier {string} was actually changed', async ({ request, world }, identifier: string) => {
  const org = Object.values(world.orgs ?? {})[0]
  if (!org) throw new Error('no org fixture in world')
  const token = await apiLogin(request, org.email, org.password)
  const res = await request.get(`${API_URL}/api/v1/devices`, { headers: { Authorization: `Bearer ${token}` } })
  const body = await safeJson(res)
  const device = (body?.devices ?? []).find((d: any) => d.identifier === identifier)
  const original = world.originalDevice!
  expect(device?.name).toBe(original.name)
  expect(device?.platform).toBe(original.platform)
  expect(device?.status).toBe(original.status)
})

Then("the device's identifier in the response is still {string}", async ({ world }, identifier: string) => {
  expect(world.lastBody?.device?.identifier).toBe(identifier)
})

Then('only one request succeeds with status {int}', async ({ world }, statusCode: number) => {
  const successes = (world.raceResults ?? []).filter((r) => r.status === statusCode)
  expect(successes.length).toBe(1)
})

Then('the other request fails with a field-level error for {string}', async ({ world }, field: string) => {
  const failed = (world.raceResults ?? []).find((r) => r.status !== 201)
  expect(failed).toBeTruthy()
  const errors = failed?.body?.errors
  expect(Array.isArray(errors?.[field]) && errors[field].length > 0).toBeTruthy()
})

Then('I see an error banner saying {string} in the form', async ({ page }, message: string) => {
  await expect(page.locator('[data-testid=device-form-banner]')).toContainText(message, { timeout: 5_000 })
})

Then('the modal does not close', async ({ page }) => {
  await expect(page.locator('[data-testid=device-form-modal]')).toBeVisible({ timeout: 5_000 })
})

Then('the data I entered is still there', async ({ page, world }) => {
  const identifier = world.lastCreatedIdentifier!
  await expect(page.locator('[data-testid=device-form-identifier]')).toHaveValue(identifier, { timeout: 5_000 })
})

Then('the {string} action for that device is disabled', async ({ page, world }, _label: string) => {
  const identifier = world.lastCreatedIdentifier!
  await expect(deviceRow(page, identifier).locator('[data-testid=device-action-edit]')).toBeDisabled({ timeout: 5_000 })
})

Then('I see the tooltip {string} when hovering over that action', async ({ page, world }, tooltip: string) => {
  const identifier = world.lastCreatedIdentifier!
  await expect(deviceRow(page, identifier).locator('[data-testid=device-action-edit-tooltip]')).toHaveAttribute('title', tooltip, {
    timeout: 5_000,
  })
})
