/**
 * Tests for configuration and utility endpoints
 */

import { describe, it, expect } from 'vitest';
import { get } from '../../utils';

const SERVER_PORT = 4003;

describe('GET /config', () => {
  it('returns configuration with required fields', async () => {
    const res = await get('/config', SERVER_PORT);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('username');
    expect(res.body).toHaveProperty('hostname');
    expect(res.body).toHaveProperty('tmuxSession');
  });

  it('username is a non-empty string', async () => {
    const res = await get('/config', SERVER_PORT);

    expect(typeof res.body.username).toBe('string');
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
  });

  it('toolCounts is an object with tool names and counts', async () => {
    const res = await get('/stats', SERVER_PORT);

    expect(typeof res.body.toolCounts).toBe('object');
    // Each tool count should be a number
    for (const [tool, count] of Object.entries(res.body.toolCounts)) {
      expect(typeof tool).toBe('string');
      expect(typeof count).toBe('number');
    }
  });

  it('avgDurations contains average durations per tool', async () => {
    const res = await get('/stats', SERVER_PORT);

    expect(typeof res.body.avgDurations).toBe('object');
    // Each duration should be a number
    for (const [tool, duration] of Object.entries(res.body.avgDurations)) {
      expect(typeof tool).toBe('string');
      expect(typeof duration).toBe('number');
    }
  });

  it('totalEvents is a number', async () => {
    const res = await get('/stats', SERVER_PORT);

    expect(typeof res.body.totalEvents).toBe('number');
    expect(res.body.totalEvents).toBeGreaterThanOrEqual(0);
  });
});

describe('GET /projects', () => {
  it('returns list of known project directories', async () => {
    const res = await get('/projects', SERVER_PORT);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.projects)).toBe(true);
  });

  it('projects have required fields', async () => {
    const res = await get('/projects', SERVER_PORT);

    for (const project of res.body.projects) {
      expect(project).toHaveProperty('path');
      expect(typeof project.path).toBe('string');
    }
  });
});

describe('GET /projects/autocomplete', () => {
  it('returns autocomplete suggestions for partial path', async () => {
    const res = await get('/projects/autocomplete?q=/tmp', SERVER_PORT);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.suggestions)).toBe(true);
  });

  it('suggestions are valid directory paths', async () => {
    const res = await get('/projects/autocomplete?q=/tmp', SERVER_PORT);

    for (const suggestion of res.body.suggestions) {
      expect(typeof suggestion).toBe('string');
      expect(suggestion.startsWith('/')).toBe(true);
    }
  });

  it('handles empty query', async () => {
    const res = await get('/projects/autocomplete', SERVER_PORT);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.suggestions)).toBe(true);
  });
});

describe('GET /projects/default', () => {
  it('returns a default project directory', async () => {
    const res = await get('/projects/default', SERVER_PORT);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body).toHaveProperty('path');
    expect(typeof res.body.path).toBe('string');
  });
});
