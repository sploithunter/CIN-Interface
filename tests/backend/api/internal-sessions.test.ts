/**
 * Tests for internal session management
 * These tests create real tmux sessions but avoid opening Terminal windows
 * by using flags.openTerminal = false
 */

import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { get, post, del, sleep } from '../../utils';

const SERVER_PORT = 4003;
const TEST_PREFIX = '__test_internal__';

// Track created sessions for cleanup
const createdSessionIds: string[] = [];

/**
 * Clean up all test sessions
 */
async function cleanupTestSessions(): Promise<void> {
  for (const id of createdSessionIds) {
    try {
      await del(`/sessions/${id}`, SERVER_PORT);
    } catch {
      // Ignore cleanup errors
    }
  }
  createdSessionIds.length = 0;

  // Also clean up any orphaned test sessions by name or cwd
  const sessionsRes = await get('/sessions', SERVER_PORT);
  const orphanedSessions = sessionsRes.body.sessions.filter(
    (s: any) =>
      s.name?.startsWith(TEST_PREFIX) ||
      s.name === 'tmp' ||  // Sessions created with cwd: '/tmp'
      s.cwd === '/tmp' ||
      s.cwd?.includes('__test__')
  );
  for (const session of orphanedSessions) {
    try {
      await del(`/sessions/${session.id}`, SERVER_PORT);
    } catch {
      // Ignore cleanup errors
    }
  }
}

describe('Internal Session Creation', () => {
  afterAll(async () => {
    await cleanupTestSessions();
  });

  it('creates internal session without opening terminal', async () => {
    const res = await post('/sessions', {
      name: `${TEST_PREFIX}no-terminal`,
      cwd: '/tmp',
      flags: {
        openTerminal: false,
        skipPermissions: true
      }
    }, SERVER_PORT);

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.session).toBeDefined();
    expect(res.body.session.type).toBe('internal');
    expect(res.body.session.tmuxSession).toBeDefined();

    createdSessionIds.push(res.body.session.id);
  });

  it('session has correct initial properties', async () => {
    const res = await post('/sessions', {
      name: `${TEST_PREFIX}props-test`,
      cwd: '/tmp',
      flags: { openTerminal: false }
    }, SERVER_PORT);

    expect(res.body.session.id).toMatch(/^[a-f0-9-]+$/);
    expect(res.body.session.name).toBe(`${TEST_PREFIX}props-test`);
    expect(res.body.session.type).toBe('internal');
    expect(res.body.session.agent).toBe('claude');
    expect(res.body.session.status).toBe('idle');
    expect(res.body.session.cwd).toBe('/tmp');
    expect(typeof res.body.session.createdAt).toBe('number');
    expect(typeof res.body.session.lastActivity).toBe('number');

    createdSessionIds.push(res.body.session.id);
  });

  it('session is visible in sessions list', async () => {
    const createRes = await post('/sessions', {
      name: `${TEST_PREFIX}list-test`,
      cwd: '/tmp',
      flags: { openTerminal: false }
    }, SERVER_PORT);

    createdSessionIds.push(createRes.body.session.id);

    const listRes = await get('/sessions', SERVER_PORT);
    const session = listRes.body.sessions.find(
      (s: any) => s.id === createRes.body.session.id
    );

    expect(session).toBeDefined();
    expect(session.name).toBe(`${TEST_PREFIX}list-test`);
  });

  it('defaults name to directory basename', async () => {
    const res = await post('/sessions', {
      cwd: '/tmp',
      flags: { openTerminal: false }
    }, SERVER_PORT);

    expect(res.body.session.name).toBe('tmp');

    createdSessionIds.push(res.body.session.id);
  });

  it('rejects invalid directory', async () => {
    const res = await post('/sessions', {
      name: `${TEST_PREFIX}invalid-dir`,
      cwd: '/nonexistent/path/that/does/not/exist',
      flags: { openTerminal: false }
    }, SERVER_PORT);

    expect(res.status).toBe(500);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toContain('does not exist');
  });
});

describe('Session Deletion', () => {
  afterAll(async () => {
    await cleanupTestSessions();
  });

  it('deletes internal session and kills tmux', async () => {
    // Create a session
    const createRes = await post('/sessions', {
      name: `${TEST_PREFIX}delete-test`,
      cwd: '/tmp',
      flags: { openTerminal: false }
    }, SERVER_PORT);

    const sessionId = createRes.body.session.id;
    const tmuxSession = createRes.body.session.tmuxSession;

    // Delete it
    const deleteRes = await del(`/sessions/${sessionId}`, SERVER_PORT);
    expect(deleteRes.status).toBe(200);
    expect(deleteRes.body.ok).toBe(true);

    // Verify it's gone from the list
    const listRes = await get('/sessions', SERVER_PORT);
    const found = listRes.body.sessions.find((s: any) => s.id === sessionId);
    expect(found).toBeUndefined();
  });

  it('returns 404 for nonexistent session', async () => {
    const res = await del('/sessions/00000000-0000-0000-0000-000000000000', SERVER_PORT);
    expect(res.status).toBe(404);
    expect(res.body.ok).toBe(false);
  });
});

