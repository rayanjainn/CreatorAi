import { defineConfig } from '@playwright/test'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/** Resolve a Chromium binary: $PW_CHROMIUM, the pre-installed /opt/pw-browsers, else Playwright's own download. */
function chromiumPath(): string | undefined {
  if (process.env.PW_CHROMIUM) return process.env.PW_CHROMIUM
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers'
  if (!existsSync(root)) return undefined
  const dir = readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().pop()
  const exe = dir && join(root, dir, 'chrome-linux', 'chrome')
  return exe && existsSync(exe) ? exe : undefined
}

// `make e2e` (scripts/e2e.py) starts the API + web on these ports against a throwaway DATA_DIR and seed.
const WEB = process.env.E2E_WEB_URL || 'http://localhost:3100'

export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: WEB,
    trace: 'retain-on-failure',
    launchOptions: { executablePath: chromiumPath() },
  },
})
