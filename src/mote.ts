// mote.ts — Terrain-aware creatures with temperaments.
// Motes walk on the landscape, form bonds, deplete resources, leave settlements.

import { Terrain, getSurfaceY, getTile, Tile, isWalkable } from "./terrain";
import { W, H } from "./render";
import { SpatialGrid, getNeighbors } from "./physics";

/** Temperament axes (continuous, not classes) */
interface Temperament {
  wanderlust: number;  // 0 = homebody, 1 = restless explorer
  sociability: number; // 0 = loner, 1 = deeply social
  hardiness: number;   // 0 = fragile, 1 = resilient
}

export interface Mote {
  x: number;
  y: number;
  vx: number;
  vy: number;
  energy: number;
  age: number;
  temperament: Temperament;
  bonds: Mote[];
  bondTimer: number;
  bondFlash: number;   // 1.0 on bond formation, decays to 0
  grounded: boolean;   // is standing on terrain
  direction: number;   // -1 or 1, current walking direction

  // External forces (cursor, events)
  forceX: number;
  forceY: number;
}

const GRAVITY = 60;
const WALK_SPEED = 14;
const MAX_FALL = 60;
const JUMP_OVER = 4; // can step up 4px ledges at double res
const BOND_DIST = 14;
const BOND_TIME = 1.2;
const MAX_BONDS = 3;
const NEIGHBOR_RADIUS = 28;

export function createMote(
  x: number,
  y: number,
  energy: number,
  rng: () => number,
): Mote {
  return {
    x,
    y,
    vx: 0,
    vy: 0,
    energy,
    age: 0,
    temperament: {
      wanderlust: rng(),
      sociability: rng(),
      hardiness: rng(),
    },
    bonds: [],
    bondTimer: 0,
    bondFlash: 0,
    grounded: false,
    direction: rng() < 0.5 ? -1 : 1,
    forceX: 0,
    forceY: 0,
  };
}

