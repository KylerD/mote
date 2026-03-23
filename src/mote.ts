// mote.ts — Terrain-aware creatures with temperaments.
// Motes walk on the landscape, form bonds, deplete resources, leave settlements.

import { Tile } from "./types";
import type { Terrain, Mote, SpatialGrid } from "./types";
import { getSurfaceY, getTile, getTileEnergy } from "./terrain-query";
import { W } from "./config";
import { getNeighbors } from "./physics";

// Re-export for backward compatibility
export type { Mote };
export { placeSettlement } from "./terrain-query";

const GRAVITY = 60;
const WALK_SPEED = 14;
const MAX_FALL = 60;
const JUMP_OVER = 4; // can step up 4px ledges at double res
const BOND_DIST = 20;
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
    bondAges: new Map(),
    bondTimer: 0,
    bondFlash: 0,
    bondBreakFlash: 0,
    hardinessFlash: 0,
    inheritFlash: 0,
    inheritR: 0,
    inheritG: 0,
    inheritB: 0,
    mourningFlash: 0,
    mourningR: 0,
    mourningG: 0,
    mourningB: 0,
    clusterMergeFlash: 0,
    ancientBondBreakFlash: 0,
    grounded: false,
    direction: rng() < 0.5 ? -1 : 1,
    spawnFlash: 1.0,
    trail: [],
    trailTimer: 0,
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
  m.spawnFlash = Math.max(0, m.spawnFlash - dt * 3);

  // Age lifecycle modifiers
  const ageMature = m.age > 8;   // ~8 seconds
  const ageElder = m.age > 20;   // ~20 seconds
  const ageMod = ageElder ? 0.82 : ageMature ? 0.92 : 1.0;

  m.bondFlash = Math.max(0, m.bondFlash - dt * 3);
  m.bondBreakFlash = Math.max(0, m.bondBreakFlash - dt * 2.5);
  m.inheritFlash = Math.max(0, m.inheritFlash - dt * 0.65); // ~1.5s grief window
  m.mourningFlash = Math.max(0, m.mourningFlash - dt * 0.5); // ~2s community mourning
  m.clusterMergeFlash = Math.max(0, m.clusterMergeFlash - dt * 1.8); // ~0.55s merge bloom
  m.ancientBondBreakFlash = Math.max(0, m.ancientBondBreakFlash - dt * 0.7); // ~1.4s mournful ring

  // Record trail breadcrumbs
  // Elder wanderers accumulate longer histories: age 0→30s scales buffer 10→45 pts.
  // A mote that's walked this world for 30 seconds leaves more of a mark than one at 5.
  const trailAgeFactor = Math.min(1, m.age / 30);
  m.trailTimer += dt;
  // High-wanderlust motes sample more frequently (0.08s) — their speed means wider gaps otherwise
  const trailInterval = 0.08 + (1 - m.temperament.wanderlust) * 0.07;
  if (m.trailTimer >= trailInterval) {
    m.trailTimer = 0;
    m.trail.push({ x: Math.round(m.x), y: Math.round(m.y), age: 0 });
    const maxTrail = Math.floor(12 + m.temperament.wanderlust * trailAgeFactor * 33);
    if (m.trail.length > maxTrail) m.trail.shift();
  }
  // Elder wanderers remember longer: young=1.5-3.0s, elder=1.5-6.0s
  const trailMaxAge = 1.5 + m.temperament.wanderlust * (1.5 + trailAgeFactor * 3.0);
  for (let i = m.trail.length - 1; i >= 0; i--) {
    m.trail[i].age += dt;
    if (m.trail[i].age > trailMaxAge) { m.trail.splice(i, 1); }
  }

  // Tile the mote is standing on (used for both energy and movement)
  const standingTile = getTile(terrain, m.x, m.y + 1);

  // Energy decay (modified by hardiness and wanderlust)
  const decayRate = energyDecay * (1.2 - m.temperament.hardiness * 0.4) * (1 + m.temperament.wanderlust * 0.3);
  m.energy -= decayRate * dt;

  // Terrain energy: gain from nutrient tiles, drain from hazards
  const tileEnergy = getTileEnergy(standingTile);
  if (tileEnergy > 0) {
    m.energy = Math.min(1, m.energy + tileEnergy * 0.02 * dt);
  } else if (tileEnergy < 0) {
    const hardResist = 1 - m.temperament.hardiness * 0.4;
    m.energy += tileEnergy * 0.03 * dt * hardResist;
  }

  // Hardy flash — lights up when a resistant mote weathers hostile terrain
  if (tileEnergy < -0.1 && m.temperament.hardiness > 0.45) {
    m.hardinessFlash = Math.min(1, m.hardinessFlash + dt * 6);
  } else {
    m.hardinessFlash = Math.max(0, m.hardinessFlash - dt * 4);
  }

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

  // Walking behavior (age slows movement)
  const walkSpeed = WALK_SPEED * (0.5 + m.temperament.wanderlust * 0.8) * ageMod;

  // Terrain-dependent movement speed
  let speedMod = 1.0;
  if (standingTile === Tile.Sand) speedMod = 0.7;
  else if (standingTile === Tile.TreeCanopy) speedMod = 0.85;
  else if (standingTile === Tile.Cave) speedMod = 0.6;
  else if (standingTile === Tile.ShallowWater) speedMod = 0.5;
  const finalSpeed = walkSpeed * speedMod;

  // Decision making: change direction occasionally
  // Wanderers at low energy: frantic direction reversals — can't settle, can't stop
  const wandererFrenzy = (
    m.temperament.wanderlust > m.temperament.sociability &&
    m.temperament.wanderlust > m.temperament.hardiness &&
    m.energy < 0.3
  ) ? 1 + (1 - m.energy / 0.3) * 3 : 1; // up to 4x more erratic
  if (rng() < 0.02 * dt * 60 * wandererFrenzy) {
    m.direction *= -1;
  }

  // Social force: move toward nearby motes if sociable
  let socialFx = 0;
  let socialAttract = 0;
  let closestUnbonded: Mote | null = null;
  let closestDist = Infinity;

  const neighbors = getNeighbors(grid, m.x, m.y, NEIGHBOR_RADIUS, m);
  for (const other of neighbors) {
    const dx = other.x - m.x;
    const dy = other.y - m.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 0.5) continue;

    // Social attraction — only beyond comfortable distance
    if (dist > 12) {
      socialAttract += (dx / dist) * m.temperament.sociability * 4;
    }

    // Strong inverse-square repulsion at close range — prevents clumping
    if (dist < 12) {
      const repelStrength = 30 * Math.pow(12 / Math.max(dist, 1), 2);
      socialFx -= (dx / dist) * repelStrength;
    }

    // Elder attraction: unbonded motes drift toward elders
    if (other.age > 20 && m.bonds.length === 0 && dist > 12) {
      socialAttract += (dx / dist) * 2;
    }

    // Bond tracking
    const isBonded = m.bonds.includes(other);
    if (isBonded) {
      // Stay close to bonded motes
      if (dist > BOND_DIST * 0.5) {
        socialFx += (dx / dist) * 4;
      }
      // Share energy (sociability boosts transfer)
      const transfer = (other.energy - m.energy) * (0.05 + m.temperament.sociability * 0.04) * dt;
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

  // Dying social motes: bonded → seek their specific partners; unbonded → boost general pull
  if (
    m.temperament.sociability > m.temperament.wanderlust &&
    m.temperament.sociability > m.temperament.hardiness &&
    m.energy < 0.3
  ) {
    const dp = 1 - m.energy / 0.3;
    if (m.bonds.length > 0) {
      // Find the nearest bonded partner and pull strongly toward them — a last walk
      let nearestBond: Mote | null = null;
      let nearestBondDist = Infinity;
      for (const b of m.bonds) {
        const bdx = b.x - m.x;
        const bdy = b.y - m.y;
        const d = Math.sqrt(bdx * bdx + bdy * bdy);
        if (d < nearestBondDist) { nearestBondDist = d; nearestBond = b; }
      }
      if (nearestBond && nearestBondDist > 5) {
        const bdx = nearestBond.x - m.x;
        // Directed force overrides random walking — the dying mote walks toward its partner
        socialFx += (bdx / nearestBondDist) * dp * m.temperament.sociability * 20;
      }
    } else {
      // No bonds — desperately boost general social attraction
      socialAttract *= 1 + dp * m.temperament.sociability * 2;
    }
  }

  // Clamp accumulated attraction so groups don't death-ball
  socialFx += Math.max(-10, Math.min(10, socialAttract));

  // Age all existing bonds
  for (const b of m.bonds) {
    m.bondAges.set(b, (m.bondAges.get(b) ?? 0) + dt);
  }

  // Break bonds with distant motes (elders hold bonds longer)
  const breakMult = ageElder ? 1.4 : 1.0;
  for (let i = m.bonds.length - 1; i >= 0; i--) {
    const b = m.bonds[i];
    const bdx = b.x - m.x;
    const bdy = b.y - m.y;
    if (bdx * bdx + bdy * bdy > BOND_DIST * BOND_DIST * 6 * breakMult) {
      const brokenAge = m.bondAges.get(b) ?? 0;
      b.bonds = b.bonds.filter((o) => o !== m);
      b.bondAges.delete(m);
      m.bondAges.delete(b);
      m.bonds.splice(i, 1);
      m.bondBreakFlash = 1;
      b.bondBreakFlash = 1;
      // Ancient bonds (70s+) earn a mournful farewell ring
      if (brokenAge >= 70) {
        m.ancientBondBreakFlash = 1.0;
        b.ancientBondBreakFlash = 1.0;
      }
    }
  }

  // Bond formation
  if (closestUnbonded && closestDist < BOND_DIST) {
    m.bondTimer += dt;
    if (m.bondTimer > BOND_TIME / bondStrength) {
      // Cluster merge: both motes already have bonds → two communities becoming one
      const isMerge = m.bonds.length > 0 && closestUnbonded.bonds.length > 0;
      m.bonds.push(closestUnbonded);
      closestUnbonded.bonds.push(m);
      m.bondAges.set(closestUnbonded, 0);
      closestUnbonded.bondAges.set(m, 0);
      m.bondTimer = 0;
      m.bondFlash = 1;
      closestUnbonded.bondFlash = 1;
      m.energy = Math.min(1, m.energy + 0.03);
      closestUnbonded.energy = Math.min(1, closestUnbonded.energy + 0.03);
      if (isMerge) {
        m.clusterMergeFlash = 1.0;
        closestUnbonded.clusterMergeFlash = 1.0;
      }
    }
  } else {
    m.bondTimer = Math.max(0, m.bondTimer - dt * 0.3);
  }

  // CURIOSITY FACING — when a mote is actively pursuing a bond, it turns to face its target.
  // Makes social intent legible at a glance: viewers can see who each mote is interested in.
  // Only kicks in while bondTimer is building (mote has noticed and is approaching).
  if (closestUnbonded && m.bondTimer > 0.1 && closestDist < BOND_DIST) {
    m.direction = closestUnbonded.x > m.x ? 1 : -1;
  }

  // Apply walking + social forces
  if (m.grounded) {
    m.vx = m.direction * finalSpeed + socialFx * 0.3;
    m.vy = 0;
  }

  // Apply external forces (cursor, events)
  m.vx += m.forceX * dt;
  m.vy += m.forceY * dt;
  m.forceX = 0;
  m.forceY = 0;

  // Unified movement check: test current direction for both water and cliff,
  // flip once if blocked, and stop if both directions are blocked (no oscillation)
  const currentSurface = getSurfaceY(terrain, m.x);
  let blocked = false;

  // Check ahead for water
  const aheadX = Math.round(m.x + m.direction * 3);
  if (aheadX >= 0 && aheadX < W) {
    const aheadSurface = getSurfaceY(terrain, aheadX);
    const aheadTile = getTile(terrain, aheadX, aheadSurface);
    if (aheadTile === Tile.ShallowWater || aheadTile === Tile.DeepWater) {
      blocked = true;
    }
  }

  // Check ahead for steep cliff
  if (!blocked) {
    const moveX = m.x + m.vx * dt;
    const clampedMoveX = Math.max(1, Math.min(W - 2, moveX));
    const moveSurface = getSurfaceY(terrain, clampedMoveX);
    if (currentSurface - moveSurface > JUMP_OVER) {
      blocked = true;
    }
  }

  if (blocked) {
    // Before flipping, check if the other direction is also blocked
    const otherDir = -m.direction;
    let otherBlocked = false;

    const behindX = Math.round(m.x + otherDir * 3);
    if (behindX >= 0 && behindX < W) {
      const behindSurface = getSurfaceY(terrain, behindX);
      const behindTile = getTile(terrain, behindX, behindSurface);
      if (behindTile === Tile.ShallowWater || behindTile === Tile.DeepWater) {
        otherBlocked = true;
      }
      // Also check cliff in the other direction
      if (!otherBlocked) {
        if (currentSurface - behindSurface > JUMP_OVER) {
          otherBlocked = true;
        }
      }
    }

    if (otherBlocked) {
      // Both directions blocked — just idle, don't oscillate
      m.vx = 0;
    } else {
      m.direction = otherDir;
      m.vx = m.direction * finalSpeed + socialFx * 0.3;
    }
  }

  // Move horizontally
  const newX = m.x + m.vx * dt;
  const clampedX = Math.max(1, Math.min(W - 2, newX));
  m.x = clampedX;

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
    const age = m.bondAges.get(bonded) ?? 0;
    bonded.bonds = bonded.bonds.filter((b) => b !== m);
    bonded.bondAges.delete(m);
    // Ancient bonds severed by death earn their own farewell ring on the survivor
    if (age >= 70) bonded.ancientBondBreakFlash = 1.0;
  }
  m.bonds = [];
  m.bondAges.clear();
}

