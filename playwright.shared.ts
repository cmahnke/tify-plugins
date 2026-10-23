import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// Shared Playwright config factory for the per-package e2e suites (mirrors
// vite.lib.ts). Each package runs its suite against the shared root dev or
// preview server, so orchestrated runs (npm run test:e2e --workspaces) share
// one server via reuseExistingServer.
export function definePackageE2e(packageDir: string, testDir = './e2e') {
  // E2E_PREVIEW=1 → vite preview on the built dist (production output,
  // used in CI); otherwise the vite dev server (fast local iteration).
  // Each CI runner selects one browser via --project=<name>.
  const preview = Boolean(process.env.E2E_PREVIEW);
  const port = preview ? 4173 : 5173;
  // The root vite binary, resolved absolutely: webServer commands must not
  // depend on the caller's cwd (npm --workspace does not resolve from
  // inside a workspace, and webServer cwd is not the config dir). The vite
  // process itself runs at the repo root — it serves the root project.
  const rootDir = path.join(packageDir, '..', '..');
  const viteBin = path.join(rootDir, 'node_modules', 'vite', 'bin', 'vite.js');

  return defineConfig({
    // Absolute paths throughout: the suite must run identically from the
    // package dir, the repo root, or any other cwd.
    testDir: path.resolve(packageDir, testDir),
    fullyParallel: true,
    forbidOnly: Boolean(process.env.CI),
    retries: process.env.CI ? 2 : 0,
    reporter: process.env.CI
      ? [
          ['list'],
          ['html', { open: 'never', outputFolder: path.join(packageDir, 'playwright-report') }],
        ]
      : [['list']],
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
      cwd: rootDir,
      command: preview
        ? `node "${viteBin}" preview --port 4173 --strictPort`
        : `node "${viteBin}" dev --port 5173 --strictPort`,
      url: `http://localhost:${port}/`,
      reuseExistingServer: true,
      timeout: 120_000,
    },
  });
}
