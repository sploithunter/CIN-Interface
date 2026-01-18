/**
 * Tests for WebSocket connection and messaging
 */

import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { waitForOpen, waitForMessage, waitForMessageType, waitForEventById, drainMessages, post, createTestEvent, createTestWebSocket, del } from '../../utils';

const WS_URL = 'ws://localhost:4003';
const SERVER_PORT = 4003;

describe('WebSocket Connection', () => {
  const openSockets: WebSocket[] = [];

  afterEach(() => {
    // Close all open sockets
    for (const ws of openSockets) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    }
    openSockets.length = 0;
  });

  it('accepts connection from localhost with origin', async () => {
    const ws = createTestWebSocket(WS_URL);
    openSockets.push(ws);

    await waitForOpen(ws);
    expect(ws.readyState).toBe(WebSocket.OPEN);
  });

  it('sends connected message with initial data', async () => {
    const ws = createTestWebSocket(WS_URL);
    openSockets.push(ws);

    await waitForOpen(ws);
    const message = await waitForMessage(ws);

    expect(message.type).toBe('connected');
    // Server sends sessionId of the most recent event
    expect(message.payload).toHaveProperty('sessionId');
  });

  it('sends sessions list in initial messages', async () => {
    const ws = createTestWebSocket(WS_URL);
    openSockets.push(ws);

    await waitForOpen(ws);
    // Server sends: connected, sessions, text_tiles, history
    const messages = await drainMessages(ws, 4);

    const sessionsMsg = messages.find(m => m.type === 'sessions');
    expect(sessionsMsg).toBeDefined();
    expect(Array.isArray(sessionsMsg.payload)).toBe(true);
  });

  it('sends text_tiles in initial messages', async () => {
    const ws = createTestWebSocket(WS_URL);
    openSockets.push(ws);

    await waitForOpen(ws);
    // Server sends: connected, sessions, text_tiles, history
    const messages = await drainMessages(ws, 4);

    const tilesMsg = messages.find(m => m.type === 'text_tiles');
    expect(tilesMsg).toBeDefined();
  });

  it('sends history in initial messages', async () => {
    const ws = createTestWebSocket(WS_URL);
    openSockets.push(ws);

    await waitForOpen(ws);
    // Server sends: connected, sessions, text_tiles, history
    const messages = await drainMessages(ws, 4);

    const historyMsg = messages.find(m => m.type === 'history');
    expect(historyMsg).toBeDefined();
    expect(Array.isArray(historyMsg.payload)).toBe(true);
  });
});

describe('WebSocket Broadcasting', () => {
  const openSockets: WebSocket[] = [];
  const createdSessionIds: string[] = [];

  afterEach(async () => {
    for (const ws of openSockets) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    }
    openSockets.length = 0;

    // Clean up created sessions
    for (const id of createdSessionIds) {
      try {
        await del(`/sessions/${id}`, SERVER_PORT);
      } catch {
        // Ignore cleanup errors
      }
    }
    createdSessionIds.length = 0;
  });

  it('broadcasts events to connected clients', async () => {
    const ws = createTestWebSocket(WS_URL);
    openSockets.push(ws);

    await waitForOpen(ws);
    await drainMessages(ws, 4); // connected, sessions, tiles, history

    // Post event via HTTP
    const event = createTestEvent({
      id: `broadcast-test-${Date.now()}`
    });
    await post('/event', event, SERVER_PORT);

    // Should receive the event via WebSocket (may receive other messages first)
    const msg = await waitForMessageType(ws, 'event', 3000);
    expect(msg.payload.id).toBe(event.id);
  });

  it('broadcasts to multiple clients', async () => {
    const ws1 = createTestWebSocket(WS_URL);
    const ws2 = createTestWebSocket(WS_URL);
    openSockets.push(ws1, ws2);

    await Promise.all([waitForOpen(ws1), waitForOpen(ws2)]);
    await Promise.all([drainMessages(ws1, 4), drainMessages(ws2, 4)]);

    // Post event
    const event = createTestEvent({
      id: `multi-broadcast-${Date.now()}`
    });
    await post('/event', event, SERVER_PORT);

    // Both clients should receive event (may receive other messages first)
    const [msg1, msg2] = await Promise.all([
      waitForMessageType(ws1, 'event', 3000),
      waitForMessageType(ws2, 'event', 3000)
    ]);

    expect(msg1.payload.id).toBe(event.id);
    expect(msg2.payload.id).toBe(event.id);
  });

  it('broadcasts session updates', async () => {
    const ws = createTestWebSocket(WS_URL);
    openSockets.push(ws);

    await waitForOpen(ws);
    await drainMessages(ws, 4);

    // Create a session (which triggers sessions broadcast)
    const res = await post('/sessions', { cwd: '/tmp', name: 'WS Broadcast Test' }, SERVER_PORT);
    if (res.body.session?.id) {
      createdSessionIds.push(res.body.session.id);
    }

    const msg = await waitForMessage(ws, 3000);
    expect(msg.type).toBe('sessions');
  });
});

describe('WebSocket History', () => {
  const openSockets: WebSocket[] = [];

  afterEach(() => {
    for (const ws of openSockets) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    }
    openSockets.length = 0;
  });

  it('responds to get_history request', async () => {
    const ws = createTestWebSocket(WS_URL);
    openSockets.push(ws);

    await waitForOpen(ws);
    await drainMessages(ws, 4);

    // Request history
    ws.send(JSON.stringify({ type: 'get_history', payload: { limit: 50 } }));

    const msg = await waitForMessage(ws, 3000);
    expect(msg.type).toBe('history');
    expect(Array.isArray(msg.payload)).toBe(true);
  });

  it('respects history limit', async () => {
    const ws = createTestWebSocket(WS_URL);
    openSockets.push(ws);

    await waitForOpen(ws);
    await drainMessages(ws, 4);

    ws.send(JSON.stringify({ type: 'get_history', payload: { limit: 10 } }));

    const msg = await waitForMessage(ws, 3000);
    expect(msg.payload.length).toBeLessThanOrEqual(10);
  });

  it('responds to ping without closing connection', async () => {
    const ws = createTestWebSocket(WS_URL);
    openSockets.push(ws);

    await waitForOpen(ws);
    await drainMessages(ws, 4);

    // Send ping (server doesn't respond, but shouldn't error)
    ws.send(JSON.stringify({ type: 'ping' }));

    // Give it a moment to process
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(ws.readyState).toBe(WebSocket.OPEN);
  });
});

describe('WebSocket Subscribe', () => {
  const openSockets: WebSocket[] = [];

  afterEach(() => {
    for (const ws of openSockets) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    }
    openSockets.length = 0;
  });

  it('handles subscribe message without closing connection', async () => {
    const ws = createTestWebSocket(WS_URL);
    openSockets.push(ws);

    await waitForOpen(ws);
    await drainMessages(ws, 4);

    ws.send(JSON.stringify({ type: 'subscribe' }));

    // Should not cause error
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(ws.readyState).toBe(WebSocket.OPEN);
  });
});
