/**
 * Tests for File Explorer API
 * These tests verify the file listing, reading, and tree endpoints.
 */

import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { get, post, del } from '../../utils';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';

const SERVER_PORT = 4003;
const TEST_PREFIX = '__test_files__';
const TEST_DIR = '/tmp/__cin_test_files__';

// Track created sessions for cleanup
const createdSessionIds: string[] = [];
let testSession: any;

/**
 * Set up test directory structure
 */
function setupTestDirectory(): void {
  // Create test directory
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true });
  }
  mkdirSync(TEST_DIR, { recursive: true });

  // Create subdirectories
  mkdirSync(join(TEST_DIR, 'subdir'));
  mkdirSync(join(TEST_DIR, 'empty-dir'));

  // Create test files
  writeFileSync(join(TEST_DIR, 'test.txt'), 'Hello, World!');
  writeFileSync(join(TEST_DIR, 'test.json'), '{"key": "value"}');
  writeFileSync(join(TEST_DIR, 'subdir', 'nested.txt'), 'Nested content');
  writeFileSync(join(TEST_DIR, '.hidden'), 'Hidden file');
}

/**
 * Clean up test files and sessions
 */
async function cleanup(): Promise<void> {
  // Clean up sessions
  for (const id of createdSessionIds) {
    try {
      await del(`/sessions/${id}`, SERVER_PORT);
    } catch {
      // Ignore cleanup errors
    }
  }
  createdSessionIds.length = 0;

  // Clean up test directory
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true });
  }
}

describe('File Explorer - List Files', () => {
  beforeAll(async () => {
    setupTestDirectory();

    // Create a test session
    const res = await post('/sessions', {
      name: `${TEST_PREFIX}session`,
      cwd: TEST_DIR,
      flags: { openTerminal: false }
    }, SERVER_PORT);
    testSession = res.body.session;
    createdSessionIds.push(testSession.id);
  });

  // Don't cleanup here - let the Directory Tree afterAll handle cleanup

  it('lists files in session cwd', async () => {
    const res = await get(`/sessions/${testSession.id}/files`, SERVER_PORT);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.path).toBe(TEST_DIR);
    expect(res.body.cwd).toBe(TEST_DIR);
    expect(Array.isArray(res.body.files)).toBe(true);
  });

  it('lists directories before files', async () => {
    const res = await get(`/sessions/${testSession.id}/files`, SERVER_PORT);

    const files = res.body.files;
    const firstDir = files.findIndex((f: any) => f.type === 'directory');
    const firstFile = files.findIndex((f: any) => f.type === 'file');

    // If both exist, directories should come first
    if (firstDir !== -1 && firstFile !== -1) {
      expect(firstDir).toBeLessThan(firstFile);
    }
  });

  it('excludes hidden files by default', async () => {
    const res = await get(`/sessions/${testSession.id}/files`, SERVER_PORT);

    const hiddenFile = res.body.files.find((f: any) => f.name === '.hidden');
    expect(hiddenFile).toBeUndefined();
  });

  it('includes file metadata', async () => {
    const res = await get(`/sessions/${testSession.id}/files`, SERVER_PORT);

    const testFile = res.body.files.find((f: any) => f.name === 'test.txt');
    expect(testFile).toBeDefined();
    expect(testFile.type).toBe('file');
    expect(typeof testFile.size).toBe('number');
    expect(typeof testFile.modified).toBe('number');
    expect(testFile.path).toBe(join(TEST_DIR, 'test.txt'));
  });

  it('lists files in subdirectory', async () => {
    const res = await get(
      `/sessions/${testSession.id}/files?path=${encodeURIComponent(join(TEST_DIR, 'subdir'))}`,
      SERVER_PORT
    );

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const nestedFile = res.body.files.find((f: any) => f.name === 'nested.txt');
    expect(nestedFile).toBeDefined();
  });

  it('returns 404 for nonexistent session', async () => {
    const res = await get('/sessions/00000000-0000-0000-0000-000000000000/files', SERVER_PORT);
    expect(res.status).toBe(404);
    expect(res.body.ok).toBe(false);
  });

  it('returns 403 for path outside session cwd', async () => {
    const res = await get(
      `/sessions/${testSession.id}/files?path=${encodeURIComponent('/usr')}`,
      SERVER_PORT
    );

    expect(res.status).toBe(403);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toContain('outside');
  });

  it('returns 404 for nonexistent path', async () => {
    const res = await get(
      `/sessions/${testSession.id}/files?path=${encodeURIComponent(join(TEST_DIR, 'nonexistent'))}`,
      SERVER_PORT
    );

    expect(res.status).toBe(404);
    expect(res.body.ok).toBe(false);
  });
});

