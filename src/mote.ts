// mote.ts — Terrain-aware creatures with temperaments.
// Motes walk on the landscape, form bonds, deplete resources, leave settlements.

import { Tile } from "./types";
import type { Terrain, Mote, SpatialGrid } from "./types";
import { getSurfaceY, getTile, getTileEnergy } from "./terrain-query";
import { W } from "./config";
import { getNeighbors } from "./physics";
import {
  GRAVITY, WALK_SPEED, MAX_FALL, JUMP_OVER,
  BOND_DIST, BOND_TIME, MAX_BONDS, NEIGHBOR_RADIUS,
  AGE_MATURE, AGE_ELDER, MATURE_SPEED_MOD, ELDER_SPEED_MOD,
  SPAWN_FLASH_DECAY, BOND_FLASH_DECAY, BOND_BREAK_FLASH_DECAY,
  INHERIT_FLASH_DECAY, MOURNING_FLASH_DECAY, CLUSTER_MERGE_FLASH_DECAY,
  ANCIENT_BOND_FLASH_DECAY, TRAIL_AGE_WINDOW, TRAIL_BASE_INTERVAL,
  TRAIL_INTERVAL_RANGE, TRAIL_MIN_LENGTH, TRAIL_LENGTH_FACTOR,
  TRAIL_MIN_LIFETIME, TRAIL_LIFETIME_BASE, TRAIL_LIFETIME_ELDER,
  ENERGY_DECAY_HARDINESS, ENERGY_DECAY_WANDERLUST,
  NUTRIENT_GAIN_RATE, HAZARD_DRAIN_RATE, HARDINESS_RESIST,
  HARDY_FLASH_TILE_THRESHOLD, HARDY_FLASH_MIN_HARDINESS,
  HARDINESS_FLASH_GAIN, HARDINESS_FLASH_DECAY,
  WALK_SPEED_BASE, WALK_SPEED_WANDERLUST,
  SAND_SPEED, CANOPY_SPEED, CAVE_SPEED, SHALLOW_WATER_SPEED,
  FRENZY_ENERGY_THRESHOLD, FRENZY_MAX_MULT, DIRECTION_CHANGE_RATE,
  SOCIAL_ATTRACT_DIST, SOCIAL_ATTRACT_STRENGTH,
  REPULSION_DIST, REPULSION_STRENGTH, SOCIAL_FORCE_CLAMP,
  ELDER_ATTRACT_STRENGTH, BONDED_ATTRACT_STRENGTH,
  BOND_COMFORTABLE_DISTANCE, ENERGY_TRANSFER_BASE, ENERGY_TRANSFER_SOCIAL,
  DYING_ENERGY_THRESHOLD, DYING_BOND_SEEK_DIST, DYING_BOND_SEEK_FORCE,
  DYING_SOCIAL_BOOST, ELDER_BOND_BREAK_MULT, BOND_BREAK_DISTANCE_MULT,
  ANCIENT_BOND_AGE, BOND_FORMATION_ENERGY_GAIN, BOND_TIMER_DECAY_RATE,
  CURIOSITY_FACING_MIN_TIMER, LOOKAHEAD_DISTANCE,
  COMFORT_BASELINE_BASE, COMFORT_BASELINE_SCALE,
  CURIOSITY_BASELINE_BASE, CURIOSITY_BASELINE_SCALE,
  TOGETHERNESS_BASELINE_BASE, TOGETHERNESS_BASELINE_SCALE,
  DRIVE_DECAY_RATE, COMFORT_LOW_ENERGY_RATE, COMFORT_LOW_ENERGY_THRESHOLD,
  TOGETHERNESS_LONELY_RATE, LONELY_THRESHOLD_TIME,
  CURIOSITY_RESTLESS_RATE, RESTLESS_THRESHOLD_TIME,
  GRIEF_COMFORT_OVERRIDE, GRIEF_TOGETHERNESS_FLOOR,
} from "./constants";

// Re-export for backward compatibility
export type { Mote };
export { placeSettlement } from "./terrain-query";

