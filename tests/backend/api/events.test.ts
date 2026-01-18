/**
 * Tests for event handling endpoints
 */

import { describe, it, expect, afterAll } from 'vitest';
import { get, post, del, createTestEvent } from '../../utils';

const SERVER_PORT = 4003;
const TEST_PREFIX = '__test_events__';

/**
 * Clean up test sessions created during tests
 */
async function cleanupTestSessions(): Promise<void> {
  const sessionsRes = await get('/sessions', SERVER_PORT);
  const testSessions = sessionsRes.body.sessions.filter(
    (s: any) =>
      s.claudeSessionId?.startsWith(TEST_PREFIX) ||
      s.codexThreadId?.startsWith(TEST_PREFIX) ||
      s.cwd?.includes(TEST_PREFIX)
  );

  for (const session of testSessions) {
    try {
      await del(`/sessions/${session.id}`, SERVER_PORT);
    } catch {
      // Ignore cleanup errors
    }
  }
}

describe('POST /event', () => {
  afterAll(async () => {
    await cleanupTestSessions();
  });

  it('accepts valid pre_tool_use event', async () => {
    const event = createTestEvent({
      type: 'pre_tool_use',
      tool: 'Bash',
      toolInput: { command: 'ls -la' }
    });

    const res = await post('/event', event, SERVER_PORT);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('accepts valid post_tool_use event', async () => {
    const event = createTestEvent({
      type: 'post_tool_use',
      tool: 'Bash',
      toolInput: { command: 'ls -la' },
      toolResponse: { output: 'file1.txt\nfile2.txt', exit_code: 0 }
    });

    const res = await post('/event', event, SERVER_PORT);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('accepts valid stop event', async () => {
    const event = createTestEvent({
      type: 'stop',
      response: 'Task completed successfully.'
    });

    const res = await post('/event', event, SERVER_PORT);

    expect(res.status).toBe(200);
  });

  it('accepts valid session_start event', async () => {
    const event = createTestEvent({
      type: 'session_start',
      sessionId: `${TEST_PREFIX}session-start-${Date.now()}`
    });

    const res = await post('/event', event, SERVER_PORT);

    expect(res.status).toBe(200);
  });

  it('accepts valid user_prompt_submit event', async () => {
    const event = createTestEvent({
      type: 'user_prompt_submit'
    });

    const res = await post('/event', event, SERVER_PORT);

    expect(res.status).toBe(200);
  });

  it('creates external session for unknown sessionId', async () => {
    const uniqueSessionId = `${TEST_PREFIX}new-session-${Date.now()}`;
    const event = createTestEvent({
      type: 'session_start',
      sessionId: uniqueSessionId,
      cwd: `/tmp/${TEST_PREFIX}new-project`
    });

    await post('/event', event, SERVER_PORT);

    // Check that a session was created
    const sessionsRes = await get('/sessions', SERVER_PORT);
    const newSession = sessionsRes.body.sessions.find(
      (s: any) => s.claudeSessionId === uniqueSessionId
    );

    expect(newSession).toBeDefined();
    expect(newSession.type).toBe('external');
    expect(newSession.agent).toBe('claude');
  });

  it('updates session status on pre_tool_use', async () => {
    // First get an existing non-test session
    const sessionsRes = await get('/sessions', SERVER_PORT);
    const session = sessionsRes.body.sessions.find(
      (s: any) => s.claudeSessionId && !s.claudeSessionId.startsWith(TEST_PREFIX)
    );

    if (!session) {
      // Skip if no sessions available
      return;
    }

    const event = createTestEvent({
      type: 'pre_tool_use',
      sessionId: session.claudeSessionId,
      cwd: session.cwd,
      tool: 'Read',
      toolInput: { file_path: '/tmp/test.txt' }
    });

    await post('/event', event, SERVER_PORT);

    // Check session status changed to working
    const updatedRes = await get('/sessions', SERVER_PORT);
    const updatedSession = updatedRes.body.sessions.find(
      (s: any) => s.id === session.id
    );

    expect(updatedSession.status).toBe('working');
    expect(updatedSession.currentTool).toBe('Read');
  });

  it('accepts event with codexThreadId', async () => {
    const event = createTestEvent({
      type: 'pre_tool_use',
      sessionId: `${TEST_PREFIX}codex-thread`,
      codexThreadId: `${TEST_PREFIX}codex-thread`,
      tool: 'shell'
    });

    const res = await post('/event', event, SERVER_PORT);

    expect(res.status).toBe(200);
  });

  it('handles Task tool events', async () => {
    const event = createTestEvent({
      type: 'pre_tool_use',
      tool: 'Task',
      toolInput: {
        description: 'Test subagent task',
        prompt: 'Do something useful',
        subagent_type: 'Explore'
      }
    });

    const res = await post('/event', event, SERVER_PORT);

    expect(res.status).toBe(200);
  });
});

describe('Event session linking', () => {
  it('links events to correct managed session', async () => {
    const sessionsRes = await get('/sessions', SERVER_PORT);
    // Find a non-test session
    const session = sessionsRes.body.sessions.find(
      (s: any) => s.claudeSessionId && !s.claudeSessionId.startsWith('__test')
    );

    if (!session) return;

    const event = createTestEvent({
      type: 'pre_tool_use',
      sessionId: session.claudeSessionId,
      cwd: session.cwd
    });

    await post('/event', event, SERVER_PORT);

    // The session's lastActivity should be updated
    const updatedRes = await get('/sessions', SERVER_PORT);
    const updated = updatedRes.body.sessions.find(
      (s: any) => s.id === session.id
    );

    expect(updated.lastActivity).toBeGreaterThanOrEqual(session.lastActivity);
  });
});
