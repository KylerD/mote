// events.ts — Rare events that break the pattern.
// ~1 in 12 cycles triggers an event (deterministic from seed).
// Events modify world state temporarily and show a text flash.

import { Tile } from "./types";
import type { World, Mote, Terrain, ActiveEvent, EventType } from "./types";
import { getSurfaceY, modifyTile } from "./terrain-query";
import { W, H } from "./config";
import {
  EVENT_FREQUENCY, EVENT_MESSAGE_DISPLAY, EVENT_MESSAGE_FADE,
  EVENT_DURATIONS, EVENT_TRIGGER_POINTS,
} from "./constants";

// Re-export for backward compatibility
export type { ActiveEvent, EventType };

/** Check if this cycle has a rare event, and what kind */
export function checkForEvent(cycleNumber: number): ActiveEvent | null {
  // Deterministic: hash the cycle number
  const h = Math.abs(cycleNumber * 2654435761 | 0);
  if (h % EVENT_FREQUENCY !== 0) return null;

  const eventIndex = (h >>> 8) % 9;
  const types: EventType[] = [
    "flood", "bloom", "meteor", "migration", "eclipse",
    "earthquake", "plague", "aurora", "drought",
  ];
  // Three variants per event — picked by a secondary hash for per-cycle diversity
  const messagePools: string[][] = [
    ["THE WATERS RISE",      "THE FLOOD COMES",         "RISING TIDE"],
    ["LIFE ERUPTS",          "THE BLOOM ARRIVES",       "ABUNDANCE"],
    ["FIRE FROM ABOVE",      "SOMETHING FALLS",         "THE SKY BREAKS"],
    ["THE GREAT MIGRATION",  "THEY MOVE AS ONE",        "MASS MOVEMENT"],
    ["DARKNESS DESCENDS",    "THE SUN IS SWALLOWED",    "TOTALITY"],
    ["THE EARTH SHAKES",     "THE GROUND BREAKS",       "UPHEAVAL"],
    ["A PLAGUE SPREADS",     "SICKNESS DESCENDS",       "THE WASTING"],
    ["THE SKY AWAKENS",      "LIGHTS IN THE DARK",      "THE AURORA RISES"],
    ["THE LONG THIRST",      "WATER RUNS DRY",          "THE DRYING"],
  ];
  const variant = (h >>> 16) % 3;

  return {
    type: types[eventIndex],
    message: messagePools[eventIndex][variant],
    startTime: -1, // set when triggered
    duration: EVENT_DURATIONS[types[eventIndex]],
    messageAlpha: 1,
    data: {},
  };
}

/**
 * When in the cycle should each event trigger? (as fraction 0-1)
 * Events are placed intentionally within the arc — not all at the same moment.
 */
export function getEventTriggerPoint(type: EventType): number {
  return EVENT_TRIGGER_POINTS[type] ?? 0.5;
}

/** Apply ongoing event effects each frame */
export function applyEvent(
  event: ActiveEvent,
  world: World,
  dt: number,
): void {
  if (event.startTime < 0) return; // not yet triggered

  const elapsed = world.time - event.startTime;
  if (elapsed > event.duration) return; // expired

  const progress = elapsed / event.duration;

  // Fade message
  if (elapsed < EVENT_MESSAGE_DISPLAY) {
    event.messageAlpha = 1;
  } else {
    event.messageAlpha = Math.max(0, 1 - (elapsed - EVENT_MESSAGE_DISPLAY) / EVENT_MESSAGE_FADE);
  }

  switch (event.type) {
    case "flood":
      applyFlood(world.terrain, progress);
      break;
    case "bloom":
      applyBloom(world, dt, event, progress);
      break;
    case "meteor":
      applyMeteor(world, progress);
      break;
    case "migration":
      applyMigration(world.motes, world.cycleNumber, progress);
      break;
    case "eclipse":
      // Eclipse effect is purely visual — handled in main.ts render
      break;
    case "earthquake":
      applyEarthquake(world, progress);
      break;
    case "plague":
      applyPlague(world.motes, dt);
      break;
    case "aurora":
      applyAurora(world.motes, dt);
      break;
    case "drought":
      applyDrought(world, dt, event, progress);
      break;
  }
}

/** Is the event currently active? */
export function isEventActive(event: ActiveEvent, worldTime: number): boolean {
  return event.startTime >= 0 && (worldTime - event.startTime) < event.duration;
}

/** Is this an eclipse currently active? (for render darkening) */
export function isEclipseActive(event: ActiveEvent | null, worldTime: number): boolean {
  return event !== null && event.type === "eclipse" && isEventActive(event, worldTime);
}