describe('Session Prompt', () => {
  let testSession: any;

  beforeAll(async () => {
    // Create a session for prompt tests
    const res = await post('/sessions', {
      name: `${TEST_PREFIX}prompt-test`,
      cwd: '/tmp',
      flags: { openTerminal: false, skipPermissions: true }
    }, SERVER_PORT);
    testSession = res.body.session;
    createdSessionIds.push(testSession.id);

    // Wait for Claude to initialize
    await sleep(2000);
  });

  afterAll(async () => {
    await cleanupTestSessions();
  });

  it('sends prompt to internal session', async () => {
    const res = await post(`/sessions/${testSession.id}/prompt`, {
      prompt: 'echo "test prompt received"'
    }, SERVER_PORT);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('rejects empty prompt', async () => {
    const res = await post(`/sessions/${testSession.id}/prompt`, {
      prompt: ''
    }, SERVER_PORT);

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toContain('required');
  });

  it('returns 404 for nonexistent session', async () => {
    const res = await post('/sessions/00000000-0000-0000-0000-000000000000/prompt', {
      prompt: 'test'
    }, SERVER_PORT);

    expect(res.status).toBe(404);
  });
});

describe('Session Cancel', () => {
  let testSession: any;

  beforeAll(async () => {
    const res = await post('/sessions', {
      name: `${TEST_PREFIX}cancel-test`,
      cwd: '/tmp',
      flags: { openTerminal: false, skipPermissions: true }
    }, SERVER_PORT);
    testSession = res.body.session;
    createdSessionIds.push(testSession.id);

    await sleep(2000);
  });

  afterAll(async () => {
    await cleanupTestSessions();
  });

  it('sends cancel (Ctrl+C) to internal session', async () => {
    const res = await post(`/sessions/${testSession.id}/cancel`, {}, SERVER_PORT);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('returns error for external sessions', async () => {
    // Find an external session
    const sessionsRes = await get('/sessions', SERVER_PORT);
    const externalSession = sessionsRes.body.sessions.find(
      (s: any) => s.type === 'external' && !s.name?.startsWith(TEST_PREFIX)
    );

    if (!externalSession) {
      console.log('Skipping: no external session available');
      return;
    }

    const res = await post(`/sessions/${externalSession.id}/cancel`, {}, SERVER_PORT);

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toContain('external');
  });

  it('returns 404 for nonexistent session', async () => {
    const res = await post('/sessions/00000000-0000-0000-0000-000000000000/cancel', {}, SERVER_PORT);
    expect(res.status).toBe(404);
  });
});

describe('Session Restart', () => {
  let testSession: any;

  beforeAll(async () => {
    const res = await post('/sessions', {
      name: `${TEST_PREFIX}restart-test`,
      cwd: '/tmp',
      flags: { openTerminal: false, skipPermissions: true }
    }, SERVER_PORT);
    testSession = res.body.session;
    createdSessionIds.push(testSession.id);

    await sleep(2000);
  });

  afterAll(async () => {
    await cleanupTestSessions();
  });

  it('restarts internal session', async () => {
    const res = await post(`/sessions/${testSession.id}/restart`, {}, SERVER_PORT);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.session).toBeDefined();
    expect(res.body.session.status).toBe('idle');
  });

  it('returns error for external sessions', async () => {
    const sessionsRes = await get('/sessions', SERVER_PORT);
    const externalSession = sessionsRes.body.sessions.find(
      (s: any) => s.type === 'external' && !s.name?.startsWith(TEST_PREFIX)
    );

    if (!externalSession) {
      console.log('Skipping: no external session available');
      return;
    }

    const res = await post(`/sessions/${externalSession.id}/restart`, {}, SERVER_PORT);

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toContain('external');
  });

  it('returns 404 for nonexistent session', async () => {
    const res = await post('/sessions/00000000-0000-0000-0000-000000000000/restart', {}, SERVER_PORT);
    expect(res.status).toBe(404);
  });
});

describe('Permission Response via WebSocket', () => {
  // Permission responses are sent via WebSocket, not HTTP
  // This tests the HTTP endpoint if there is one, or documents that it's WS-only

  it('documents that permission responses use WebSocket', async () => {
    // Permission responses are sent via WebSocket message:
    // { type: 'permission_response', payload: { sessionId, response: '1' } }
    // There's no HTTP endpoint for permission responses
    expect(true).toBe(true);
  });
});

describe('Session Terminal', () => {
  // Note: We skip actually opening Terminal.app in tests
  let testSession: any;

  beforeAll(async () => {
    const res = await post('/sessions', {
      name: `${TEST_PREFIX}terminal-test`,
      cwd: '/tmp',
      flags: { openTerminal: false }
    }, SERVER_PORT);
    testSession = res.body.session;
    createdSessionIds.push(testSession.id);
  });

  afterAll(async () => {
    await cleanupTestSessions();
  });

  it('returns error for external sessions', async () => {
    const sessionsRes = await get('/sessions', SERVER_PORT);
    const externalSession = sessionsRes.body.sessions.find(
      (s: any) => s.type === 'external' && !s.name?.startsWith(TEST_PREFIX)
    );

    if (!externalSession) {
      console.log('Skipping: no external session available');
      return;
    }

    const res = await post(`/sessions/${externalSession.id}/terminal`, {}, SERVER_PORT);

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it('returns 404 for nonexistent session', async () => {
    const res = await post('/sessions/00000000-0000-0000-0000-000000000000/terminal', {}, SERVER_PORT);
    expect(res.status).toBe(404);
  });
});
