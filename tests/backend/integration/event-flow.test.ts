/**
 * Integration tests for event flow
 * Tests the unified event path: events.jsonl → file watcher → addEvent → broadcast
 *
 * IMPORTANT: These tests create external sessions that must be cleaned up.
 * We use a test-specific prefix to identify and clean up test sessions.
 */

import { describe, it, expect, afterEach, afterAll } from 'vitest';
import WebSocket from 'ws';
import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { waitForOpen, waitForEventById, waitForMessageType, drainMessages, get, del, createTestWebSocket } from '../../utils';

const WS_URL = 'ws://localhost:4003';
const SERVER_PORT = 4003;
const EVENTS_FILE = join(homedir(), '.vibecraft/data/events.jsonl');

// Test session prefix for cleanup
const TEST_PREFIX = '__test_integration__';

/**
 * Clean up any test sessions created during tests
 */
async function cleanupTestSessions(): Promise<void> {
  const sessionsRes = await get('/sessions', SERVER_PORT);
  const testSessions = sessionsRes.body.sessions.filter(
    (s: any) => s.name?.startsWith(TEST_PREFIX) || s.cwd?.includes(TEST_PREFIX)
  );

  for (const session of testSessions) {
    try {
      await del(`/sessions/${session.id}`, SERVER_PORT);
    } catch {
      // Ignore cleanup errors
    }
  }
}

describe('Event Flow Integration', () => {
  const openSockets: WebSocket[] = [];

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

  it('file append triggers WebSocket broadcast', async () => {
    const ws = createTestWebSocket(WS_URL);
    openSockets.push(ws);

    await waitForOpen(ws);
    await drainMessages(ws, 4);

    // Ensure events directory exists
    const eventsDir = join(homedir(), '.vibecraft/data');
    if (!existsSync(eventsDir)) {
      mkdirSync(eventsDir, { recursive: true });
    }

    // Append event directly to file (simulating hook script)
    const eventId = `${TEST_PREFIX}file-flow-${Date.now()}`;
    const event = {
      id: eventId,
      type: 'pre_tool_use',
      timestamp: Date.now(),
      sessionId: `${TEST_PREFIX}session`,
      cwd: `/tmp/${TEST_PREFIX}file-flow`,
      tool: 'Grep',
      toolInput: { pattern: 'test' }
    };

    appendFileSync(EVENTS_FILE, JSON.stringify(event) + '\n');

    // Wait for this specific event by ID (may receive other events first)
    const msg = await waitForEventById(ws, eventId, 3000);
    expect(msg.payload.id).toBe(eventId);
  });

  it('Codex event with codexThreadId flows correctly', async () => {
    const ws = createTestWebSocket(WS_URL);
    openSockets.push(ws);

    await waitForOpen(ws);
    await drainMessages(ws, 4);

    const codexThreadId = `${TEST_PREFIX}codex-${Date.now()}`;
    const eventId = `${TEST_PREFIX}codex-event-${Date.now()}`;
    const event = {
      id: eventId,
      type: 'pre_tool_use',
      timestamp: Date.now(),
      sessionId: codexThreadId,
      cwd: `/tmp/${TEST_PREFIX}codex-flow`,
      tool: 'shell',
      toolInput: { command: 'ls' },
      codexThreadId: codexThreadId
    };

    appendFileSync(EVENTS_FILE, JSON.stringify(event) + '\n');

    // Wait for this specific event by ID
    const msg = await waitForEventById(ws, eventId, 3000);
    expect(msg.payload.id).toBe(eventId);
    expect(msg.payload.codexThreadId).toBe(codexThreadId);
  });

  it('event creates external session if unknown', async () => {
    const uniqueSessionId = `${TEST_PREFIX}auto-session-${Date.now()}`;
    const event = {
      id: `${TEST_PREFIX}auto-event-${Date.now()}`,
      type: 'session_start',
      timestamp: Date.now(),
      sessionId: uniqueSessionId,
      cwd: `/tmp/${TEST_PREFIX}auto-session`
    };

    appendFileSync(EVENTS_FILE, JSON.stringify(event) + '\n');

    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, 500));

    // Check session was created
    const sessionsRes = await get('/sessions', SERVER_PORT);
    const session = sessionsRes.body.sessions.find(
      (s: any) => s.claudeSessionId === uniqueSessionId
    );

    expect(session).toBeDefined();
    expect(session.type).toBe('external');
  });
});

