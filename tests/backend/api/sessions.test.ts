/**
 * Tests for session management endpoints
 *
 * NOTE: Tests that create internal sessions will spawn Terminal windows on macOS.
 * These windows don't auto-close when tmux sessions are killed.
 * Tests are designed to minimize internal session creation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { get, post, patch, del, sleep } from '../../utils';

const SERVER_PORT = 4003;

describe('GET /sessions', () => {
  it('returns list of all sessions', async () => {
    const res = await get('/sessions', SERVER_PORT);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.sessions)).toBe(true);
  });

  it('sessions have required fields', async () => {
    const res = await get('/sessions', SERVER_PORT);

    for (const session of res.body.sessions) {
      expect(session).toMatchObject({
        id: expect.any(String),
        name: expect.any(String),
        type: expect.stringMatching(/^(internal|external)$/),
        status: expect.stringMatching(/^(idle|working|waiting|offline)$/),
        createdAt: expect.any(Number),
        lastActivity: expect.any(Number)
      });
    }
  });

  it('sessions have agent type field', async () => {
    const res = await get('/sessions', SERVER_PORT);

    for (const session of res.body.sessions) {
      expect(session.agent).toMatch(/^(claude|codex)$/);
    }
  });

  it('external sessions have correct type', async () => {
    const res = await get('/sessions', SERVER_PORT);

    const externalSessions = res.body.sessions.filter(
      (s: any) => s.type === 'external'
    );

    for (const session of externalSessions) {
      // External Claude sessions should have claudeSessionId
      // External Codex sessions should have codexThreadId
      if (session.agent === 'claude') {
        expect(session.claudeSessionId).toBeDefined();
      } else if (session.agent === 'codex') {
        expect(session.codexThreadId).toBeDefined();
      }
    }
  });
});

// NOTE: Tests that create internal sessions spawn Terminal windows on macOS
// These are skipped by default to avoid Terminal spam
// Run manually with: npm run test:backend -- --grep "SPAWNS TERMINAL"
describe.skip('POST /sessions (create) - SPAWNS TERMINAL', () => {
  it('creates internal session with valid cwd', async () => {
    // This test spawns a Terminal - run manually if needed
  });
});

describe('PATCH /sessions/:id', () => {
  // Use existing external session for PATCH tests to avoid spawning terminals
  let testSessionId: string | null = null;

  beforeEach(async () => {
    // Find an existing external session to test with
    const res = await get('/sessions', SERVER_PORT);
    const external = res.body.sessions.find((s: any) => s.type === 'external');
    testSessionId = external?.id || null;
  });

  it('updates session name', async () => {
    if (!testSessionId) {
      console.log('Skipping: no external session available');
      return;
    }

    // Get original name
    const before = await get('/sessions', SERVER_PORT);
    const originalSession = before.body.sessions.find((s: any) => s.id === testSessionId);
    const originalName = originalSession?.name;

    // Update name
    const res = await patch(`/sessions/${testSessionId}`, {
      name: 'Renamed-Test-Session'
    }, SERVER_PORT);

    expect(res.status).toBe(200);
    expect(res.body.session.name).toBe('Renamed-Test-Session');

    // Restore original name
    if (originalName) {
      await patch(`/sessions/${testSessionId}`, { name: originalName }, SERVER_PORT);
    }
  });

  it('updates zonePosition', async () => {
    if (!testSessionId) {
      console.log('Skipping: no external session available');
      return;
    }

    const res = await patch(`/sessions/${testSessionId}`, {
      zonePosition: { q: 99, r: -99 }
    }, SERVER_PORT);

    expect(res.status).toBe(200);
    expect(res.body.session.zonePosition).toEqual({ q: 99, r: -99 });

    // Clean up - remove position
    await patch(`/sessions/${testSessionId}`, { zonePosition: null }, SERVER_PORT);
  });
});

describe('DELETE /sessions/:id', () => {
  it('returns appropriate response for nonexistent session', async () => {
    // Use a valid UUID format that doesn't exist
    const res = await del('/sessions/00000000-0000-0000-0000-000000000000', SERVER_PORT);
    expect(res.status).toBe(404);
    expect(res.body.ok).toBe(false);
  });
});

describe('DELETE /sessions/cleanup', () => {
  it('removes offline sessions', async () => {
    const res = await del('/sessions/cleanup', SERVER_PORT);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.deleted).toBe('number');
  });
});