export function createMote(
  x: number,
  y: number,
  energy: number,
  rng: () => number,
): Mote {
  const wanderlust = rng();
  const sociability = rng();
  const hardiness = rng();
  return {
    x,
    y,
    vx: 0,
    vy: 0,
    energy,
    age: 0,
    temperament: {
      wanderlust,
      sociability,
      hardiness,
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
    // Drives (baseline from temperament)
    comfort: 0.3 + hardiness * 0.4,
    curiosity: 0.3 + wanderlust * 0.4,
    togetherness: 0.3 + sociability * 0.4,
    // Memory: favorite position (starts at spawn)
    favX: x, favY: y, favTimer: 0,
    // Memory: preferred companion
    preferredMote: null,
    // Memory: avoidance
    avoidX: 0, avoidY: 0, avoidTimer: 0,
    // State
    grieving: 0,
    lonelyTimer: 0,
    stableTimer: 0,
    lastEnergy: energy,
    lastEnergyTime: 0,
    grounded: false,
    direction: rng() < 0.5 ? -1 : 1,
    spawnFlash: 1.0,
    trail: [],
    trailTimer: 0,
    forceX: 0,
    forceY: 0,
  };
}

function updateDrives(m: Mote, dt: number, hasNeighbor: boolean): void {
  const { wanderlust, sociability, hardiness } = m.temperament;
  const comfortBase = COMFORT_BASELINE_BASE + hardiness * COMFORT_BASELINE_SCALE;
  const curiosityBase = CURIOSITY_BASELINE_BASE + wanderlust * CURIOSITY_BASELINE_SCALE;
  const togethernessBase = TOGETHERNESS_BASELINE_BASE + sociability * TOGETHERNESS_BASELINE_SCALE;

  // Decay toward baseline
  m.comfort += (comfortBase - m.comfort) * DRIVE_DECAY_RATE * dt * 60;
  m.curiosity += (curiosityBase - m.curiosity) * DRIVE_DECAY_RATE * dt * 60;
  m.togetherness += (togethernessBase - m.togetherness) * DRIVE_DECAY_RATE * dt * 60;

  // Low energy → comfort rises
  if (m.energy < COMFORT_LOW_ENERGY_THRESHOLD) {
    const deficit = 1 - m.energy / COMFORT_LOW_ENERGY_THRESHOLD;
    m.comfort += COMFORT_LOW_ENERGY_RATE * deficit * dt;
  }

  // Lonely → togetherness rises
  if (!hasNeighbor) {
    m.lonelyTimer += dt;
  } else {
    m.lonelyTimer = Math.max(0, m.lonelyTimer - dt * 2);
  }
  if (m.lonelyTimer > LONELY_THRESHOLD_TIME) {
    m.togetherness += TOGETHERNESS_LONELY_RATE * dt;
  }

  // Bonded and stable → curiosity rises (restlessness)
  if (m.bonds.length > 0) {
    m.stableTimer += dt;
  } else {
    m.stableTimer = 0;
  }
  if (m.stableTimer > RESTLESS_THRESHOLD_TIME) {
    m.curiosity += CURIOSITY_RESTLESS_RATE * dt;
  }

  // Grief overrides
  if (m.grieving > 0) {
    m.grieving -= dt;
    m.comfort = GRIEF_COMFORT_OVERRIDE;
    m.togetherness = Math.min(m.togetherness, GRIEF_TOGETHERNESS_FLOOR);
    if (m.grieving <= 0) {
      m.grieving = 0;
    }
  }

  // Clamp
  m.comfort = Math.max(0, Math.min(1, m.comfort));
  m.curiosity = Math.max(0, Math.min(1, m.curiosity));
  m.togetherness = Math.max(0, Math.min(1, m.togetherness));
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
  m.spawnFlash = Math.max(0, m.spawnFlash - dt * SPAWN_FLASH_DECAY);

  // Age lifecycle modifiers
  const ageMature = m.age > AGE_MATURE;   // ~8 seconds
  const ageElder = m.age > AGE_ELDER;     // ~20 seconds
  const ageMod = ageElder ? ELDER_SPEED_MOD : ageMature ? MATURE_SPEED_MOD : 1.0;

  m.bondFlash = Math.max(0, m.bondFlash - dt * BOND_FLASH_DECAY);
  m.bondBreakFlash = Math.max(0, m.bondBreakFlash - dt * BOND_BREAK_FLASH_DECAY);
  m.inheritFlash = Math.max(0, m.inheritFlash - dt * INHERIT_FLASH_DECAY); // ~1.5s grief window
  m.mourningFlash = Math.max(0, m.mourningFlash - dt * MOURNING_FLASH_DECAY); // ~2s community mourning
  m.clusterMergeFlash = Math.max(0, m.clusterMergeFlash - dt * CLUSTER_MERGE_FLASH_DECAY); // ~0.55s merge bloom
  m.ancientBondBreakFlash = Math.max(0, m.ancientBondBreakFlash - dt * ANCIENT_BOND_FLASH_DECAY); // ~1.4s mournful ring

  // Record trail breadcrumbs
  // Elder wanderers accumulate longer histories: age 0→30s scales buffer 10→45 pts.
  // A mote that's walked this world for 30 seconds leaves more of a mark than one at 5.
  const trailAgeFactor = Math.min(1, m.age / TRAIL_AGE_WINDOW);
  m.trailTimer += dt;
  // High-wanderlust motes sample more frequently (0.08s) — their speed means wider gaps otherwise
  const trailInterval = TRAIL_BASE_INTERVAL + (1 - m.temperament.wanderlust) * TRAIL_INTERVAL_RANGE;
  if (m.trailTimer >= trailInterval) {
    m.trailTimer = 0;
    m.trail.push({ x: Math.round(m.x), y: Math.round(m.y), age: 0 });
    const maxTrail = Math.floor(TRAIL_MIN_LENGTH + m.temperament.wanderlust * trailAgeFactor * TRAIL_LENGTH_FACTOR);
    if (m.trail.length > maxTrail) m.trail.shift();
  }
  // Elder wanderers remember longer: young=1.5-3.0s, elder=1.5-6.0s
  const trailMaxAge = TRAIL_MIN_LIFETIME + m.temperament.wanderlust * (TRAIL_LIFETIME_BASE + trailAgeFactor * TRAIL_LIFETIME_ELDER);
  for (let i = m.trail.length - 1; i >= 0; i--) {
    m.trail[i].age += dt;
    if (m.trail[i].age > trailMaxAge) { m.trail.splice(i, 1); }
  }

  // Tile the mote is standing on (used for both energy and movement)
  const standingTile = getTile(terrain, m.x, m.y + 1);

  // Energy decay (modified by hardiness and wanderlust)
  const decayRate = energyDecay * (1.2 - m.temperament.hardiness * ENERGY_DECAY_HARDINESS) * (1 + m.temperament.wanderlust * ENERGY_DECAY_WANDERLUST);
  m.energy -= decayRate * dt;

  // Terrain energy: gain from nutrient tiles, drain from hazards
  const tileEnergy = getTileEnergy(standingTile);
  if (tileEnergy > 0) {
    m.energy = Math.min(1, m.energy + tileEnergy * NUTRIENT_GAIN_RATE * dt);
  } else if (tileEnergy < 0) {
    const hardResist = 1 - m.temperament.hardiness * HARDINESS_RESIST;
    m.energy += tileEnergy * HAZARD_DRAIN_RATE * dt * hardResist;
  }

  // Hardy flash — lights up when a resistant mote weathers hostile terrain
  if (tileEnergy < HARDY_FLASH_TILE_THRESHOLD && m.temperament.hardiness > HARDY_FLASH_MIN_HARDINESS) {
    m.hardinessFlash = Math.min(1, m.hardinessFlash + dt * HARDINESS_FLASH_GAIN);
  } else {
    m.hardinessFlash = Math.max(0, m.hardinessFlash - dt * HARDINESS_FLASH_DECAY);
  }

  if (m.energy <= 0) {
    m.energy = 0;
    cleanupBonds(m);
    return;
  }

  // Drives
  const neighbors = getNeighbors(grid, m.x, m.y, NEIGHBOR_RADIUS, m);
  const hasNeighbor = neighbors.length > 0;
  updateDrives(m, dt, hasNeighbor);

  // Gravity
  if (!m.grounded) {
    m.vy += GRAVITY * dt;
    m.vy = Math.min(m.vy, MAX_FALL);
  }

  // Walking behavior (age slows movement)
  const walkSpeed = WALK_SPEED * (WALK_SPEED_BASE + m.temperament.wanderlust * WALK_SPEED_WANDERLUST) * ageMod;

  // Terrain-dependent movement speed
  let speedMod = 1.0;
  if (standingTile === Tile.Sand) speedMod = SAND_SPEED;
  else if (standingTile === Tile.TreeCanopy) speedMod = CANOPY_SPEED;
  else if (standingTile === Tile.Cave) speedMod = CAVE_SPEED;
  else if (standingTile === Tile.ShallowWater) speedMod = SHALLOW_WATER_SPEED;
  const finalSpeed = walkSpeed * speedMod;

  // Decision making: change direction occasionally
  // Wanderers at low energy: frantic direction reversals — can't settle, can't stop
  const wandererFrenzy = (
    m.temperament.wanderlust > m.temperament.sociability &&
    m.temperament.wanderlust > m.temperament.hardiness &&
    m.energy < FRENZY_ENERGY_THRESHOLD
  ) ? 1 + (1 - m.energy / FRENZY_ENERGY_THRESHOLD) * (FRENZY_MAX_MULT - 1) : 1; // up to 4x more erratic
  if (rng() < DIRECTION_CHANGE_RATE * dt * 60 * wandererFrenzy) {
    m.direction *= -1;
  }

  // Social force: move toward nearby motes if sociable
  let socialFx = 0;
  let socialAttract = 0;
  let closestUnbonded: Mote | null = null;
  let closestDist = Infinity;
  for (const other of neighbors) {
    const dx = other.x - m.x;
    const dy = other.y - m.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < BOND_COMFORTABLE_DISTANCE) continue;

    // Social attraction — only beyond comfortable distance
    if (dist > SOCIAL_ATTRACT_DIST) {
      socialAttract += (dx / dist) * m.temperament.sociability * SOCIAL_ATTRACT_STRENGTH;
    }

    // Strong inverse-square repulsion at close range — prevents clumping
    if (dist < REPULSION_DIST) {
      const repelStrength = REPULSION_STRENGTH * Math.pow(REPULSION_DIST / Math.max(dist, 1), 2);
      socialFx -= (dx / dist) * repelStrength;
    }

    // Elder attraction: unbonded motes drift toward elders
    if (other.age > AGE_ELDER && m.bonds.length === 0 && dist > SOCIAL_ATTRACT_DIST) {
      socialAttract += (dx / dist) * ELDER_ATTRACT_STRENGTH;
    }

    // Bond tracking
    const isBonded = m.bonds.includes(other);
    if (isBonded) {
      // Stay close to bonded motes
      if (dist > BOND_DIST * BOND_COMFORTABLE_DISTANCE) {
        socialFx += (dx / dist) * BONDED_ATTRACT_STRENGTH;
      }
      // Share energy (sociability boosts transfer)
      const transfer = (other.energy - m.energy) * (ENERGY_TRANSFER_BASE + m.temperament.sociability * ENERGY_TRANSFER_SOCIAL) * dt;
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
    m.energy < DYING_ENERGY_THRESHOLD
  ) {
    const dp = 1 - m.energy / DYING_ENERGY_THRESHOLD;
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
      if (nearestBond && nearestBondDist > DYING_BOND_SEEK_DIST) {
        const bdx = nearestBond.x - m.x;
        // Directed force overrides random walking — the dying mote walks toward its partner
        socialFx += (bdx / nearestBondDist) * dp * m.temperament.sociability * DYING_BOND_SEEK_FORCE;
      }
    } else {
      // No bonds — desperately boost general social attraction
      socialAttract *= 1 + dp * m.temperament.sociability * DYING_SOCIAL_BOOST;
    }
  }

  // Clamp accumulated attraction so groups don't death-ball
  socialFx += Math.max(-SOCIAL_FORCE_CLAMP, Math.min(SOCIAL_FORCE_CLAMP, socialAttract));

  // Age all existing bonds
  for (const b of m.bonds) {
    m.bondAges.set(b, (m.bondAges.get(b) ?? 0) + dt);
  }

  // Break bonds with distant motes (elders hold bonds longer)
  const breakMult = ageElder ? ELDER_BOND_BREAK_MULT : 1.0;
  for (let i = m.bonds.length - 1; i >= 0; i--) {
    const b = m.bonds[i];
    const bdx = b.x - m.x;
    const bdy = b.y - m.y;
    if (bdx * bdx + bdy * bdy > BOND_DIST * BOND_DIST * BOND_BREAK_DISTANCE_MULT * breakMult) {
      const brokenAge = m.bondAges.get(b) ?? 0;
      b.bonds = b.bonds.filter((o) => o !== m);
      b.bondAges.delete(m);
      m.bondAges.delete(b);
      m.bonds.splice(i, 1);
      m.bondBreakFlash = 1;
      b.bondBreakFlash = 1;
      // Ancient bonds (70s+) earn a mournful farewell ring
      if (brokenAge >= ANCIENT_BOND_AGE) {
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
      m.energy = Math.min(1, m.energy + BOND_FORMATION_ENERGY_GAIN);
      closestUnbonded.energy = Math.min(1, closestUnbonded.energy + BOND_FORMATION_ENERGY_GAIN);
      if (isMerge) {
        m.clusterMergeFlash = 1.0;
        closestUnbonded.clusterMergeFlash = 1.0;
      }
    }
  } else {
    m.bondTimer = Math.max(0, m.bondTimer - dt * BOND_TIMER_DECAY_RATE);
  }

  // CURIOSITY FACING — when a mote is actively pursuing a bond, it turns to face its target.
  // Makes social intent legible at a glance: viewers can see who each mote is interested in.
  // Only kicks in while bondTimer is building (mote has noticed and is approaching).
  if (closestUnbonded && m.bondTimer > CURIOSITY_FACING_MIN_TIMER && closestDist < BOND_DIST) {
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
  const aheadX = Math.round(m.x + m.direction * LOOKAHEAD_DISTANCE);
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

    const behindX = Math.round(m.x + otherDir * LOOKAHEAD_DISTANCE);
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
    if (age >= ANCIENT_BOND_AGE) bonded.ancientBondBreakFlash = 1.0;
  }
  m.bonds = [];
  m.bondAges.clear();
}
