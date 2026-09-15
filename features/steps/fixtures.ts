import { test as base } from 'playwright-bdd'
import { expect } from '@playwright/test'

/** Per-scenario mutable state shared across step definitions. */
export type World = {
  lastStatus?: number
  token?: string
  currentEmail?: string
  orgCountBefore?: string
  userCountBefore?: string
}

export const test = base.extend<{ world: World }>({
  // eslint-disable-next-line no-empty-pattern
  world: async ({}, use) => {
    await use({})
  },
})

export { expect }
