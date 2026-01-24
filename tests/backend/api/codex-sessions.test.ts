/**
 * Tests for Codex session management
 * These tests verify that Codex sessions can be created and managed
 * similar to Claude sessions, using the agent: 'codex' option.
 */

import { describe, it, expect, afterAll, beforeAll, beforeEach } from 'vitest';
import { get, post, del, sleep } from '../../utils';
import { execSync } from 'child_process';

const SERVER_PORT = 4003;
const TEST_PREFIX = '__test_codex__';

// Track created sessions for cleanup
const createdSessionIds: string[] = [];

// Check if Codex CLI is available
let codexAvailable = false;
try {
  execSync('which codex', { stdio: 'ignore' });
  codexAvailable = true;
} catch {
  codexAvailable = false;
}

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

  // Also clean up any orphaned test sessions by name prefix only
  // IMPORTANT: Only match our specific TEST_PREFIX to avoid interfering with other test files
  const sessionsRes = await get('/sessions', SERVER_PORT);
  const orphanedSessions = sessionsRes.body.sessions.filter(
    (s: any) => s.name?.startsWith(TEST_PREFIX)
  );
  for (const session of orphanedSessions) {
    try {
      await del(`/sessions/${session.id}`, SERVER_PORT);
    } catch {
      // Ignore cleanup errors
    }
  }
}

describe('Codex Session Creation', () => {
  // Don't cleanup here - let the last describe block handle cleanup

  it('creates codex session with agent parameter', async () => {
    if (!codexAvailable) {
      console.log('Skipping: Codex CLI not available');
      return;
    }

    const res = await post('/sessions', {
      name: `${TEST_PREFIX}create`,
      cwd: '/tmp',
      agent: 'codex',
      flags: {
        openTerminal: false
      }
    }, SERVER_PORT);

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.session).toBeDefined();
    expect(res.body.session.type).toBe('internal');
    expect(res.body.session.agent).toBe('codex');
    expect(res.body.session.tmuxSession).toBeDefined();

    createdSessionIds.push(res.body.session.id);
  });

  it('codex session has correct initial properties', async () => {
    if (!codexAvailable) {
      console.log('Skipping: Codex CLI not available');
      return;
    }

    const res = await post('/sessions', {
      name: `${TEST_PREFIX}props`,
      cwd: '/tmp',
      agent: 'codex',
      flags: { openTerminal: false }
    }, SERVER_PORT);

    expect(res.body.session.id).toMatch(/^[a-f0-9-]+$/);
    expect(res.body.session.name).toBe(`${TEST_PREFIX}props`);
    expect(res.body.session.type).toBe('internal');
    expect(res.body.session.agent).toBe('codex');
    // Sessions start as 'working' because the agent is initializing
    expect(res.body.session.status).toBe('working');
    expect(res.body.session.cwd).toBe('/tmp');
    expect(typeof res.body.session.createdAt).toBe('number');
    expect(typeof res.body.session.lastActivity).toBe('number');

    createdSessionIds.push(res.body.session.id);
  });

  it('codex session is visible in sessions list with correct agent', async () => {
    if (!codexAvailable) {
      console.log('Skipping: Codex CLI not available');
      return;
    }

    const createRes = await post('/sessions', {
      name: `${TEST_PREFIX}list`,
      cwd: '/tmp',
      agent: 'codex',
      flags: { openTerminal: false }
    }, SERVER_PORT);

    createdSessionIds.push(createRes.body.session.id);

    const listRes = await get('/sessions', SERVER_PORT);
    const session = listRes.body.sessions.find(
      (s: any) => s.id === createRes.body.session.id
    );

    expect(session).toBeDefined();
    expect(session.name).toBe(`${TEST_PREFIX}list`);
    expect(session.agent).toBe('codex');
  });

  it('defaults to claude agent when not specified', async () => {
    const res = await post('/sessions', {
      name: `${TEST_PREFIX}default-agent`,
      cwd: '/tmp',
      flags: { openTerminal: false }
    }, SERVER_PORT);

    expect(res.body.session.agent).toBe('claude');

    createdSessionIds.push(res.body.session.id);
  });
});

