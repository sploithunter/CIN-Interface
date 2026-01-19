/**
 * Tests for Image Support in Prompts
 * These tests verify that images can be attached to prompts.
 */

import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { get, post, del, sleep } from '../../utils';
import { existsSync, rmSync, readdirSync } from 'fs';
import { join } from 'path';

const SERVER_PORT = 4003;
const TEST_PREFIX = '__test_image__';
const TEST_DIR = '/tmp/__cin_test_images__';

// Track created sessions for cleanup
const createdSessionIds: string[] = [];
let testSession: any;

// A small 1x1 red PNG image in base64
const TINY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

// A small 1x1 JPEG image in base64
const TINY_JPEG_BASE64 = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBEQCEAwEPwAAAsQH/2Q==';

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

describe('Image Prompt - Validation', () => {
  beforeAll(async () => {
    // Create test directory
    if (!existsSync(TEST_DIR)) {
      const { mkdirSync } = await import('fs');
      mkdirSync(TEST_DIR, { recursive: true });
    }

    // Create a test session
    const res = await post('/sessions', {
      name: `${TEST_PREFIX}validate`,
      cwd: TEST_DIR,
      flags: { openTerminal: false }
    }, SERVER_PORT);
    testSession = res.body.session;
    createdSessionIds.push(testSession.id);

    await sleep(1000);
  });

  // Don't cleanup here - let the last describe block handle cleanup

  it('accepts prompt with valid PNG image', async () => {
    const res = await post(`/sessions/${testSession.id}/prompt`, {
      prompt: 'Test prompt with image',
      images: [{
        data: TINY_PNG_BASE64,
        mediaType: 'image/png',
        name: 'test.png'
      }]
    }, SERVER_PORT);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('accepts prompt with valid JPEG image', async () => {
    const res = await post(`/sessions/${testSession.id}/prompt`, {
      prompt: 'Test prompt with JPEG',
      images: [{
        data: TINY_JPEG_BASE64,
        mediaType: 'image/jpeg',
        name: 'test.jpg'
      }]
    }, SERVER_PORT);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('accepts prompt with multiple images', async () => {
    const res = await post(`/sessions/${testSession.id}/prompt`, {
      prompt: 'Test prompt with multiple images',
      images: [
        {
          data: TINY_PNG_BASE64,
          mediaType: 'image/png',
          name: 'image1.png'
        },
        {
          data: TINY_JPEG_BASE64,
          mediaType: 'image/jpeg',
          name: 'image2.jpg'
        }
      ]
    }, SERVER_PORT);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('accepts prompt without images (backward compatible)', async () => {
    const res = await post(`/sessions/${testSession.id}/prompt`, {
      prompt: 'Test prompt without images'
    }, SERVER_PORT);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('rejects invalid media type', async () => {
    const res = await post(`/sessions/${testSession.id}/prompt`, {
      prompt: 'Test prompt',
      images: [{
        data: TINY_PNG_BASE64,
        mediaType: 'image/bmp', // Not supported
        name: 'test.bmp'
      }]
    }, SERVER_PORT);

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toContain('Invalid mediaType');
  });

  it('rejects image without data', async () => {
    const res = await post(`/sessions/${testSession.id}/prompt`, {
      prompt: 'Test prompt',
      images: [{
        mediaType: 'image/png',
        name: 'test.png'
      }]
    }, SERVER_PORT);

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toContain('data and mediaType');
  });

  it('rejects image without mediaType', async () => {
    const res = await post(`/sessions/${testSession.id}/prompt`, {
      prompt: 'Test prompt',
      images: [{
        data: TINY_PNG_BASE64,
        name: 'test.png'
      }]
    }, SERVER_PORT);

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it('still requires prompt text', async () => {
    const res = await post(`/sessions/${testSession.id}/prompt`, {
      prompt: '',
      images: [{
        data: TINY_PNG_BASE64,
        mediaType: 'image/png'
      }]
    }, SERVER_PORT);

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toContain('required');
  });
});

describe('Image Prompt - File Saving', () => {
  beforeAll(async () => {
    // Clean up first
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
    const { mkdirSync } = await import('fs');
    mkdirSync(TEST_DIR, { recursive: true });

    // Create a test session
    const res = await post('/sessions', {
      name: `${TEST_PREFIX}save`,
      cwd: TEST_DIR,
      flags: { openTerminal: false }
    }, SERVER_PORT);
    testSession = res.body.session;
    createdSessionIds.push(testSession.id);

    await sleep(1000);
  });

  // Don't cleanup here - let the last describe block handle cleanup

  it('saves images to .cin-images directory', async () => {
    const imageName = `test-save-${Date.now()}.png`;

    const res = await post(`/sessions/${testSession.id}/prompt`, {
      prompt: 'Test image saving',
      images: [{
        data: TINY_PNG_BASE64,
        mediaType: 'image/png',
        name: imageName
      }]
    }, SERVER_PORT);

    expect(res.status).toBe(200);

    // Check if .cin-images directory was created
    const imageDir = join(TEST_DIR, '.cin-images');
    expect(existsSync(imageDir)).toBe(true);

    // Check if image file exists
    const files = readdirSync(imageDir);
    const savedImage = files.find(f => f === imageName);
    expect(savedImage).toBeDefined();
  });

  it('generates filename if not provided', async () => {
    const res = await post(`/sessions/${testSession.id}/prompt`, {
      prompt: 'Test auto-named image',
      images: [{
        data: TINY_PNG_BASE64,
        mediaType: 'image/png'
        // No name provided
      }]
    }, SERVER_PORT);

    expect(res.status).toBe(200);

    // Check that an image was saved with auto-generated name
    const imageDir = join(TEST_DIR, '.cin-images');
    const files = readdirSync(imageDir);
    const autoNamedImage = files.find(f => f.startsWith('image-') && f.endsWith('.png'));
    expect(autoNamedImage).toBeDefined();
  });
});

describe('Image Prompt - Supported Formats', () => {
  beforeAll(async () => {
    if (!testSession) {
      if (!existsSync(TEST_DIR)) {
        const { mkdirSync } = await import('fs');
        mkdirSync(TEST_DIR, { recursive: true });
      }
      const res = await post('/sessions', {
        name: `${TEST_PREFIX}formats`,
        cwd: TEST_DIR,
        flags: { openTerminal: false }
      }, SERVER_PORT);
      testSession = res.body.session;
      createdSessionIds.push(testSession.id);
      await sleep(1000);
    }
  });

  afterAll(async () => {
    await cleanup();
  });

  it('accepts image/jpeg', async () => {
    const res = await post(`/sessions/${testSession.id}/prompt`, {
      prompt: 'Test JPEG',
      images: [{ data: TINY_JPEG_BASE64, mediaType: 'image/jpeg' }]
    }, SERVER_PORT);
    expect(res.status).toBe(200);
  });

  it('accepts image/png', async () => {
    const res = await post(`/sessions/${testSession.id}/prompt`, {
      prompt: 'Test PNG',
      images: [{ data: TINY_PNG_BASE64, mediaType: 'image/png' }]
    }, SERVER_PORT);
    expect(res.status).toBe(200);
  });

  it('accepts image/gif', async () => {
    // A minimal valid GIF
    const GIF_BASE64 = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    const res = await post(`/sessions/${testSession.id}/prompt`, {
      prompt: 'Test GIF',
      images: [{ data: GIF_BASE64, mediaType: 'image/gif' }]
    }, SERVER_PORT);
    expect(res.status).toBe(200);
  });

  it('accepts image/webp', async () => {
    // For WebP we'll use a tiny valid webp (may fail if decoding is strict)
    const res = await post(`/sessions/${testSession.id}/prompt`, {
      prompt: 'Test WebP',
      images: [{ data: TINY_PNG_BASE64, mediaType: 'image/webp' }] // Using PNG data, server doesn't validate image content
    }, SERVER_PORT);
    expect(res.status).toBe(200);
  });

  it('rejects image/svg+xml', async () => {
    const res = await post(`/sessions/${testSession.id}/prompt`, {
      prompt: 'Test SVG',
      images: [{ data: 'PHN2Zz48L3N2Zz4=', mediaType: 'image/svg+xml' }]
    }, SERVER_PORT);
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Invalid mediaType');
  });

  it('rejects application/pdf', async () => {
    const res = await post(`/sessions/${testSession.id}/prompt`, {
      prompt: 'Test PDF',
      images: [{ data: 'JVBERi0=', mediaType: 'application/pdf' }]
    }, SERVER_PORT);
    expect(res.status).toBe(400);
  });
});
