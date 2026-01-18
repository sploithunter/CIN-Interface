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
 * Sleep for specified milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Create a test event with defaults
 */
export function createTestEvent(overrides: Partial<TestEvent> = {}): TestEvent {
  return {
    id: `test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    type: 'pre_tool_use',
    timestamp: Date.now(),
    sessionId: 'test-session',
    cwd: '/tmp/test',
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
