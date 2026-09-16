import { test as base } from 'playwright-bdd'
import { expect } from '@playwright/test'

/** A device fixture created for a scenario (F2 — see f2-device-list.steps.ts). */
export type DeviceSpec = {
  identifier: string
  name: string
  platform: string
  status: string
  lastSeenAt?: string | null
}

/** An org+user fixture created for a scenario (F2). */
export type OrgFixture = {
  name: string
  email: string
  password: string
}

/** Per-scenario mutable state shared across step definitions. */
export type World = {
  lastStatus?: number
  token?: string
  currentEmail?: string
  orgCountBefore?: string
  userCountBefore?: string

  // ---- F2 (device list) additions — see features/steps/f2-device-list.steps.ts ----
  /** Parsed JSON body of the last direct API response (device-list API scenarios). */
  lastBody?: any
  /** Named org fixtures created in this scenario, keyed by the label used in the Gherkin text (e.g. "Acme Inc."). */
  orgs?: Record<string, OrgFixture>
  /** The device fixtures created for the "main" organization under test in this scenario. */
  createdDevices?: DeviceSpec[]
  /** Expected total device count for assertions against pagination `meta.total_count`. */
  totalDeviceCount?: number
  /** Expected total page count for assertions against pagination `meta.total_pages`. */
  totalPages?: number
  /** Number of devices created to prove `per_page` clamping doesn't return everything. */
  clampCreatedCount?: number
  /** Identifiers of devices belonging to each org label, for cross-org isolation assertions. */
  orgDeviceIdentifiers?: Record<string, string[]>
  /** Devices collected while paging through the API across all pages (org-isolation scenario). */
  collectedDevices?: any[]

  // ---- F3 (device create/edit) additions — see features/steps/f3-device-create-edit.steps.ts ----
  /** Identifier of the device most recently created/targeted by a scenario, for locating its row/response afterwards. */
  lastCreatedIdentifier?: string
  /** DB ids of devices created directly via `rails runner`, keyed by identifier, so PATCH steps can address them by URL. */
  deviceIdsByIdentifier?: Record<string, number>
  /** Snapshot of a device's fields taken right after fixture creation, to assert "nothing changed" after a blocked update (retired immutability). */
  originalDevice?: { identifier: string; name: string; platform: string; os_version?: string | null; status: string }
  /** Pair of results from firing two near-simultaneous create requests (race-condition scenario). */
  raceResults?: Array<{ status: number; body: any }>
}

export const test = base.extend<{ world: World }>({
  // eslint-disable-next-line no-empty-pattern
  world: async ({}, use) => {
    await use({})
  },
})

export { expect }
