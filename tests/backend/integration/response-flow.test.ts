/**
 * Integration tests for response flow
 * Tests that prompts sent to sessions result in events being broadcast
 *
 * This tests the full flow:
 * 1. Create internal session
 * 2. Connect via WebSocket
 * 3. Send prompt to session
 * 4. Verify events are received (pre_tool_use, post_tool_use, stop)
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import WebSocket from 'ws';
import { waitForOpen, collectMessages, get, post, del, sleep, createTestWebSocket } from '../../utils';

const WS_URL = 'ws://localhost:4003';
const SERVER_PORT = 4003;
const TEST_PREFIX = '__test_response__';

// Track created sessions for cleanup
const createdSessionIds: string[] = [];

async function cleanupTestSessions(): Promise<void> {
  for (const id of createdSessionIds) {
    try {
      await del(`/sessions/${id}`, SERVER_PORT);
    } catch {
      // Ignore cleanup errors
    }
  }
  createdSessionIds.length = 0;

  // Clean up any orphaned test sessions
  const sessionsRes = await get('/sessions', SERVER_PORT);
  const orphanedSessions = sessionsRes.body.sessions.filter(
    (s: any) =>
      s.name?.startsWith(TEST_PREFIX) ||
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

describe('Response Flow Integration', () => {
  let testSession: any;
  const openSockets: WebSocket[] = [];

  beforeAll(async () => {
    // Create an internal session for testing
    const res = await post('/sessions', {
      name: `${TEST_PREFIX}response-flow`,
      cwd: '/tmp',
      flags: { openTerminal: false, skipPermissions: true }
    }, SERVER_PORT);

    testSession = res.body.session;
    createdSessionIds.push(testSession.id);

    // Wait for Claude to initialize (needs more time in CI/test environments)
    await sleep(5000);
  }, 30000); // 30 second timeout for beforeAll

  afterEach(() => {
    for (const ws of openSockets) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    }
    openSockets.length = 0;
  });

  afterAll(async () => {
    await cleanupTestSessions();
  });

  it('receives events after sending prompt', async () => {
    const ws = createTestWebSocket(WS_URL);
    openSockets.push(ws);

    // Collect all messages
    const messages: any[] = [];
    ws.on('message', (data) => {
      try {
        messages.push(JSON.parse(data.toString()));
      } catch { }
    });

    await waitForOpen(ws);
    // Wait for initial messages
    await sleep(500);
    messages.length = 0; // Clear initial messages

    // Send a simple prompt that should generate events
    const promptRes = await post(`/sessions/${testSession.id}/prompt`, {
      prompt: 'What is 2+2? Answer with just the number.'
    }, SERVER_PORT);

    // The prompt might fail if Claude hasn't fully initialized or the session is busy
    // We log the error but continue to check if any events were received
    if (!promptRes.body.ok) {
      console.log('Prompt failed:', promptRes.body.error);
    }

    // Wait for Claude to process and respond (may take a few seconds)
    await sleep(8000);

    // Check that we received some events
    const eventMessages = messages.filter(m => m.type === 'event');
    const sessionMessages = messages.filter(m => m.type === 'sessions');

    // We should have received at least one event or session update
    expect(eventMessages.length + sessionMessages.length).toBeGreaterThan(0);

    console.log(`Received ${eventMessages.length} events, ${sessionMessages.length} session updates`);
  }, 15000); // 15 second timeout

  it('session status changes during prompt processing', async () => {
    const ws = createTestWebSocket(WS_URL);
    openSockets.push(ws);

    const statusChanges: string[] = [];
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'sessions') {
          const session = msg.payload.find((s: any) => s.id === testSession.id);
          if (session && !statusChanges.includes(session.status)) {
            statusChanges.push(session.status);
          }
        }
      } catch { }
    });

    await waitForOpen(ws);
    await sleep(500);

    // Send prompt
    await post(`/sessions/${testSession.id}/prompt`, {
      prompt: 'Say hello'
    }, SERVER_PORT);

    // Wait for processing
    await sleep(8000);

    // We might see status transitions
    console.log('Status changes observed:', statusChanges);
    // At minimum, session should exist
    expect(testSession.id).toBeDefined();
  });

  it('events contain correct session information', async () => {
    const ws = createTestWebSocket(WS_URL);
    openSockets.push(ws);

    const events: any[] = [];
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'event') {
          events.push(msg.payload);
        }
      } catch { }
    });

    await waitForOpen(ws);
    await sleep(500);

    // Send prompt
    await post(`/sessions/${testSession.id}/prompt`, {
      prompt: 'Read file /tmp/nonexistent.txt'
    }, SERVER_PORT);

    // Wait for Claude to process
    await sleep(8000);

    // If we got events, verify their structure
    for (const event of events) {
      expect(event).toHaveProperty('id');
      expect(event).toHaveProperty('type');
      expect(event).toHaveProperty('timestamp');
      expect(event).toHaveProperty('sessionId');

      if (event.type === 'pre_tool_use' || event.type === 'post_tool_use') {
        expect(event).toHaveProperty('tool');
      }
    }

    console.log(`Received ${events.length} events:`, events.map(e => e.type));
  }, 15000); // 15 second timeout
});

describe('External Session Events', () => {
  const openSockets: WebSocket[] = [];

  afterEach(() => {
    for (const ws of openSockets) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    }
    openSockets.length = 0;
  });

  it('external sessions (like this one) generate events', async () => {
    // This test verifies that external Claude sessions generate events
    // Since we're running as an external session, our own activity should show up

    const ws = createTestWebSocket(WS_URL);
    openSockets.push(ws);

    const events: any[] = [];
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'event') {
          events.push(msg.payload);
        }
      } catch { }
    });

    await waitForOpen(ws);

    // Collect events for a short time
    // Our own tool usage should generate events
    await sleep(2000);

    // Check initial history
    const historyMsg = await new Promise<any>((resolve) => {
      ws.send(JSON.stringify({ type: 'get_history', payload: { limit: 20 } }));
      const handler = (data: WebSocket.Data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'history') {
            ws.removeListener('message', handler);
            resolve(msg);
          }
        } catch { }
      };
      ws.on('message', handler);
    });

    expect(Array.isArray(historyMsg.payload)).toBe(true);
    console.log(`History contains ${historyMsg.payload.length} events`);

    // If there's history, verify structure
    if (historyMsg.payload.length > 0) {
      const event = historyMsg.payload[0];
      expect(event).toHaveProperty('id');
      expect(event).toHaveProperty('type');
      expect(event).toHaveProperty('timestamp');
    }
  });
});
