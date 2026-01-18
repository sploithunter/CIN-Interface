/**
 * Test setup file - runs before all tests
 */

import { mkdirSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Create isolated test data directory
export const TEST_DATA_DIR = join(tmpdir(), 'cin-interface-test-' + process.pid);
export const TEST_EVENTS_FILE = join(TEST_DATA_DIR, 'events.jsonl');
export const TEST_SESSIONS_FILE = join(TEST_DATA_DIR, 'sessions.json');

// Setup before all tests
beforeAll(() => {
  // Create test data directory
  if (!existsSync(TEST_DATA_DIR)) {
    mkdirSync(TEST_DATA_DIR, { recursive: true });
  }
});

// Cleanup after all tests
afterAll(() => {
  // Remove test data directory
  if (existsSync(TEST_DATA_DIR)) {
    rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  }
});