describe('File Explorer - Read File', () => {
  beforeAll(async () => {
    // Ensure session exists (reuse from List Files tests or create new)
    if (!testSession || !testSession.id) {
      setupTestDirectory();
      const res = await post('/sessions', {
        name: `${TEST_PREFIX}read`,
        cwd: TEST_DIR,
        flags: { openTerminal: false }
      }, SERVER_PORT);
      testSession = res.body.session;
      createdSessionIds.push(testSession.id);
    }
  });

  // Don't cleanup here - let the last describe block handle it

  it('reads file content', async () => {
    const res = await get(
      `/sessions/${testSession.id}/file?path=${encodeURIComponent(join(TEST_DIR, 'test.txt'))}`,
      SERVER_PORT
    );

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.content).toBe('Hello, World!');
    expect(res.body.name).toBe('test.txt');
    expect(typeof res.body.size).toBe('number');
    expect(typeof res.body.modified).toBe('number');
  });

  it('reads JSON file', async () => {
    const res = await get(
      `/sessions/${testSession.id}/file?path=${encodeURIComponent(join(TEST_DIR, 'test.json'))}`,
      SERVER_PORT
    );

    expect(res.status).toBe(200);
    expect(res.body.content).toBe('{"key": "value"}');
  });

  it('returns 400 for missing path parameter', async () => {
    const res = await get(`/sessions/${testSession.id}/file`, SERVER_PORT);

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toContain('Missing path');
  });

  it('returns 403 for path outside session cwd', async () => {
    const res = await get(
      `/sessions/${testSession.id}/file?path=${encodeURIComponent('/etc/passwd')}`,
      SERVER_PORT
    );

    expect(res.status).toBe(403);
    expect(res.body.ok).toBe(false);
  });

  it('returns 404 for nonexistent file', async () => {
    const res = await get(
      `/sessions/${testSession.id}/file?path=${encodeURIComponent(join(TEST_DIR, 'nonexistent.txt'))}`,
      SERVER_PORT
    );

    expect(res.status).toBe(404);
    expect(res.body.ok).toBe(false);
  });

  it('returns 400 for directory path', async () => {
    const res = await get(
      `/sessions/${testSession.id}/file?path=${encodeURIComponent(join(TEST_DIR, 'subdir'))}`,
      SERVER_PORT
    );

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toContain('directory');
  });
});

describe('File Explorer - Directory Tree', () => {
  beforeAll(async () => {
    // Ensure session exists (reuse from previous tests or create new)
    if (!testSession || !testSession.id) {
      setupTestDirectory();
      const res = await post('/sessions', {
        name: `${TEST_PREFIX}tree`,
        cwd: TEST_DIR,
        flags: { openTerminal: false }
      }, SERVER_PORT);
      testSession = res.body.session;
      createdSessionIds.push(testSession.id);
    }
  });

  afterAll(async () => {
    // Final cleanup for this file
    await cleanup();
  });

  it('returns directory tree', async () => {
    const res = await get(`/sessions/${testSession.id}/files/tree`, SERVER_PORT);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.path).toBe(TEST_DIR);
    expect(Array.isArray(res.body.tree)).toBe(true);
  });

  it('includes nested directories', async () => {
    const res = await get(`/sessions/${testSession.id}/files/tree?depth=2`, SERVER_PORT);

    const subdir = res.body.tree.find((n: any) => n.name === 'subdir');
    expect(subdir).toBeDefined();
    expect(subdir.type).toBe('directory');
    expect(Array.isArray(subdir.children)).toBe(true);
  });

  it('respects depth parameter', async () => {
    const res1 = await get(`/sessions/${testSession.id}/files/tree?depth=1`, SERVER_PORT);
    const res2 = await get(`/sessions/${testSession.id}/files/tree?depth=2`, SERVER_PORT);

    // Depth 1 should have empty children for directories
    const subdirD1 = res1.body.tree.find((n: any) => n.name === 'subdir');
    const subdirD2 = res2.body.tree.find((n: any) => n.name === 'subdir');

    expect(subdirD1.children.length).toBe(0);
    expect(subdirD2.children.length).toBeGreaterThan(0);
  });

  it('returns 404 for nonexistent session', async () => {
    const res = await get('/sessions/00000000-0000-0000-0000-000000000000/files/tree', SERVER_PORT);
    expect(res.status).toBe(404);
  });

  it('returns 403 for path outside session cwd', async () => {
    const res = await get(
      `/sessions/${testSession.id}/files/tree?path=${encodeURIComponent('/usr')}`,
      SERVER_PORT
    );

    expect(res.status).toBe(403);
    expect(res.body.ok).toBe(false);
  });
});
