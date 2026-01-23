import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E test configuration
 *
 * Tests run against the full stack:
 * - Server on port 4003
 * - Frontend served by Vite on port 5173 (dev) or server (prod)
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false, // Run tests sequentially to avoid port conflicts
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Single worker for sequential execution
  reporter: 'html',

  use: {
    // Base URL for navigation - use the backend server which serves the built frontend
    baseURL: 'http://localhost:4003',

    // Collect trace on failure
    trace: 'on-first-retry',

    // Screenshot on failure
    screenshot: 'only-on-failure',

    // Timeout for actions
    actionTimeout: 10000,
  },

  // Global timeout per test
  timeout: 60000,

  // Configure projects for different browsers
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Web server configuration - backend server serves both API and static frontend
  webServer: {
    command: 'npm run server',
    url: 'http://localhost:4003/health',
    reuseExistingServer: true,
    timeout: 60000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
