/**
 * Test utilities for CIN-Interface tests
 */

import WebSocket from 'ws';
import { createServer, Server, IncomingMessage, ServerResponse } from 'http';
import { AddressInfo } from 'net';

// Default test server URL
export const TEST_PORT = 4099;
export const TEST_URL = `http://localhost:${TEST_PORT}`;
export const TEST_WS_URL = `ws://localhost:${TEST_PORT}`;

/**
 * Create a WebSocket with proper origin header for testing
 */
export function createTestWebSocket(url: string): WebSocket {
  return new WebSocket(url, {
    origin: url.replace('ws://', 'http://').replace(/\/$/, '')
  });
}

/**
 * Wait for WebSocket to open
 */
export function waitForOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) {
      resolve();
    } else {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    }
  });
}

/**
 * Wait for a WebSocket message
 */
export function waitForMessage(ws: WebSocket, timeout = 5000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for WebSocket message (${timeout}ms)`));
    }, timeout);

    ws.once('message', (data) => {
      clearTimeout(timer);
      try {
        resolve(JSON.parse(data.toString()));
      } catch {
        resolve(data.toString());
      }
    });
  });
}

/**
 * Drain N messages from WebSocket
 * Note: This uses sequential waitForMessage calls which may miss messages
 * that arrive faster than the loop can process. For initial connection
 * messages, use collectMessages instead.
 */
export async function drainMessages(ws: WebSocket, count: number): Promise<any[]> {
  const messages: any[] = [];
  for (let i = 0; i < count; i++) {
    try {
      messages.push(await waitForMessage(ws, 2000));
    } catch {
      break; // No more messages
    }
  }
  return messages;
}

/**
 * Collect messages from WebSocket with a timeout
 * Sets up listener before waiting, to capture all rapid-fire messages
 */
export function collectMessages(ws: WebSocket, timeout = 1000): Promise<any[]> {
  return new Promise((resolve) => {
    const messages: any[] = [];
    const handler = (data: WebSocket.Data) => {
      try {
        messages.push(JSON.parse(data.toString()));
      } catch {
        // Ignore parse errors
      }
    };

    ws.on('message', handler);

    setTimeout(() => {
      ws.removeListener('message', handler);
      resolve(messages);
    }, timeout);
  });
}

/**
 * Wait for a WebSocket message of a specific type
 * Keeps reading messages until it finds one with the matching type or times out
 */
export function waitForMessageType(ws: WebSocket, type: string, timeout = 5000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.removeListener('message', handler);
      reject(new Error(`Timeout waiting for message type '${type}' (${timeout}ms)`));
    }, timeout);

    const handler = (data: WebSocket.Data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === type) {
          clearTimeout(timer);
          ws.removeListener('message', handler);
          resolve(msg);
        }
        // If not the right type, keep listening
      } catch {
        // Ignore parse errors, keep listening
      }
    };

    ws.on('message', handler);
  });
}

/**
 * Wait for an event with a specific ID
 * Keeps reading messages until it finds the matching event or times out
 */
export function waitForEventById(ws: WebSocket, eventId: string, timeout = 5000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.removeListener('message', handler);
      reject(new Error(`Timeout waiting for event '${eventId}' (${timeout}ms)`));
    }, timeout);

    const handler = (data: WebSocket.Data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'event' && msg.payload?.id === eventId) {
          clearTimeout(timer);
          ws.removeListener('message', handler);
          resolve(msg);
        }
        // If not the right event, keep listening
      } catch {
        // Ignore parse errors, keep listening
      }
    };

    ws.on('message', handler);
  });
}

/**
 * Sleep for specified milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Create a test event with defaults
 * Uses __test__ prefix to identify test-created sessions for cleanup
 */
export function createTestEvent(overrides: Partial<TestEvent> = {}): TestEvent {
  return {
    id: `__test__event-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    type: 'pre_tool_use',
    timestamp: Date.now(),
    sessionId: '__test__default-session',
    cwd: '/tmp/__test__default',
    tool: 'Bash',
    toolInput: { command: 'echo test' },
    ...overrides
  };
}

interface TestEvent {
  id: string;
  type: string;
  timestamp: number;
  sessionId: string;
  cwd: string;
  tool?: string;
  toolInput?: Record<string, unknown>;
  toolResponse?: Record<string, unknown>;
  response?: string;
  codexThreadId?: string;
}

/**
 * Make HTTP request to test server
 */
export async function request(
  method: string,
  path: string,
  body?: unknown,
  port = TEST_PORT
): Promise<{ status: number; body: any }> {
  const url = `http://localhost:${port}${path}`;
  const options: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json'
    }
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);

  // Read body as text first to avoid "body already read" errors
  const text = await response.text();
  let responseBody: any;

  try {
    responseBody = JSON.parse(text);
  } catch {
    responseBody = text;
  }

  return {
    status: response.status,
    body: responseBody
  };
}

/**
 * GET request helper
 */
export function get(path: string, port = TEST_PORT) {
  return request('GET', path, undefined, port);
}

/**
 * POST request helper
 */
export function post(path: string, body?: unknown, port = TEST_PORT) {
  return request('POST', path, body, port);
}

/**
 * PATCH request helper
 */
export function patch(path: string, body?: unknown, port = TEST_PORT) {
  return request('PATCH', path, body, port);
}

/**
 * DELETE request helper
 */
export function del(path: string, port = TEST_PORT) {
  return request('DELETE', path, undefined, port);
}
