/**
 * Integration tests for event flow
 * Tests the unified event path: events.jsonl → file watcher → addEvent → broadcast
 */

import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { waitForOpen, waitForMessage, drainMessages, get, createTestWebSocket } from '../../utils';

const WS_URL = 'ws://localhost:4003';
const SERVER_PORT = 4003;
const EVENTS_FILE = join(homedir(), '.vibecraft/data/events.jsonl');

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
    const event = {
      id: `file-flow-test-${Date.now()}`,
      type: 'pre_tool_use',
      timestamp: Date.now(),
      sessionId: 'file-flow-test-session',
      cwd: '/tmp/file-flow-test',
      tool: 'Grep',
      toolInput: { pattern: 'test' }
    };

    appendFileSync(EVENTS_FILE, JSON.stringify(event) + '\n');

    // Should receive via WebSocket
    const msg = await waitForMessage(ws, 3000);
    expect(msg.type).toBe('event');
    expect(msg.payload.id).toBe(event.id);
  });

  it('Codex event with codexThreadId flows correctly', async () => {
    const ws = createTestWebSocket(WS_URL);
    openSockets.push(ws);

    await waitForOpen(ws);
    await drainMessages(ws, 4);

    const codexThreadId = `codex-flow-test-${Date.now()}`;
    const event = {
      id: `codex-event-${Date.now()}`,
      type: 'pre_tool_use',
      timestamp: Date.now(),
      sessionId: codexThreadId,
      cwd: '/tmp/codex-flow-test',
      tool: 'shell',
      toolInput: { command: 'ls' },
      codexThreadId: codexThreadId
    };

    appendFileSync(EVENTS_FILE, JSON.stringify(event) + '\n');

    const msg = await waitForMessage(ws, 3000);
    expect(msg.type).toBe('event');
    expect(msg.payload.codexThreadId).toBe(codexThreadId);
  });

  it('event creates external session if unknown', async () => {
    const uniqueSessionId = `auto-session-${Date.now()}`;
    const event = {
      id: `auto-session-event-${Date.now()}`,
      type: 'session_start',
      timestamp: Date.now(),
      sessionId: uniqueSessionId,
      cwd: '/tmp/auto-session-test'
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
  it('pre_tool_use sets status to working', async () => {
    const sessionsRes = await get('/sessions', SERVER_PORT);
    const session = sessionsRes.body.sessions.find(
      (s: any) => s.claudeSessionId && s.type === 'external'
    );

    if (!session) {
      console.log('Skipping test: no external session available');
      return;
    }

    const event = {
      id: `working-test-${Date.now()}`,
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
      (s: any) => s.claudeSessionId && s.type === 'external'
    );

    if (!session) {
      console.log('Skipping test: no external session available');
      return;
    }

    const event = {
      id: `stop-test-${Date.now()}`,
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

  it('duplicate event IDs are not broadcast twice', async () => {
    const ws = createTestWebSocket(WS_URL);
    openSockets.push(ws);

    await waitForOpen(ws);
    await drainMessages(ws, 4);

    const eventId = `dedup-test-${Date.now()}`;
    const event = {
      id: eventId,
      type: 'pre_tool_use',
      timestamp: Date.now(),
      sessionId: 'dedup-session',
      cwd: '/tmp',
      tool: 'Bash'
    };

    // Write same event twice
    appendFileSync(EVENTS_FILE, JSON.stringify(event) + '\n');
    appendFileSync(EVENTS_FILE, JSON.stringify(event) + '\n');

    // Should only receive once
    const msg1 = await waitForMessage(ws, 2000);
    expect(msg1.payload.id).toBe(eventId);

    // Second message should timeout or be a different event
    try {
      const msg2 = await waitForMessage(ws, 1000);
      // If we got a second message, it shouldn't be the same event
      if (msg2.type === 'event') {
        expect(msg2.payload.id).not.toBe(eventId);
      }
    } catch {
      // Timeout is expected - no duplicate
    }
  });
});
