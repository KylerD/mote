// world.ts — World state, cycle clock, mote lifecycle, terrain integration.

import { Tile } from "./types";
import type { World, PhaseName, DeathRecord } from "./types";
import { createMote, updateMote, placeSettlement } from "./mote";
import { generateTerrain, getSurfaceY, getTile } from "./terrain";
import { W, CYCLE_DURATION } from "./config";
import { findClusters, createGrid, buildGrid } from "./physics";
import {
  checkForEvent, getEventTriggerPoint,
  applyEvent, isEventActive,
} from "./events";
import { mulberry32 } from "./rng";
import { hsl2rgb } from "./palette";
import { createWeather, updateWeather } from "./weather";
import {
  PHASE_DURATIONS, PHASE_PARAMS,
  RNG_SEED_OFFSET, MAX_SPEED_MULTIPLIER,
  SPAWN_ATTEMPTS, SPAWN_ENERGY_MIN, SPAWN_ENERGY_RANGE,
  SETTLEMENT_INTERVAL, SETTLEMENT_MIN_CLUSTER,
  DEATH_RECORD_LIFETIME,
  INHERIT_RADIUS_BASE, INHERIT_RADIUS_AGE_MAX, INHERIT_RADIUS_AGE_MULT,
  CLUSTER_MOURNING_PERIPHERAL,
  WANDERER_TRAIL_THRESHOLD, DEATH_COLOR_ENERGY,
  AGE_GOLD_START, AGE_GOLD_WINDOW, AGE_GOLD_STRENGTH,
} from "./constants";

// Re-export for backward compatibility
export { CYCLE_DURATION };
export type { World, PhaseName, DeathRecord };

export const PHASE_NAMES = [
  "genesis",
  "exploration",
  "organization",
  "complexity",
  "dissolution",
  "silence",
] as const;

/** Unequal phase durations (fractions of cycle) — imported from constants */

const PHASE_BOUNDARIES: number[] = [];
{
  let sum = 0;
  for (const d of PHASE_DURATIONS) {
    sum += d;
    PHASE_BOUNDARIES.push(sum);
  }
}

export function getPhaseFromCycle(cycleProgress: number): {
  index: number;
  progress: number;
} {
  const t = cycleProgress % 1;
  let prev = 0;
  for (let i = 0; i < PHASE_BOUNDARIES.length; i++) {
    if (t < PHASE_BOUNDARIES[i]) {
      return { index: i, progress: (t - prev) / (PHASE_BOUNDARIES[i] - prev) };
    }
    prev = PHASE_BOUNDARIES[i];
  }
  return { index: 5, progress: 1 };
}

// World, DeathRecord are defined in types.ts and re-exported above

export function createWorld(): World {
  const cycleOverride = new URLSearchParams(window.location.search).get("cycle");
  const cycleNumber = cycleOverride ? parseInt(cycleOverride, 10) : Math.floor(Date.now() / (CYCLE_DURATION * 1000));
  const terrain = generateTerrain(cycleNumber);
  return {
    terrain,
    motes: [],
    grid: createGrid(W),
    clusters: [],
    cycleProgress: 0,
    cycleNumber,
    phaseIndex: 0,
    phaseProgress: 0,
    phaseName: "genesis",
    params: PHASE_PARAMS[0],
    time: 0,
    rng: mulberry32(cycleNumber + RNG_SEED_OFFSET), // offset so motes differ from terrain
    spawnAccum: 0,
    settlementTimer: 0,
    event: checkForEvent(cycleNumber),
    eventTriggered: false,
    deaths: [],
    allDeaths: [],
    pendingEventSound: null,
    phaseFlash: 0,
    weather: createWeather(cycleNumber, terrain.biome),
  };
}

/** Get time multiplier from URL param (?speed=N) */
function getSpeedMultiplier(): number {
  const params = new URLSearchParams(window.location.search);
  const speed = params.get("speed");
  return speed ? Math.max(1, Math.min(MAX_SPEED_MULTIPLIER, Number(speed))) : 1;
}

const speedMultiplier = getSpeedMultiplier();

