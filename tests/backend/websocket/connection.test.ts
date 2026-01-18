/**
 * Tests for WebSocket connection and messaging
 */

import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { waitForOpen, waitForMessage, waitForMessageType, waitForEventById, collectMessages, post, createTestEvent, createTestWebSocket, del } from '../../utils';

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

    // Set up listener before waiting for open to capture all messages
    const messages: any[] = [];
    ws.on('message', (data) => {
      try {
        messages.push(JSON.parse(data.toString()));
      } catch { }
    });

    await waitForOpen(ws);
    // Wait for all initial messages to arrive
    await new Promise(resolve => setTimeout(resolve, 200));

    const connectedMsg = messages.find(m => m.type === 'connected');
    expect(connectedMsg).toBeDefined();
    expect(connectedMsg.payload).toHaveProperty('sessionId');
  });

  it('sends sessions list in initial messages', async () => {
    const ws = createTestWebSocket(WS_URL);
    openSockets.push(ws);

    // Set up listener before waiting for open to capture all messages
    const messages: any[] = [];
    ws.on('message', (data) => {
      try {
        messages.push(JSON.parse(data.toString()));
      } catch { }
    });

    await waitForOpen(ws);
    await new Promise(resolve => setTimeout(resolve, 200));

    const sessionsMsg = messages.find(m => m.type === 'sessions');
    expect(sessionsMsg).toBeDefined();
    expect(Array.isArray(sessionsMsg.payload)).toBe(true);
  });

  it('sends text_tiles in initial messages', async () => {
    const ws = createTestWebSocket(WS_URL);
    openSockets.push(ws);

    // Set up listener before waiting for open to capture all messages
    const messages: any[] = [];
    ws.on('message', (data) => {
      try {
        messages.push(JSON.parse(data.toString()));
      } catch { }
    });

    await waitForOpen(ws);
    await new Promise(resolve => setTimeout(resolve, 200));

    const tilesMsg = messages.find(m => m.type === 'text_tiles');
    expect(tilesMsg).toBeDefined();
  });

  it('sends history in initial messages', async () => {
    const ws = createTestWebSocket(WS_URL);
    openSockets.push(ws);

    // Set up listener before waiting for open to capture all messages
    const messages: any[] = [];
    ws.on('message', (data) => {
      try {
        messages.push(JSON.parse(data.toString()));
      } catch { }
    });

    await waitForOpen(ws);
    await new Promise(resolve => setTimeout(resolve, 200));

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

    // Set up message collector before opening
    const messages: any[] = [];
    ws.on('message', (data) => {
      try {
        messages.push(JSON.parse(data.toString()));
      } catch { }
    });

    await waitForOpen(ws);
    // Wait for initial messages to arrive
    await new Promise(resolve => setTimeout(resolve, 300));

    // Clear collected initial messages
    messages.length = 0;

    // Post event via HTTP with unique ID
    const eventId = `broadcast-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const event = createTestEvent({ id: eventId });
    await post('/event', event, SERVER_PORT);

    // Wait for the event to be broadcast
    await new Promise(resolve => setTimeout(resolve, 500));

    // Find our event
    const eventMsg = messages.find(m => m.type === 'event' && m.payload?.id === eventId);
    expect(eventMsg).toBeDefined();
    expect(eventMsg.payload.id).toBe(eventId);
  });

  it('broadcasts to multiple clients', async () => {
    const ws1 = createTestWebSocket(WS_URL);
    const ws2 = createTestWebSocket(WS_URL);
    openSockets.push(ws1, ws2);

    // Set up message collectors before opening
    const messages1: any[] = [];
    const messages2: any[] = [];
    ws1.on('message', (data) => {
      try {
        messages1.push(JSON.parse(data.toString()));
      } catch { }
    });
    ws2.on('message', (data) => {
      try {
        messages2.push(JSON.parse(data.toString()));
      } catch { }
    });

    await Promise.all([waitForOpen(ws1), waitForOpen(ws2)]);
    // Wait for initial messages
    await new Promise(resolve => setTimeout(resolve, 300));

    // Clear initial messages
    messages1.length = 0;
    messages2.length = 0;

    // Post event with unique ID
    const eventId = `multi-broadcast-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const event = createTestEvent({ id: eventId });
    await post('/event', event, SERVER_PORT);

    // Wait for broadcasts
    await new Promise(resolve => setTimeout(resolve, 500));

    // Both clients should have received the event
    const msg1 = messages1.find(m => m.type === 'event' && m.payload?.id === eventId);
    const msg2 = messages2.find(m => m.type === 'event' && m.payload?.id === eventId);

    expect(msg1).toBeDefined();
    expect(msg2).toBeDefined();
    expect(msg1.payload.id).toBe(eventId);
    expect(msg2.payload.id).toBe(eventId);
  });

  it('broadcasts session updates', async () => {
    const ws = createTestWebSocket(WS_URL);
    openSockets.push(ws);

    // Set up message collector before opening
    const messages: any[] = [];
    ws.on('message', (data) => {
      try {
        messages.push(JSON.parse(data.toString()));
      } catch { }
    });

    await waitForOpen(ws);
    await new Promise(resolve => setTimeout(resolve, 300));

    // Clear initial messages
    messages.length = 0;

    // Create a session (which triggers sessions broadcast)
    const res = await post('/sessions', { cwd: '/tmp', name: 'WS Broadcast Test' }, SERVER_PORT);
    if (res.body.session?.id) {
      createdSessionIds.push(res.body.session.id);
    }

    // Wait for broadcast
    await new Promise(resolve => setTimeout(resolve, 500));

    const sessionsMsg = messages.find(m => m.type === 'sessions');
    expect(sessionsMsg).toBeDefined();
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
    // Use collectMessages to gather initial messages
    await collectMessages(ws, 500);

    // Request history
    ws.send(JSON.stringify({ type: 'get_history', payload: { limit: 50 } }));

    const msg = await waitForMessageType(ws, 'history', 3000);
    expect(msg.type).toBe('history');
    expect(Array.isArray(msg.payload)).toBe(true);
  });

  it('respects history limit', async () => {
    const ws = createTestWebSocket(WS_URL);
    openSockets.push(ws);

    await waitForOpen(ws);
    await collectMessages(ws, 500);

    ws.send(JSON.stringify({ type: 'get_history', payload: { limit: 10 } }));

    // Wait specifically for a 'history' message type
    const msg = await waitForMessageType(ws, 'history', 3000);
    expect(Array.isArray(msg.payload)).toBe(true);
    expect(msg.payload.length).toBeLessThanOrEqual(10);
  });

  it('responds to ping without closing connection', async () => {
    const ws = createTestWebSocket(WS_URL);
    openSockets.push(ws);

    await waitForOpen(ws);
    await collectMessages(ws, 300);

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
    await collectMessages(ws, 300);

    ws.send(JSON.stringify({ type: 'subscribe' }));

    // Should not cause error
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(ws.readyState).toBe(WebSocket.OPEN);
  });
});
