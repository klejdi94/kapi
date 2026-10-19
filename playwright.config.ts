import { defineConfig, devices } from '@playwright/test';

/**
 * UI smoke tests against the production frontend build, in a plain browser.
 * Native features (sending through Tauri, files, keychain) aren't available
 * there, so these cover what the webview renders and how it responds — the
 * part unit tests can't reach.
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: 'http://127.0.0.1:4173', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1360, height: 860 } } }],
  webServer: [
    {
      command: 'npx vite preview --port 4173 --strictPort --host 127.0.0.1',
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: !process.env.CI,
    },
    {
      // HTTP echo (:18090) and gRPC (:50077) test servers, shared with the desktop suite.
      command: 'node e2e/desktop/servers.js',
      url: 'http://127.0.0.1:18090/ready',
      reuseExistingServer: !process.env.CI,
    },
  ],
});
