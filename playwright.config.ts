import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  use: { baseURL: 'http://127.0.0.1:5174', headless: true },
  webServer: {
    command: 'bun run dev:web --port 5174',
    url: 'http://127.0.0.1:5174',
    reuseExistingServer: false,
  },
})