// --- Event implementations ---

function applyFlood(terrain: Terrain, _progress: number): void {
  // Water rises and STAYS. No sin-based receding.
  const originalWater = terrain.waterLevel;
  const maxRise = Math.floor(H * 0.15);
  // Linear rise that stays at peak
  const rise = Math.min(Math.floor(_progress * maxRise * 2), maxRise);
  const newLevel = originalWater + rise;

  // Convert newly-submerged ground tiles to shallow water
  for (let x = 0; x < W; x++) {
    const surfY = getSurfaceY(terrain, x);
    for (let y = surfY; y < H; y++) {
      const worldH = H - y;
      const idx = y * W + x;
      if (worldH <= newLevel && worldH > originalWater) {
        const tile = terrain.tiles[idx] as Tile;
        if (tile === Tile.Ground || tile === Tile.Sand || tile === Tile.Settlement) {
          terrain.tiles[idx] = Tile.ShallowWater;
        }
      }
    }
  }
}

function applyBloom(world: World, dt: number, event: ActiveEvent, progress: number): void {
  // Massively increased spawn rate
  const bloomSpawnRate = 30; // 30 motes/sec
  world.spawnAccum += bloomSpawnRate * dt;
  // Also energize existing motes
  for (const m of world.motes) {
    m.energy = Math.min(1, m.energy + 0.02 * dt);
  }

  // On first frame, place 5-8 TreeCanopy tiles at a random spot
  if (progress < 0.05 && event.data.bloomPlaced === undefined) {
    const bx = Math.abs((world.cycleNumber * 7919) % W);
    const by = getSurfaceY(world.terrain, bx);
    event.data.bloomX = bx;
    event.data.bloomY = by;
    event.data.bloomPlaced = 1;
    const count = 5 + Math.abs((world.cycleNumber * 3571) % 4);
    for (let i = 0; i < count; i++) {
      const ox = bx - 2 + Math.abs((world.cycleNumber * (131 + i * 37)) % 5);
      const oy = by - 1 - Math.abs((world.cycleNumber * (97 + i * 53)) % 3);
      modifyTile(world.terrain, ox, oy, Tile.TreeCanopy);
    }
  }
}

function applyMeteor(world: World, progress: number): void {
  if (progress > 0.3) return; // impact happens in first 30%

  const impactX = W * 0.3 + (world.cycleNumber % 100) / 100 * W * 0.4;
  const t = progress / 0.3; // 0-1 during fall phase

  if (t > 0.95 && !world.event?.data.impacted) {
    if (world.event) world.event.data.impacted = 1;

    const ix = Math.round(impactX);
    const surfY = getSurfaceY(world.terrain, ix);

    // Store crater location for visual effects
    if (world.event) {
      world.event.data.craterX = ix;
      world.event.data.craterY = surfY;
    }

    // Carve crater downward into the ground (do NOT touch heights array)
    for (let dx = -4; dx <= 4; dx++) {
      const cx = ix + dx;
      if (cx < 0 || cx >= W) continue;
      const depth = Math.max(0, 4 - Math.abs(dx));
      const colSurfY = getSurfaceY(world.terrain, cx);
      // Carve downward from surface
      for (let dy = 0; dy < depth; dy++) {
        const cy = colSurfY + dy;
        if (cy >= 0 && cy < H) {
          world.terrain.tiles[cy * W + cx] = Tile.Air;
        }
      }
      // Crater floor
      const floorY = colSurfY + depth;
      if (floorY >= 0 && floorY < H) {
        world.terrain.tiles[floorY * W + cx] = Tile.DarkGround;
      }
    }

    // Small puddle at crater center
    for (let dx = -2; dx <= 2; dx++) {
      const cx = ix + dx;
      if (cx < 0 || cx >= W) continue;
      const depth = Math.max(0, 4 - Math.abs(dx));
      const colSurfY = getSurfaceY(world.terrain, cx);
      const puddleY = colSurfY + depth - 1;
      if (puddleY >= 0 && puddleY < H) {
        modifyTile(world.terrain, cx, puddleY, Tile.ShallowWater);
      }
    }

    // Scorched earth around the rim
    for (let dx = -5; dx <= 5; dx++) {
      const cx = ix + dx;
      if (cx < 0 || cx >= W) continue;
      if (Math.abs(dx) >= 4) {
        const rimY = getSurfaceY(world.terrain, cx);
        if (rimY >= 0 && rimY < H) {
          modifyTile(world.terrain, cx, rimY, Tile.DarkGround);
        }
      }
    }

    // Scatter nearby motes
    for (const m of world.motes) {
      const dx = m.x - impactX;
      const dist = Math.abs(dx);
      if (dist < 40) {
        const force = (1 - dist / 40) * 50;
        m.forceX = (dx > 0 ? 1 : -1) * force;
        m.forceY = -force * 0.8;
        m.energy = Math.min(1, m.energy + 0.1);
      }
    }
  }
}

