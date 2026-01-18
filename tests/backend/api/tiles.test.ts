/**
 * Tests for tiles API endpoints
 */

import { describe, it, expect, afterEach } from 'vitest';
import { get, post, del } from '../../utils';

const SERVER_PORT = 4003;

describe('GET /tiles', () => {
  it('returns list of text tiles', async () => {
    const res = await get('/tiles', SERVER_PORT);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.tiles)).toBe(true);
  });

  it('tiles have required fields', async () => {
    const res = await get('/tiles', SERVER_PORT);

    for (const tile of res.body.tiles) {
      expect(tile).toMatchObject({
        id: expect.any(String),
        text: expect.any(String),
        position: expect.objectContaining({
          q: expect.any(Number),
          r: expect.any(Number)
        })
      });
    }
  });
});

describe('POST /tiles', () => {
  const createdTileIds: string[] = [];

  afterEach(async () => {
    // Cleanup created tiles
    for (const id of createdTileIds) {
      try {
        await del(`/tiles/${id}`, SERVER_PORT);
      } catch {
        // Ignore cleanup errors
      }
    }
    createdTileIds.length = 0;
  });

  it('creates new text tile', async () => {
    const res = await post('/tiles', {
      text: 'Test Label',
      position: { q: 10, r: 10 }
    }, SERVER_PORT);

    if (res.body.tile?.id) {
      createdTileIds.push(res.body.tile.id);
    }

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.tile).toMatchObject({
      text: 'Test Label',
      position: { q: 10, r: 10 }
    });
  });

  it('tile appears in list after creation', async () => {
    const createRes = await post('/tiles', {
      text: 'List Test Tile',
      position: { q: 11, r: 11 }
    }, SERVER_PORT);

    if (createRes.body.tile?.id) {
      createdTileIds.push(createRes.body.tile.id);
    }

    const listRes = await get('/tiles', SERVER_PORT);
    const found = listRes.body.tiles.find(
      (t: any) => t.id === createRes.body.tile.id
    );

    expect(found).toBeDefined();
    expect(found.text).toBe('List Test Tile');
  });
});

describe('DELETE /tiles/:id', () => {
  it('deletes tile successfully', async () => {
    // Create a tile first
    const createRes = await post('/tiles', {
      text: 'Delete Test',
      position: { q: 12, r: 12 }
    }, SERVER_PORT);

    expect(createRes.status).toBe(201);
    const tileId = createRes.body.tile.id;

    // Delete it
    const deleteRes = await del(`/tiles/${tileId}`, SERVER_PORT);
    expect(deleteRes.status).toBe(200);

    // Verify it's gone
    const listRes = await get('/tiles', SERVER_PORT);
    const found = listRes.body.tiles.find((t: any) => t.id === tileId);
    expect(found).toBeUndefined();
  });

  it('returns 404 for nonexistent tile', async () => {
    const res = await del('/tiles/00000000-0000-0000-0000-000000000000', SERVER_PORT);
    expect(res.status).toBe(404);
    expect(res.body.ok).toBe(false);
  });
});
