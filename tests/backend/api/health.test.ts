/**
 * Tests for health and config endpoints
 */

import { describe, it, expect } from 'vitest';
import { get } from '../../utils';

// These tests run against the live server on port 4003
// Make sure the server is running before running tests
const SERVER_PORT = 4003;

describe('GET /health', () => {
  it('returns server status with required fields', async () => {
    const res = await get('/health', SERVER_PORT);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      version: expect.any(String),
      clients: expect.any(Number),
      events: expect.any(Number)
    });
  });

  it('has ok status true', async () => {
    const res = await get('/health', SERVER_PORT);
    expect(res.body.ok).toBe(true);
  });
});

describe('GET /config', () => {
  it('returns user and hostname', async () => {
    const res = await get('/config', SERVER_PORT);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      username: expect.any(String),
      hostname: expect.any(String)
    });
  });

  it('username is not empty', async () => {
    const res = await get('/config', SERVER_PORT);
    expect(res.body.username.length).toBeGreaterThan(0);
  });
});

describe('GET /stats', () => {
  it('returns tool usage statistics', async () => {
    const res = await get('/stats', SERVER_PORT);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('totalEvents');
    expect(res.body).toHaveProperty('toolCounts');
    expect(res.body).toHaveProperty('avgDurations');
    expect(typeof res.body.toolCounts).toBe('object');
  });

  it('toolCounts contains known tools', async () => {
    const res = await get('/stats', SERVER_PORT);
    const toolCounts = res.body.toolCounts;

    // Check for common tools (at least one should be present if events exist)
    const knownTools = ['Edit', 'Bash', 'Write', 'Read', 'Grep', 'Glob', 'TodoWrite'];
    const hasKnownTool = knownTools.some(tool => tool in toolCounts);

    // If there are events, we should have some tool counts
    if (res.body.totalEvents > 0) {
      expect(hasKnownTool).toBe(true);
    }
  });
});