export function updateMote(
  m: Mote,
  dt: number,
  terrain: Terrain,
  grid: SpatialGrid,
  energyDecay: number,
  bondStrength: number,
  rng: () => number,
): void {
  m.age += dt;
  m.bondFlash = Math.max(0, m.bondFlash - dt * 3);

  // Energy decay (modified by hardiness)
  const decayRate = energyDecay * (1.2 - m.temperament.hardiness * 0.4);
  m.energy -= decayRate * dt;
  if (m.energy <= 0) {
    m.energy = 0;
    cleanupBonds(m);
    return;
  }

  // Gravity
  if (!m.grounded) {
    m.vy += GRAVITY * dt;
    m.vy = Math.min(m.vy, MAX_FALL);
  }

  // Walking behavior
  const walkSpeed = WALK_SPEED * (0.5 + m.temperament.wanderlust * 0.8);

  // Decision making: change direction occasionally
  if (rng() < 0.02 * dt * 60) {
    m.direction *= -1;
  }

  // Social force: move toward nearby motes if sociable
  let socialFx = 0;
  let closestUnbonded: Mote | null = null;
  let closestDist = Infinity;

  const neighbors = getNeighbors(grid, m.x, m.y, NEIGHBOR_RADIUS, m);
  for (const other of neighbors) {
    const dx = other.x - m.x;
    const dy = other.y - m.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 0.5) continue;

    // Social attraction
    if (dist > 4) {
      socialFx += (dx / dist) * m.temperament.sociability * 6;
    }

    // Avoid crowding
    if (dist < 3) {
      socialFx -= (dx / dist) * 8;
    }

    // Bond tracking
    const isBonded = m.bonds.includes(other);
    if (isBonded) {
      // Stay close to bonded motes
      if (dist > BOND_DIST * 0.5) {
        socialFx += (dx / dist) * 4;
      }
      // Share energy
      const transfer = (other.energy - m.energy) * 0.05 * dt;
      m.energy += transfer;
      other.energy -= transfer;
    } else if (
      dist < BOND_DIST &&
      m.bonds.length < MAX_BONDS &&
      other.bonds.length < MAX_BONDS
    ) {
      if (dist < closestDist) {
        closestUnbonded = other;
        closestDist = dist;
      }
    }
  }

  // Break bonds with distant motes
  for (let i = m.bonds.length - 1; i >= 0; i--) {
    const b = m.bonds[i];
    const bdx = b.x - m.x;
    const bdy = b.y - m.y;
    if (bdx * bdx + bdy * bdy > BOND_DIST * BOND_DIST * 6) {
      b.bonds = b.bonds.filter((o) => o !== m);
      m.bonds.splice(i, 1);
    }
  }

  // Bond formation
  if (closestUnbonded && closestDist < BOND_DIST) {
    m.bondTimer += dt;
    if (m.bondTimer > BOND_TIME / bondStrength) {
      m.bonds.push(closestUnbonded);
      closestUnbonded.bonds.push(m);
      m.bondTimer = 0;
      m.bondFlash = 1;
      closestUnbonded.bondFlash = 1;
      m.energy = Math.min(1, m.energy + 0.03);
      closestUnbonded.energy = Math.min(1, closestUnbonded.energy + 0.03);
    }
  } else {
    m.bondTimer = Math.max(0, m.bondTimer - dt * 0.3);
  }

  // Apply walking + social forces
  if (m.grounded) {
    m.vx = m.direction * walkSpeed + socialFx * 0.3;
    m.vy = 0;
  }

  // Apply external forces (cursor, events)
  m.vx += m.forceX * dt;
  m.vy += m.forceY * dt;
  m.forceX = 0;
  m.forceY = 0;

  // Water avoidance: check if heading toward water
  const aheadX = Math.round(m.x + m.direction * 3);
  if (aheadX >= 0 && aheadX < W) {
    const aheadSurface = getSurfaceY(terrain, aheadX);
    const aheadTile = getTile(terrain, aheadX, aheadSurface);
    if (aheadTile === Tile.ShallowWater || aheadTile === Tile.DeepWater) {
      m.direction *= -1;
      m.vx = m.direction * walkSpeed;
    }
  }

  // Move horizontally
  const newX = m.x + m.vx * dt;
  const clampedX = Math.max(1, Math.min(W - 2, newX));

  // Check if we can walk to new X (terrain collision)
  const currentSurface = getSurfaceY(terrain, m.x);
  const newSurface = getSurfaceY(terrain, clampedX);
  const heightDiff = currentSurface - newSurface; // positive = uphill

  if (heightDiff > JUMP_OVER) {
    // Too steep uphill — turn around
    m.direction *= -1;
    m.vx = 0;
  } else {
    m.x = clampedX;
  }

  // Move vertically (gravity + terrain snap)
  m.y += m.vy * dt;

  // Snap to terrain surface
  const surfY = getSurfaceY(terrain, m.x);
  if (m.y >= surfY - 1) {
    m.y = surfY - 1; // stand one pixel above surface
    m.vy = 0;
    m.grounded = true;
  } else {
    m.grounded = false;
  }

  // Edge boundaries
  if (m.x < 1) { m.x = 1; m.direction = 1; }
  if (m.x > W - 2) { m.x = W - 2; m.direction = -1; }
  if (m.y < 0) { m.y = 0; m.vy = 0; }
}

function cleanupBonds(m: Mote): void {
  for (const bonded of m.bonds) {
    bonded.bonds = bonded.bonds.filter((b) => b !== m);
  }
  m.bonds = [];
}

/** Check if a mote is near a cave tile */
export function isNearCave(m: Mote, terrain: Terrain): boolean {
  for (let dx = -2; dx <= 2; dx++) {
    for (let dy = -2; dy <= 2; dy++) {
      if (getTile(terrain, m.x + dx, m.y + dy) === Tile.Cave) {
        return true;
      }
    }
  }
  return false;
}

/** Mark a settlement at a mote's position */
export function placeSettlement(terrain: Terrain, x: number, y: number): void {
  const ix = Math.round(x);
  const iy = Math.round(y) + 1; // mark the ground they're standing on
  if (ix >= 0 && ix < W && iy >= 0 && iy < H) {
    const tile = terrain.tiles[iy * W + ix];
    if (isWalkable(tile as Tile)) {
      terrain.tiles[iy * W + ix] = Tile.Settlement;
    }
  }
}
