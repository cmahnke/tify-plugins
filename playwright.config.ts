import { defineConfig, devices } from '@playwright/test';

// E2E against the demo catalog + package examples.
// Locally: vite dev server (fast iteration). CI: E2E_PREVIEW=1 → vite preview
// on the built dist (production output). Each CI runner selects one browser
// via --project=<name> (see .github/workflows/ci.yml).
const preview = Boolean(process.env.E2E_PREVIEW);
const port = preview ? 4173 : 5173;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://localhost:${port}`,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    {
      name: 'firefox',
      use: {
        ...devices['Desktop Firefox'],
        launchOptions: { firefoxUserPrefs: { 'media.cubeb.backend': 'null' } },
      },
    },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: {
    command: preview
      ? 'npm run preview -- --port 4173 --strictPort'
      : 'npm run dev -- --port 5173 --strictPort',
    url: `http://localhost:${port}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