function applyMigration(motes: Mote[], cycleNumber: number, progress: number): void {
  // Sustained single-direction wave based on cycle seed — a true migration
  const direction = (cycleNumber * 6271) % 2 === 0 ? 1 : -1;
  // Build up quickly, sustain at peak, then taper to stillness
  const strength = Math.sin(progress * Math.PI) * 28;

  for (const m of motes) {
    m.forceX += direction * strength;
  }
}

function applyEarthquake(world: World, progress: number): void {
  // On first frame, create 2-3 cliff lines across random x positions
  if (progress < 0.05) {
    const lineCount = 2 + Math.abs((world.cycleNumber * 4391) % 2);
    for (let line = 0; line < lineCount; line++) {
      const lx = Math.abs((world.cycleNumber * (2017 + line * 1301)) % W);
      const tileCount = 4 + Math.abs((world.cycleNumber * (773 + line * 997)) % 3);
      for (let dy = 0; dy < tileCount; dy++) {
        const surfY = getSurfaceY(world.terrain, lx);
        modifyTile(world.terrain, lx, surfY + dy, Tile.Cliff);
      }
    }
  }

  // Apply jump force to all motes
  for (const m of world.motes) {
    m.forceY = -30;
  }
}

function applyPlague(motes: Mote[], dt: number): void {
  // Drain extra energy from all bonded motes
  for (const m of motes) {
    if (m.bonds.length > 0) {
      m.energy -= 0.025 * dt * (1 - m.temperament.hardiness * 0.4);
    }
  }
}

function applyAurora(motes: Mote[], dt: number): void {
  // Boost all mote energy
  for (const m of motes) {
    m.energy = Math.min(1, m.energy + 0.015 * dt);
  }
}

function applyDrought(world: World, dt: number, event: ActiveEvent, progress: number): void {
  // Drain all motes
  for (const m of world.motes) {
    m.energy -= 0.008 * dt;
  }

  // On first tick, dry up water edges — lakes visibly shrink
  if (progress < 0.05 && event.data.droughtApplied === undefined) {
    event.data.droughtApplied = 1;
    for (let x = 1; x < W - 1; x++) {
      for (let y = 1; y < H - 1; y++) {
        const idx = y * W + x;
        if (world.terrain.tiles[idx] === Tile.ShallowWater) {
          // Only convert tiles that border non-water (the exposed edges)
          const hasLandNeighbor =
            (world.terrain.tiles[idx - 1] !== Tile.ShallowWater &&
             world.terrain.tiles[idx - 1] !== Tile.DeepWater) ||
            (world.terrain.tiles[idx + 1] !== Tile.ShallowWater &&
             world.terrain.tiles[idx + 1] !== Tile.DeepWater) ||
            (world.terrain.tiles[(y - 1) * W + x] !== Tile.ShallowWater &&
             world.terrain.tiles[(y - 1) * W + x] !== Tile.DeepWater) ||
            (world.terrain.tiles[(y + 1) * W + x] !== Tile.ShallowWater &&
             world.terrain.tiles[(y + 1) * W + x] !== Tile.DeepWater);
          if (hasLandNeighbor) {
            world.terrain.tiles[idx] = Tile.Sand;
          }
        }
      }
    }
  }
}

/** Get meteor visual position for rendering (returns null if not in flight) */
export function getMeteorPosition(
  event: ActiveEvent | null,
  worldTime: number,
  cycleNumber: number,
): { x: number; y: number } | null {
  if (!event || event.type !== "meteor" || event.startTime < 0) return null;

  const elapsed = worldTime - event.startTime;
  const progress = elapsed / event.duration;
  if (progress > 0.3 || progress < 0) return null;

  const t = progress / 0.3;
  const impactX = W * 0.3 + (cycleNumber % 100) / 100 * W * 0.4;
  const impactY = H * 0.5; // roughly mid-terrain

  return {
    x: impactX + (1 - t) * 40,  // comes from upper right
    y: t * impactY,               // falls from top
  };
}
