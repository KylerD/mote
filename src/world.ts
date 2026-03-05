// world.ts — World state, cycle clock, mote lifecycle, terrain integration.

import { Mote, createMote, updateMote, placeSettlement } from "./mote";
import { Terrain, generateTerrain, getSurfaceY, getTile, Tile } from "./terrain";
import { W } from "./render";
import { findClusters, createGrid, buildGrid, SpatialGrid } from "./physics";
import {
  ActiveEvent, checkForEvent, getEventTriggerPoint,
  applyEvent, isEventActive,
} from "./events";
import { mulberry32 } from "./rng";
import { PAL } from "./palette";

/** Cycle duration in seconds */
export const CYCLE_DURATION = 300;

export const PHASE_NAMES = [
  "genesis",
  "exploration",
  "organization",
  "complexity",
  "dissolution",
  "silence",
] as const;

export type PhaseName = (typeof PHASE_NAMES)[number];

/** Unequal phase durations (fractions of cycle) */
const PHASE_DURATIONS = [
  0.10, // genesis     — 30s
  0.20, // exploration — 60s
  0.25, // organization — 75s
  0.25, // complexity  — 75s
  0.12, // dissolution — 36s
  0.08, // silence     — 24s
];

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

interface PhaseParams {
  spawnRate: number;
  maxMotes: number;
  energyDecay: number;
  bondStrength: number;
}

const PHASE_PARAMS: PhaseParams[] = [
  { spawnRate: 8, maxMotes: 50, energyDecay: 0.008, bondStrength: 0.3 },
  { spawnRate: 6, maxMotes: 120, energyDecay: 0.012, bondStrength: 0.5 },
  { spawnRate: 4, maxMotes: 160, energyDecay: 0.015, bondStrength: 0.8 },
  { spawnRate: 5, maxMotes: 200, energyDecay: 0.018, bondStrength: 0.9 },
  { spawnRate: 0, maxMotes: 200, energyDecay: 0.04, bondStrength: 0.3 },
  { spawnRate: 0, maxMotes: 200, energyDecay: 0.07, bondStrength: 0.1 },
];

export interface DeathRecord {
  x: number;
  y: number;
  r: number; g: number; b: number;
  time: number;
}

export interface World {
  terrain: Terrain;
  motes: Mote[];
  grid: SpatialGrid;
  cycleProgress: number;
  cycleNumber: number;
  phaseIndex: number;
  phaseProgress: number;
  phaseName: PhaseName;
  params: PhaseParams;
  time: number;
  rng: () => number;
  spawnAccum: number;
  settlementTimer: number;
  event: ActiveEvent | null;
  eventTriggered: boolean;
  deaths: DeathRecord[];
  pendingEventSound: string | null;
}

export function createWorld(): World {
  const cycleNumber = Math.floor(Date.now() / (CYCLE_DURATION * 1000));
  const terrain = generateTerrain(cycleNumber);
  return {
    terrain,
    motes: [],
    grid: createGrid(W),
    cycleProgress: 0,
    cycleNumber,
    phaseIndex: 0,
    phaseProgress: 0,
    phaseName: "genesis",
    params: PHASE_PARAMS[0],
    time: 0,
    rng: mulberry32(cycleNumber + 7777), // offset so motes differ from terrain
    spawnAccum: 0,
    settlementTimer: 0,
    event: checkForEvent(cycleNumber),
    eventTriggered: false,
    deaths: [],
    pendingEventSound: null,
  };
}

/** Get time multiplier from URL param (?speed=N) */
function getSpeedMultiplier(): number {
  const params = new URLSearchParams(window.location.search);
  const speed = params.get("speed");
  return speed ? Math.max(1, Math.min(120, Number(speed))) : 1;
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
    world.rng = mulberry32(currentCycle + 7777);
    world.spawnAccum = 0;
    world.settlementTimer = 0;
    world.event = checkForEvent(currentCycle);
    world.eventTriggered = false;
    world.deaths = [];
    world.pendingEventSound = null;
  }

  if (newPhase !== world.phaseIndex) {
    world.phaseIndex = newPhase;
    world.phaseName = PHASE_NAMES[newPhase];
  }

  world.params = PHASE_PARAMS[world.phaseIndex];

  // Rare event triggering
  if (world.event && !world.eventTriggered) {
    if (world.cycleProgress >= getEventTriggerPoint()) {
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
      for (let attempt = 0; attempt < 10; attempt++) {
        const x = 4 + world.rng() * (W - 8);
        const surfY = getSurfaceY(world.terrain, x);
        const tile = getTile(world.terrain, x, surfY);
        // Don't spawn on water
        if (tile === Tile.ShallowWater || tile === Tile.DeepWater) continue;
        const energy = 0.4 + world.rng() * 0.4;
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
  if (world.settlementTimer > 3) {
    world.settlementTimer = 0;
    const clusters = findClusters(world.motes);
    for (const cluster of clusters) {
      if (cluster.length >= 3) {
        // Find centroid
        let cx = 0;
        for (const m of cluster) cx += m.x;
        cx /= cluster.length;
        const surfY = getSurfaceY(world.terrain, cx);
        placeSettlement(world.terrain, cx, surfY - 1);
      }
    }
  }

  // Capture deaths with color before filtering
  const bp = world.terrain.bp;
  const bright = PAL[bp.moteGlow];
  const dark = PAL[bp.moteDim];
  for (const m of world.motes) {
    if (m.energy <= 0) {
      const t = 0.3; // dying motes are dim
      world.deaths.push({
        x: m.x, y: m.y,
        r: dark[0] + (bright[0] - dark[0]) * t,
        g: dark[1] + (bright[1] - dark[1]) * t,
        b: dark[2] + (bright[2] - dark[2]) * t,
        time: world.time,
      });
    }
  }

  // Remove dead motes
  world.motes = world.motes.filter((m) => m.energy > 0);

  // Clean old death records (1.2s for soul-rise effect)
  world.deaths = world.deaths.filter(d => world.time - d.time < 1.2);
}
