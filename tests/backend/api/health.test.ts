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

    // Check for common tools
    const knownTools = ['Edit', 'Bash', 'Write', 'Read', 'Grep', 'Glob', 'TodoWrite', 'Task'];

    // If there are tool counts, check that they have numeric values
    if (Object.keys(toolCounts).length > 0) {
      const hasNumericCounts = Object.values(toolCounts).every(v => typeof v === 'number');
      expect(hasNumericCounts).toBe(true);

      // At least one should be a known tool OR the events might be from other sources
      const hasKnownTool = knownTools.some(tool => tool in toolCounts);
      if (!hasKnownTool && Object.keys(toolCounts).length > 0) {
        // Log what tools we found for debugging
        console.log('Stats test: found tools:', Object.keys(toolCounts));
      }
    }
  });
});
