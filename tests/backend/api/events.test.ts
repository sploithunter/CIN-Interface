/**
 * Tests for event handling endpoints
 */

import { describe, it, expect } from 'vitest';
import { get, post, createTestEvent } from '../../utils';

const SERVER_PORT = 4003;

describe('POST /event', () => {
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
      sessionId: `session-start-test-${Date.now()}`
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
    const uniqueSessionId = `new-external-session-${Date.now()}`;
    const event = createTestEvent({
      type: 'session_start',
      sessionId: uniqueSessionId,
      cwd: '/tmp/new-project'
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
    // First get an existing session
    const sessionsRes = await get('/sessions', SERVER_PORT);
    const session = sessionsRes.body.sessions.find(
      (s: any) => s.claudeSessionId
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
      sessionId: 'codex-thread-test',
      codexThreadId: 'codex-thread-test',
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
    const session = sessionsRes.body.sessions.find(
      (s: any) => s.claudeSessionId
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