describe('Session State Updates via Events', () => {
  afterAll(async () => {
    await cleanupTestSessions();
  });

  it('pre_tool_use sets status to working', async () => {
    const sessionsRes = await get('/sessions', SERVER_PORT);
    const session = sessionsRes.body.sessions.find(
      (s: any) => s.claudeSessionId && s.type === 'external' && !s.name?.startsWith(TEST_PREFIX)
    );

    if (!session) {
      console.log('Skipping test: no external session available');
      return;
    }

    const event = {
      id: `${TEST_PREFIX}working-${Date.now()}`,
      type: 'pre_tool_use',
      timestamp: Date.now(),
      sessionId: session.claudeSessionId,
      cwd: session.cwd,
      tool: 'Edit',
      toolInput: { file_path: '/tmp/test.txt' }
    };

    appendFileSync(EVENTS_FILE, JSON.stringify(event) + '\n');

    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, 300));

    const updatedRes = await get('/sessions', SERVER_PORT);
    const updated = updatedRes.body.sessions.find((s: any) => s.id === session.id);

    expect(updated.status).toBe('working');
    expect(updated.currentTool).toBe('Edit');
  });

  it('stop sets status to waiting', async () => {
    const sessionsRes = await get('/sessions', SERVER_PORT);
    const session = sessionsRes.body.sessions.find(
      (s: any) => s.claudeSessionId && s.type === 'external' && !s.name?.startsWith(TEST_PREFIX)
    );

    if (!session) {
      console.log('Skipping test: no external session available');
      return;
    }

    const event = {
      id: `${TEST_PREFIX}stop-${Date.now()}`,
      type: 'stop',
      timestamp: Date.now(),
      sessionId: session.claudeSessionId,
      cwd: session.cwd,
      response: 'Done!'
    };

    appendFileSync(EVENTS_FILE, JSON.stringify(event) + '\n');

    await new Promise(resolve => setTimeout(resolve, 300));

    const updatedRes = await get('/sessions', SERVER_PORT);
    const updated = updatedRes.body.sessions.find((s: any) => s.id === session.id);

    expect(updated.status).toBe('waiting');
  });
});

describe('Event Deduplication', () => {
  const openSockets: WebSocket[] = [];

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

  it('duplicate event IDs are not broadcast twice', async () => {
    const ws = createTestWebSocket(WS_URL);
    openSockets.push(ws);

    await waitForOpen(ws);
    await drainMessages(ws, 4);

    const eventId = `${TEST_PREFIX}dedup-${Date.now()}`;
    const event = {
      id: eventId,
      type: 'pre_tool_use',
      timestamp: Date.now(),
      sessionId: `${TEST_PREFIX}dedup-session`,
      cwd: `/tmp/${TEST_PREFIX}dedup`,
      tool: 'Bash'
    };

    // Write same event twice
    appendFileSync(EVENTS_FILE, JSON.stringify(event) + '\n');
    appendFileSync(EVENTS_FILE, JSON.stringify(event) + '\n');

    // Wait for the first event by ID
    const msg1 = await waitForEventById(ws, eventId, 2000);
    expect(msg1.payload.id).toBe(eventId);

    // Second identical event should not be broadcast (timeout expected)
    // We use a short timeout since duplicates should be filtered immediately
    let gotDuplicate = false;
    try {
      // Listen for any event with same ID - should timeout
      const msg2 = await waitForEventById(ws, eventId, 500);
      gotDuplicate = true;
    } catch {
      // Timeout is expected - no duplicate broadcast
    }
    expect(gotDuplicate).toBe(false);
  });
});
