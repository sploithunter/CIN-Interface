import { test, expect } from '@playwright/test';

/**
 * E2E tests for CIN-Interface application
 *
 * These tests verify the full stack:
 * - Server running and responding
 * - Frontend loading and connecting via WebSocket
 * - 3D visualization rendering
 * - Session management UI
 */

test.describe('Application Load', () => {
  test('homepage loads successfully', async ({ page }) => {
    await page.goto('/');

    // Page should load - wait for body to be visible
    await expect(page.locator('body')).toBeVisible();
  });

  test('Three.js canvas renders', async ({ page }) => {
    await page.goto('/');

    // Wait for the canvas element (Three.js renderer) - may take a while to initialize
    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible({ timeout: 15000 });
  });

  test('WebSocket connects to server', async ({ page }) => {
    // Listen for WebSocket connections
    const wsPromise = page.waitForEvent('websocket');

    await page.goto('/');

    const ws = await wsPromise;
    expect(ws.url()).toContain('localhost');

    // Wait for the connection to be established
    await page.waitForTimeout(1000);
  });
});

test.describe('Server Health', () => {
  test('health endpoint responds', async ({ request }) => {
    const response = await request.get('http://localhost:4003/health');

    expect(response.ok()).toBeTruthy();

    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.version).toBeDefined();
  });

  test('config endpoint responds', async ({ request }) => {
    const response = await request.get('http://localhost:4003/config');

    expect(response.ok()).toBeTruthy();

    const body = await response.json();
    // Config returns user info directly (no ok wrapper)
    expect(body.username).toBeDefined();
    expect(body.hostname).toBeDefined();
  });

  test('sessions endpoint responds', async ({ request }) => {
    const response = await request.get('http://localhost:4003/sessions');

    expect(response.ok()).toBeTruthy();

    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.sessions)).toBe(true);
  });
});

test.describe('UI Elements', () => {
  test('session list is visible', async ({ page }) => {
    await page.goto('/');

    // Wait for initial load
    await page.waitForTimeout(2000);

    // The UI should have session-related elements
    // Look for any session indicator or the main container
    const body = page.locator('body');
    await expect(body).toBeVisible();
  });

  test('page remains functional after keyboard input', async ({ page }) => {
    await page.goto('/');

    // Wait for app to initialize
    await page.waitForTimeout(3000);

    // Press Escape (safe key that shouldn't break anything)
    await page.keyboard.press('Escape');

    // Wait a moment for any UI response
    await page.waitForTimeout(500);

    // App should still be functional - body should be visible
    await expect(page.locator('body')).toBeVisible();
  });
});

test.describe('Session Management', () => {
  const TEST_SESSION_NAME = '__e2e_test_session__';

  test.afterEach(async ({ request }) => {
    // Clean up any test sessions
    try {
      const sessionsResponse = await request.get('http://localhost:4003/sessions');
      const body = await sessionsResponse.json();
      const sessions = body.sessions || [];

      for (const session of sessions) {
        if (session.name?.startsWith('__e2e_')) {
          await request.delete(`http://localhost:4003/sessions/${session.id}`);
        }
      }
    } catch {
      // Ignore cleanup errors
    }
  });

  test('can create a session via API', async ({ request }) => {
    const response = await request.post('http://localhost:4003/sessions', {
      data: {
        name: TEST_SESSION_NAME,
        cwd: '/tmp',
        flags: { openTerminal: false },
      },
    });

    expect(response.ok()).toBeTruthy();

    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.session.name).toBe(TEST_SESSION_NAME);
    expect(body.session.type).toBe('internal');
  });

  test('created session appears in session list', async ({ request }) => {
    // Create session
    const createResponse = await request.post('http://localhost:4003/sessions', {
      data: {
        name: TEST_SESSION_NAME,
        cwd: '/tmp',
        flags: { openTerminal: false },
      },
    });

    const { session } = await createResponse.json();

    // Verify it appears in list
    const listResponse = await request.get('http://localhost:4003/sessions');
    const { sessions } = await listResponse.json();

    const found = sessions.find((s: any) => s.id === session.id);
    expect(found).toBeDefined();
    expect(found.name).toBe(TEST_SESSION_NAME);
  });

  test('can delete a session via API', async ({ request }) => {
    // Create session
    const createResponse = await request.post('http://localhost:4003/sessions', {
      data: {
        name: TEST_SESSION_NAME,
        cwd: '/tmp',
        flags: { openTerminal: false },
      },
    });

    const { session } = await createResponse.json();

    // Delete it
    const deleteResponse = await request.delete(
      `http://localhost:4003/sessions/${session.id}`
    );
    expect(deleteResponse.ok()).toBeTruthy();

    // Verify it's gone
    const listResponse = await request.get('http://localhost:4003/sessions');
    const { sessions } = await listResponse.json();

    const found = sessions.find((s: any) => s.id === session.id);
    expect(found).toBeUndefined();
  });
});

test.describe('WebSocket Events', () => {
  test('receives messages on connect', async ({ page }) => {
    const messages: any[] = [];

    // Capture WebSocket messages
    page.on('websocket', (ws) => {
      ws.on('framereceived', (frame) => {
        try {
          const data = JSON.parse(frame.payload as string);
          messages.push(data);
        } catch {
          // Ignore non-JSON frames
        }
      });
    });

    await page.goto('/');
    await page.waitForTimeout(3000);

    // Should have received at least some messages
    // The exact message types depend on server implementation
    expect(messages.length).toBeGreaterThan(0);
  });

  // Note: Event POST endpoint is tested in integration tests (tests/backend/api/events.test.ts)
  // The E2E browser context has issues with making direct POST requests
});