export function updateWorld(world: World, dt: number): void {
  // Cycle clock (with speed multiplier for debug)
  const utcSeconds = Date.now() / 1000;
  const effectiveTime = utcSeconds * speedMultiplier;
  world.cycleProgress = (effectiveTime % CYCLE_DURATION) / CYCLE_DURATION;
  world.time += dt;

  // Phase detection
  const { index: newPhase, progress } = getPhaseFromCycle(world.cycleProgress);
  world.phaseProgress = progress;

  // Cycle change detection
  const currentCycle = Math.floor(effectiveTime / CYCLE_DURATION);
  if (currentCycle !== world.cycleNumber) {
    world.cycleNumber = currentCycle;
    world.terrain = generateTerrain(currentCycle);
    world.motes = [];
    world.rng = mulberry32(currentCycle + RNG_SEED_OFFSET);
    world.spawnAccum = 0;
    world.settlementTimer = 0;
    world.event = checkForEvent(currentCycle);
    world.eventTriggered = false;
    world.deaths = [];
    world.allDeaths = [];
    world.pendingEventSound = null;
    world.weather = createWeather(currentCycle, world.terrain.biome);
  }

  if (newPhase !== world.phaseIndex) {
    world.phaseIndex = newPhase;
    world.phaseName = PHASE_NAMES[newPhase];
    world.phaseFlash = 1.0;
  }
  world.phaseFlash = Math.max(0, world.phaseFlash - dt);

  world.params = PHASE_PARAMS[world.phaseIndex];

  // Rare event triggering
  if (world.event && !world.eventTriggered) {
    if (world.cycleProgress >= getEventTriggerPoint(world.event.type)) {
      world.event.startTime = world.time;
      world.eventTriggered = true;
      world.pendingEventSound = world.event.type;
    }
  }

  // Apply active event
  if (world.event && isEventActive(world.event, world.time)) {
    applyEvent(world.event, world, dt);
  }

  // Spawn motes on walkable terrain
  if (world.motes.length < world.params.maxMotes) {
    world.spawnAccum += world.params.spawnRate * dt;
    while (world.spawnAccum >= 1) {
      world.spawnAccum -= 1;
      // Find a valid spawn position
      for (let attempt = 0; attempt < SPAWN_ATTEMPTS; attempt++) {
        const x = 4 + world.rng() * (W - 8);
        const surfY = getSurfaceY(world.terrain, x);
        const tile = getTile(world.terrain, x, surfY);
        // Don't spawn on water
        if (tile === Tile.ShallowWater || tile === Tile.DeepWater) continue;
        const energy = SPAWN_ENERGY_MIN + world.rng() * SPAWN_ENERGY_RANGE;
        world.motes.push(createMote(x, surfY - 1, energy, world.rng));
        break;
      }
    }
  }

  // Update motes (spatial grid for efficient neighbor queries)
  buildGrid(world.grid, world.motes);
  for (const mote of world.motes) {
    updateMote(
      mote, dt, world.terrain, world.grid,
      world.params.energyDecay, world.params.bondStrength, world.rng,
    );
  }

  // Settlement placement: stable clusters mark the ground
  world.settlementTimer += dt;
  if (world.settlementTimer > SETTLEMENT_INTERVAL) {
    world.settlementTimer = 0;
    const clusters = findClusters(world.motes);
    for (const cluster of clusters) {
      if (cluster.length >= SETTLEMENT_MIN_CLUSTER) {
        // Find centroid
        let cx = 0;
        for (const m of cluster) cx += m.x;
        cx /= cluster.length;
        const surfY = getSurfaceY(world.terrain, cx);
        placeSettlement(world.terrain, cx, surfY - 1);
      }
    }
  }

  // Capture deaths with actual temperament color before filtering
  for (const m of world.motes) {
    if (m.energy <= 0) {
      // Use mid energy so identity color is recognizable (mote was alive moments ago)
      const dE = DEATH_COLOR_ENERGY;
      const hue = (m.temperament.wanderlust * 50 + m.temperament.sociability * 160 + 40 + m.temperament.hardiness * 60) % 360;
      const sat = Math.min(1, 0.45 + m.temperament.sociability * 0.35 + dE * 0.15);
      const hardyBoost = m.temperament.hardiness * 0.08 * (1 - dE);
      const light = Math.min(0.72, 0.30 + (dE + hardyBoost) * 0.38);
      let [dr, dg, db] = hsl2rgb(hue, sat, light);
      const ageGold = Math.min(1, Math.max(0, (m.age - AGE_GOLD_START) / AGE_GOLD_WINDOW)) * AGE_GOLD_STRENGTH;
      dr = Math.round(dr + (220 - dr) * ageGold);
      dg = Math.round(dg + (165 - dg) * ageGold);
      db = Math.round(db + (40 - db) * ageGold);
      // Wanderers: copy their trail so the ghost-path outlives the walker
      const isWanderer = m.temperament.wanderlust > WANDERER_TRAIL_THRESHOLD;
      const trailCopy = isWanderer ? m.trail.map(pt => ({ ...pt })) : undefined;

      world.deaths.push({
        x: m.x, y: m.y,
        r: dr, g: dg, b: db,
        time: world.time,
        age: m.age,
        trail: trailCopy,
      });

      // Persist all death positions for the silence constellation
      world.allDeaths.push({ x: m.x, y: m.y, r: dr, g: dg, b: db, time: world.time });

      // Death inheritance: age-scaled radius — elders are missed from further away
      const inheritRadius = INHERIT_RADIUS_BASE + Math.min(INHERIT_RADIUS_AGE_MAX, m.age * INHERIT_RADIUS_AGE_MULT);
      let nearest: typeof world.motes[0] | null = null;
      let nearestD2 = inheritRadius * inheritRadius;
      for (const other of world.motes) {
        if (other === m || other.energy <= 0) continue;
        const dx = other.x - m.x;
        const dy = other.y - m.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < nearestD2) { nearestD2 = d2; nearest = other; }
      }
      if (nearest) {
        nearest.inheritFlash = 1.0;
        nearest.inheritR = dr;
        nearest.inheritG = dg;
        nearest.inheritB = db;
      }

      // Cluster mourning: when a cluster loses a member, survivors carry the dead mote's color.
      // Bonded survivors grieve more intensely than peripheral cluster members.
      for (const cluster of world.clusters) {
        if (cluster.includes(m)) {
          for (const other of cluster) {
            if (other !== m && other.energy > 0) {
              // Direct bond partners grieve at full intensity; others at peripheral intensity
              const wasBonded = other.bonds.includes(m);
              other.mourningFlash = wasBonded ? 1.0 : CLUSTER_MOURNING_PERIPHERAL;
              other.mourningR = dr;
              other.mourningG = dg;
              other.mourningB = db;
            }
          }
          break;
        }
      }

      // Elder grief ripple: when an elder dies, ALL nearby motes feel the loss —
      // not just cluster members but any creature within 30px. Elders are community
      // anchors; their death should ripple outward as a visible wave of mourning.
      if (m.age > 20) {
        const griefR2 = 30 * 30;
        for (const other of world.motes) {
          if (other === m || other.energy <= 0) continue;
          const gdx = other.x - m.x;
          const gdy = other.y - m.y;
          if (gdx * gdx + gdy * gdy < griefR2 && other.mourningFlash < 0.5) {
            other.mourningFlash = Math.max(other.mourningFlash, 0.48);
            other.mourningR = dr;
            other.mourningG = dg;
            other.mourningB = db;
          }
        }
      }
    }
  }

  // Remove dead motes
  world.motes = world.motes.filter((m) => m.energy > 0);

  // Clean old death records (DEATH_RECORD_LIFETIME for full soul-rise + ground echo)
  world.deaths = world.deaths.filter(d => world.time - d.time < DEATH_RECORD_LIFETIME);

  // Weather particle/cloud/lightning updates
  updateWeather(world.weather, dt, world.time, world.rng);

  // Cache clusters for rendering and sound
  world.clusters = findClusters(world.motes);
}
