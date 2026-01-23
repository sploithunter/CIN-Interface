/**
 * Unit tests for GitStatusManager
 * Tests git status tracking functionality with real git repos
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { GitStatusManager } from '../../src/server/GitStatusManager';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

const TEST_PREFIX = '__test_git_status__';

describe('GitStatusManager', () => {
  let manager: GitStatusManager;
  let tempRepoDir: string;
  let tempNonRepoDir: string;

  beforeAll(() => {
    // Create temp directories
    tempRepoDir = `/tmp/${TEST_PREFIX}repo-${Date.now()}`;
    tempNonRepoDir = `/tmp/${TEST_PREFIX}nonrepo-${Date.now()}`;

    fs.mkdirSync(tempRepoDir, { recursive: true });
    fs.mkdirSync(tempNonRepoDir, { recursive: true });

    // Initialize git repo with a commit
    execSync('git init', { cwd: tempRepoDir });
    execSync('git config user.email "test@test.com"', { cwd: tempRepoDir });
    execSync('git config user.name "Test"', { cwd: tempRepoDir });
    fs.writeFileSync(path.join(tempRepoDir, 'README.md'), '# Test Repo');
    execSync('git add .', { cwd: tempRepoDir });
    execSync('git commit -m "Initial commit"', { cwd: tempRepoDir });
  });

  afterAll(() => {
    // Clean up temp directories
    try {
      fs.rmSync(tempRepoDir, { recursive: true, force: true });
      fs.rmSync(tempNonRepoDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  beforeEach(() => {
    manager = new GitStatusManager();
  });

  afterEach(() => {
    manager.stop();
  });

  describe('track and untrack', () => {
    it('tracks a session directory', async () => {
      manager.track('session-1', tempRepoDir);

      // Wait for async fetch to complete
      await new Promise(resolve => setTimeout(resolve, 100));

      const status = manager.getStatus('session-1');
      expect(status).not.toBeNull();
      expect(status?.isRepo).toBe(true);
    });

    it('untracks a session', async () => {
      manager.track('session-1', tempRepoDir);
      await new Promise(resolve => setTimeout(resolve, 100));

      manager.untrack('session-1');

      const status = manager.getStatus('session-1');
      expect(status).toBeNull();
    });

    it('returns null for untracked sessions', () => {
      const status = manager.getStatus('nonexistent');
      expect(status).toBeNull();
    });
  });

  describe('getStatus', () => {
    it('detects git repository', async () => {
      manager.track('repo-session', tempRepoDir);
      await new Promise(resolve => setTimeout(resolve, 100));

      const status = manager.getStatus('repo-session');
      expect(status).not.toBeNull();
      expect(status?.isRepo).toBe(true);
      expect(status?.branch).toBeTruthy();
    });

    it('detects non-repo directory', async () => {
      manager.track('nonrepo-session', tempNonRepoDir);
      await new Promise(resolve => setTimeout(resolve, 100));

      const status = manager.getStatus('nonrepo-session');
      expect(status).not.toBeNull();
      expect(status?.isRepo).toBe(false);
      expect(status?.branch).toBe('');
    });

    it('returns correct branch name', async () => {
      manager.track('session', tempRepoDir);
      await new Promise(resolve => setTimeout(resolve, 100));

      const status = manager.getStatus('session');
      // Default branch is either 'main' or 'master' depending on git config
      expect(['main', 'master']).toContain(status?.branch);
    });

    it('returns last commit info', async () => {
      manager.track('session', tempRepoDir);
      await new Promise(resolve => setTimeout(resolve, 100));

      const status = manager.getStatus('session');
      expect(status?.lastCommitMessage).toBe('Initial commit');
      expect(status?.lastCommitTime).toBeGreaterThan(0);
    });
  });

  describe('getAllStatuses', () => {
    it('returns all tracked statuses', async () => {
      manager.track('session-1', tempRepoDir);
      manager.track('session-2', tempNonRepoDir);
      await new Promise(resolve => setTimeout(resolve, 100));

      const allStatuses = manager.getAllStatuses();
      expect(allStatuses.size).toBe(2);
      expect(allStatuses.has('session-1')).toBe(true);
      expect(allStatuses.has('session-2')).toBe(true);
    });

    it('returns empty map when nothing tracked', () => {
      const allStatuses = manager.getAllStatuses();
      expect(allStatuses.size).toBe(0);
    });
  });

  describe('update handler', () => {
    it('calls handler on status change', async () => {
      const updates: Array<{ sessionId: string }> = [];
      manager.setUpdateHandler((update) => {
        updates.push(update);
      });

      manager.track('session-1', tempRepoDir);
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(updates.length).toBeGreaterThan(0);
      expect(updates[0].sessionId).toBe('session-1');
    });
  });

  describe('refresh', () => {
    it('refreshes status for tracked session', async () => {
      manager.track('session', tempRepoDir);
      await new Promise(resolve => setTimeout(resolve, 100));

      const status = await manager.refresh('session');
      expect(status).not.toBeNull();
      expect(status?.isRepo).toBe(true);
    });

    it('returns null for untracked session', async () => {
      const status = await manager.refresh('nonexistent');
      expect(status).toBeNull();
    });
  });

  describe('file changes detection', () => {
    it('detects untracked files', async () => {
      // Create an untracked file
      const untrackedFile = path.join(tempRepoDir, 'untracked.txt');
      fs.writeFileSync(untrackedFile, 'untracked content');

      manager.track('session', tempRepoDir);
      await new Promise(resolve => setTimeout(resolve, 100));

      const status = manager.getStatus('session');
      expect(status?.untracked).toBeGreaterThan(0);

      // Clean up
      fs.unlinkSync(untrackedFile);
    });

    it('detects staged files', async () => {
      // Create and stage a file
      const stagedFile = path.join(tempRepoDir, 'staged.txt');
      fs.writeFileSync(stagedFile, 'staged content');
      execSync('git add staged.txt', { cwd: tempRepoDir });

      manager.track('session', tempRepoDir);
      await new Promise(resolve => setTimeout(resolve, 100));

      const status = manager.getStatus('session');
      expect(status?.staged.added).toBeGreaterThan(0);

      // Clean up
      execSync('git reset HEAD staged.txt', { cwd: tempRepoDir });
      fs.unlinkSync(stagedFile);
    });

    it('detects modified files', async () => {
      // Modify existing file
      const readmePath = path.join(tempRepoDir, 'README.md');
      const originalContent = fs.readFileSync(readmePath, 'utf-8');
      fs.writeFileSync(readmePath, '# Modified Test Repo\nWith extra content');

      manager.track('session', tempRepoDir);
      await new Promise(resolve => setTimeout(resolve, 200));

      const status = manager.getStatus('session');
      // Check either modified count or lines changed (git may report differently)
      const hasChanges = (status?.unstaged.modified ?? 0) > 0 ||
                         (status?.linesAdded ?? 0) > 0 ||
                         (status?.linesRemoved ?? 0) > 0;
      expect(hasChanges).toBe(true);

      // Clean up
      fs.writeFileSync(readmePath, originalContent);
    });
  });

  describe('start and stop', () => {
    it('starts polling without error', () => {
      expect(() => manager.start()).not.toThrow();
    });

    it('stops polling without error', () => {
      manager.start();
      expect(() => manager.stop()).not.toThrow();
    });

    it('can be started multiple times safely', () => {
      manager.start();
      manager.start();
      expect(() => manager.stop()).not.toThrow();
    });

    it('can be stopped when not started', () => {
      expect(() => manager.stop()).not.toThrow();
    });
  });
});