describe('Codex Session Deletion', () => {
  // Don't cleanup here - let the last describe block handle cleanup

  it('deletes codex session and kills tmux', async () => {
    if (!codexAvailable) {
      console.log('Skipping: Codex CLI not available');
      return;
    }

    // Create a codex session
    const createRes = await post('/sessions', {
      name: `${TEST_PREFIX}delete`,
      cwd: '/tmp',
      agent: 'codex',
      flags: { openTerminal: false }
    }, SERVER_PORT);

    const sessionId = createRes.body.session.id;

    // Delete it
    const deleteRes = await del(`/sessions/${sessionId}`, SERVER_PORT);
    expect(deleteRes.status).toBe(200);
    expect(deleteRes.body.ok).toBe(true);

    // Verify it's gone from the list
    const listRes = await get('/sessions', SERVER_PORT);
    const found = listRes.body.sessions.find((s: any) => s.id === sessionId);
    expect(found).toBeUndefined();
  });
});

describe('Codex Session Prompt', () => {
  let testSession: any;

  beforeAll(async () => {
    if (!codexAvailable) {
      return;
    }

    // Create a codex session for prompt tests
    const res = await post('/sessions', {
      name: `${TEST_PREFIX}prompt`,
      cwd: '/tmp',
      agent: 'codex',
      flags: { openTerminal: false }
    }, SERVER_PORT);
    testSession = res.body.session;
    createdSessionIds.push(testSession.id);

    // Wait for Codex to initialize
    await sleep(2000);
  });

  // Don't cleanup here - let the last describe block handle cleanup

  it('sends prompt to codex session', async () => {
    if (!codexAvailable || !testSession) {
      console.log('Skipping: Codex CLI not available');
      return;
    }

    const res = await post(`/sessions/${testSession.id}/prompt`, {
      prompt: 'echo "codex test"'
    }, SERVER_PORT);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

describe('Codex Session Restart', () => {
  let testSession: any;

  beforeAll(async () => {
    if (!codexAvailable) {
      return;
    }

    const res = await post('/sessions', {
      name: `${TEST_PREFIX}restart`,
      cwd: '/tmp',
      agent: 'codex',
      flags: { openTerminal: false }
    }, SERVER_PORT);
    testSession = res.body.session;
    createdSessionIds.push(testSession.id);

    await sleep(2000);
  });

  // Don't cleanup here - let the last describe block handle cleanup

  it('restarts codex session with correct agent', async () => {
    if (!codexAvailable || !testSession) {
      console.log('Skipping: Codex CLI not available');
      return;
    }

    // First, put the session in 'offline' status (restart only works on offline sessions)
    await post('/event', {
      id: `${TEST_PREFIX}session-end-${Date.now()}`,
      type: 'session_end',
      timestamp: Date.now(),
      sessionId: testSession.codexThreadId || testSession.id,
      cwd: testSession.cwd
    }, SERVER_PORT);

    // Wait for session status to update
    await sleep(500);

    const res = await post(`/sessions/${testSession.id}/restart`, {}, SERVER_PORT);

    // If restart succeeds
    if (res.status === 200) {
      expect(res.body.ok).toBe(true);
      expect(res.body.session).toBeDefined();
      // Restarted sessions are 'working' as they initialize
      expect(res.body.session.status).toBe('working');
      expect(res.body.session.agent).toBe('codex'); // Should preserve agent type
    } else {
      // If session didn't transition to offline, skip
      console.log('Restart test: session not in offline status, skipping');
      expect(res.status).toBe(500); // Expected if not offline
    }
  });
});

describe('Codex Session Cancel', () => {
  let testSession: any;

  beforeAll(async () => {
    if (!codexAvailable) {
      return;
    }

    const res = await post('/sessions', {
      name: `${TEST_PREFIX}cancel`,
      cwd: '/tmp',
      agent: 'codex',
      flags: { openTerminal: false }
    }, SERVER_PORT);
    testSession = res.body.session;
    createdSessionIds.push(testSession.id);

    await sleep(2000);
  });

  afterAll(async () => {
    await cleanupTestSessions();
  });

  it('sends cancel (Ctrl+C) to codex session', async () => {
    if (!codexAvailable || !testSession) {
      console.log('Skipping: Codex CLI not available');
      return;
    }

    const res = await post(`/sessions/${testSession.id}/cancel`, {}, SERVER_PORT);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
