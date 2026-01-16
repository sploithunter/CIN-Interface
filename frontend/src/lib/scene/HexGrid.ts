/**
 * Hexagonal grid utilities using axial coordinates (q, r)
 * Reference: https://www.redblobgames.com/grids/hexagons/
 */

import * as THREE from 'three';

export interface HexCoord {
  q: number;
  r: number;
}

// Hex grid configuration
export const HEX_SIZE = 3.5; // Radius of hexagon (larger for better visibility)
export const HEX_HEIGHT = 0.4; // Height of hex platform
export const HEX_GAP = 0.2; // Gap between hexagons

// Convert axial (q, r) to world position (x, y, z)
export function hexToWorld(hex: HexCoord): THREE.Vector3 {
  const size = HEX_SIZE + HEX_GAP;
  // Pointy-top hexagon layout
  const x = size * (Math.sqrt(3) * hex.q + (Math.sqrt(3) / 2) * hex.r);
  const z = size * (3 / 2) * hex.r;
  return new THREE.Vector3(x, 0, z);
}

// Convert world position to nearest hex coordinate
export function worldToHex(pos: THREE.Vector3): HexCoord {
  const size = HEX_SIZE + HEX_GAP;
  // Inverse of hexToWorld
  const q = ((Math.sqrt(3) / 3) * pos.x - (1 / 3) * pos.z) / size;
  const r = ((2 / 3) * pos.z) / size;
  return hexRound({ q, r });
}

// Round fractional hex coordinates to nearest integer hex
export function hexRound(hex: HexCoord): HexCoord {
  // Convert to cube coordinates
  const x = hex.q;
  const z = hex.r;
  const y = -x - z;

  let rx = Math.round(x);
  let ry = Math.round(y);
  let rz = Math.round(z);

  const xDiff = Math.abs(rx - x);
  const yDiff = Math.abs(ry - y);
  const zDiff = Math.abs(rz - z);

  // Adjust the component with the largest diff to satisfy x + y + z = 0
  if (xDiff > yDiff && xDiff > zDiff) {
    rx = -ry - rz;
  } else if (yDiff > zDiff) {
    ry = -rx - rz;
  } else {
    rz = -rx - ry;
  }

  return { q: rx, r: rz };
}

// Get all hexes within a certain ring distance
export function hexRing(center: HexCoord, radius: number): HexCoord[] {
  if (radius === 0) return [center];

  const results: HexCoord[] = [];
  const directions = [
    { q: 1, r: 0 },
    { q: 0, r: 1 },
    { q: -1, r: 1 },
    { q: -1, r: 0 },
    { q: 0, r: -1 },
    { q: 1, r: -1 },
  ];

  let hex = { q: center.q + radius * directions[4].q, r: center.r + radius * directions[4].r };

  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < radius; j++) {
      results.push({ ...hex });
      hex = { q: hex.q + directions[i].q, r: hex.r + directions[i].r };
    }
  }

  return results;
}

// Get all hexes within a certain distance (filled spiral)
export function hexSpiral(center: HexCoord, radius: number): HexCoord[] {
  const results: HexCoord[] = [center];
  for (let r = 1; r <= radius; r++) {
    results.push(...hexRing(center, r));
  }
  return results;
}

// Distance between two hex coordinates
export function hexDistance(a: HexCoord, b: HexCoord): number {
  return (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2;
}

// Create hexagon geometry (pointy-top)
export function createHexGeometry(size: number = HEX_SIZE, height: number = HEX_HEIGHT): THREE.CylinderGeometry {
  // 6 radial segments for hexagon shape
  return new THREE.CylinderGeometry(size, size, height, 6);
}

// Find the next available hex position (spiral outward from center)
export function findNextAvailableHex(occupied: Set<string>, maxRadius: number = 5): HexCoord {
  const center = { q: 0, r: 0 };

  for (let r = 0; r <= maxRadius; r++) {
    const ring = r === 0 ? [center] : hexRing(center, r);
    for (const hex of ring) {
      const key = `${hex.q},${hex.r}`;
      if (!occupied.has(key)) {
        return hex;
      }
    }
  }

  // Fallback: return a random position in outer ring
  return { q: maxRadius + 1, r: 0 };
}

// Create a set of occupied hex keys from sessions
export function getOccupiedHexes(sessions: Array<{ zonePosition?: HexCoord }>): Set<string> {
  const occupied = new Set<string>();
  for (const session of sessions) {
    if (session.zonePosition) {
      occupied.add(`${session.zonePosition.q},${session.zonePosition.r}`);
    }
  }
  return occupied;
}
