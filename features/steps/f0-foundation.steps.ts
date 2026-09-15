import { createBdd } from 'playwright-bdd'
import { execSync } from 'node:child_process'
import { writeFileSync, unlinkSync, mkdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { test, expect } from './fixtures'

const { Given, When, Then } = createBdd(test)

const REPO_ROOT = process.cwd()
const API_TMP_DIR = path.join(REPO_ROOT, 'api', 'tmp')
const API_URL = process.env.API_URL ?? 'http://localhost:3010'

/**
 * Fixture setup that only the API/DB can do (create users with a known
 * password+status, mint an expired token, flip a user's status mid-scenario)
 * shells out to the *running* api container's own Rails env via
 * `docker compose exec` — guarantees the same DB/secret the app under test
 * uses, no separate "test mode" config to keep in sync.
 */
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

const rubyStr = (s: string) => JSON.stringify(s) // valid Ruby double-quoted literal too

function ensureUser(orgName: string, email: string, password: string, status: 'active' | 'inactive') {
  runRailsScript(`
    org = Organization.find_or_create_by!(name: ${rubyStr(orgName)})
    user = User.find_or_initialize_by(organization: org, email: ${rubyStr(email)})
    user.password = ${rubyStr(password)}
    user.status = ${rubyStr(status)}
    user.save!
  `)
}

// ---------- fixtures (Given) ----------

Given('an active user {string} with password {string} exists in organization {string}', async ({}, email: string, password: string, orgName: string) => {
  ensureUser(orgName, email, password, 'active')
})

Given('an inactive user {string} with password {string} exists in organization {string}', async ({}, email: string, password: string, orgName: string) => {
  ensureUser(orgName, email, password, 'inactive')
})

Given('I have an already-expired authentication token for {string}', async ({ world }, email: string) => {
  const out = runRailsScript(`
    user = User.find_by!(email: ${rubyStr(email)})
    puts JsonWebToken.encode({ user_id: user.id, organization_id: user.organization_id }, -1)
  `)
  world.token = out.trim().split('\n').pop()
})

Given('I have logged in as {string} and hold a valid token', async ({ request, world }, email: string) => {
  const res = await request.post(`${API_URL}/api/v1/sessions`, {
    data: { email, password: 'Password123!' },
  })
  expect(res.ok(), `login fixture failed: ${res.status()} ${await res.text()}`).toBeTruthy()
  const body = await res.json()
  world.token = body.token
  world.currentEmail = email
})

Given('the seed script has already been run once', async ({ world }) => {
  execSync('docker compose exec -T api bin/rails db:seed', { cwd: REPO_ROOT })
  const out = runRailsScript('puts "#{Organization.count}:#{User.count}"')
  const [orgCount, userCount] = out.trim().split(':')
  world.orgCountBefore = orgCount
  world.userCountBefore = userCount
})

// ---------- actions (When) ----------

When('I log in with email {string} and password {string}', async ({ page }, email: string, password: string) => {
  await page.goto('/login')
  await page.locator('#email').fill(email)
  await page.locator('#password').fill(password)
  await page.locator('[data-testid=login-submit]').click()
})

When('I call the current-user endpoint without an authentication token', async ({ request, world }) => {
  const res = await request.get(`${API_URL}/api/v1/me`)
  world.lastStatus = res.status()
})

When('I call the current-user endpoint with that token', async ({ request, world }) => {
  const res = await request.get(`${API_URL}/api/v1/me`, {
    headers: { Authorization: `Bearer ${world.token}` },
  })
  world.lastStatus = res.status()
})

When('I call the current-user endpoint with that same token', async ({ request, world }) => {
  const res = await request.get(`${API_URL}/api/v1/me`, {
    headers: { Authorization: `Bearer ${world.token}` },
  })
  world.lastStatus = res.status()
})

When('that user is deactivated', async ({ world }) => {
  runRailsScript(`
    user = User.find_by!(email: ${rubyStr(world.currentEmail!)})
    user.update!(status: :inactive)
  `)
})

When('I call the login endpoint with an empty email and empty password', async ({ request, world }) => {
  const res = await request.post(`${API_URL}/api/v1/sessions`, { data: { email: '', password: '' } })
  world.lastStatus = res.status()
})

When('I run the seed script again', async () => {
  execSync('docker compose exec -T api bin/rails db:seed', { cwd: REPO_ROOT })
})

// ---------- assertions (Then) ----------

Then('I am redirected to the devices page', async ({ page }) => {
  await expect(page).toHaveURL(/\/devices/)
})

Then('I am not redirected away from the login page', async ({ page }) => {
  await expect(page).toHaveURL(/\/login/)
})

Then('I see the organization name {string} in the top bar', async ({ page }, orgName: string) => {
  await expect(page.locator('[data-testid=org-name]')).toContainText(orgName)
})

Then('I see the error {string}', async ({ page }, message: string) => {
  await expect(page.locator('[data-testid=login-error]')).toContainText(message)
})

Then('the response status is {int}', async ({ world }, status: number) => {
  expect(world.lastStatus).toBe(status)
})

Then('the number of organizations and users does not increase', async ({ world }) => {
  const out = runRailsScript('puts "#{Organization.count}:#{User.count}"')
  const [orgCount, userCount] = out.trim().split(':')
  expect(orgCount).toBe(world.orgCountBefore)
  expect(userCount).toBe(world.userCountBefore)
})
