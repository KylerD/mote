// colony.ts — The gathering: site selection, belonging, arc milestones.
// Every cycle, the colony converges on one deterministically chosen place.
// (Spec 2.0 §6.2)

import { Tile } from "./types";
import type { Terrain, Mote, World } from "./types";
import { getSurfaceY, getTile } from "./terrain-query";
import { W, H } from "./config";
import {
  SITE_MARGIN, SITE_SCAN_STEP, SITE_FLAT_RADIUS, SITE_WATER_RANGE, JUMP_OVER,
  BELONGING_RAMP_START, BELONGING_RAMP_FULL, BELONGING_FADE_START,
  BELONGING_FADE_END, BELONGING_PEAK, SITE_ARRIVE_DIST,
} from "./constants";

export interface Milestone {
  name: string;
  time: number;      // world.time at the moment
  progress: number;  // cycleProgress at the moment
}

export interface ColonyState {
  siteX: number;
  siteY: number;
  basinLo: number;   // bounds of the walkable basin the site sits in —
  basinHi: number;   // motes stranded outside it are stragglers/texture
  milestones: Milestone[];
  arrived: boolean;
  peakPopulation: number;
  lastSurvivor: Mote | null;
}

/**
 * The single largest contiguous WALKABLE BASIN in the scannable range: the
 * longest run of columns that are dry (surface AND below-surface not water)
 * AND connected to their neighbour by a step motes can actually climb
 * (<= JUMP_OVER). A dry-but-too-steep column breaks the run and starts a
 * fresh one; a wet column kills the run. Reachability lives here — a site
 * nobody can walk to is no gathering place. Pure function of terrain.
 */
export function largestWalkableBasin(terrain: Terrain): { lo: number; hi: number } {
  const lo = SITE_MARGIN, hi = W - SITE_MARGIN;
  let bestStart = -1, bestLen = 0, runStart = -1, prevY = 0;
  for (let x = lo; x <= hi; x++) {
    const sy = getSurfaceY(terrain, x);
    const t0 = getTile(terrain, x, sy);
    const t1 = getTile(terrain, x, sy + 1);
    const wet = t0 === Tile.ShallowWater || t0 === Tile.DeepWater
             || t1 === Tile.ShallowWater || t1 === Tile.DeepWater;
    const stepOK = runStart >= 0 && Math.abs(sy - prevY) <= JUMP_OVER;
    if (!wet && (runStart < 0 || stepOK)) {
      if (runStart < 0) runStart = x;
    } else {
      runStart = wet ? -1 : x;   // dry-but-too-steep column starts a fresh run
    }
    if (runStart >= 0) {
      const len = x - runStart + 1;
      if (len > bestLen) { bestLen = len; bestStart = runStart; }
    }
    prevY = sy;
  }
  return {
    lo: bestStart >= 0 ? bestStart : lo,
    hi: bestStart >= 0 ? bestStart + bestLen - 1 : hi,
  };
}

/**
 * Deterministically pick the gathering site: the flattest, gently elevated
 * spot INSIDE the largest walkable basin, with a mild preference for being
 * near water. Pure function of terrain — this is what makes cross-cycle
 * memory derivable without simulation (spec §6.4).
 */
export function chooseSite(terrain: Terrain): { x: number; y: number } {
  const { lo: basinLo, hi: basinHi } = largestWalkableBasin(terrain);

  // Score columns within the basin. Elevation weight is reduced so the
  // site favours gentle high ground, not an unclimbable peak.
  let bestX = Math.floor((basinLo + basinHi) / 2);
  let bestScore = -Infinity;

  for (let x = basinLo; x <= basinHi; x += SITE_SCAN_STEP) {
    const surfY = getSurfaceY(terrain, x);
    const tile = getTile(terrain, x, surfY);
    if (tile === Tile.ShallowWater || tile === Tile.DeepWater) continue;
    // Reject thin sandbars/shelves that sit directly above open water —
    // a dry surface tile can still be carved from a "dry gap" feature one
    // row above submerged terrain (see terrain-gen.ts water feature pass).
    const belowTile = getTile(terrain, x, surfY + 1);
    if (belowTile === Tile.ShallowWater || belowTile === Tile.DeepWater) continue;

    // Flatness: inverse variance of surface height around x
    let sum = 0, sumSq = 0, n = 0;
    for (let dx = -SITE_FLAT_RADIUS; dx <= SITE_FLAT_RADIUS; dx += 2) {
      const sx = Math.max(0, Math.min(W - 1, x + dx));
      const sy = getSurfaceY(terrain, sx);
      sum += sy; sumSq += sy * sy; n++;
    }
    const mean = sum / n;
    const variance = sumSq / n - mean * mean;
    const flatScore = 1 / (1 + variance);

    // Elevation: higher ground reads better and stays clear of floods
    const elevScore = (H - surfY) / H;

    // Water proximity: near (but not in) water is attractive
    let waterScore = 0;
    for (let d = 4; d <= SITE_WATER_RANGE; d += 4) {
      for (const sx of [x - d, x + d]) {
        if (sx < 0 || sx >= W) continue;
        const t = getTile(terrain, sx, getSurfaceY(terrain, sx));
        if (t === Tile.ShallowWater || t === Tile.DeepWater) {
          waterScore = Math.max(waterScore, 0.3 * (1 - d / SITE_WATER_RANGE));
        }
      }
    }

    const score = flatScore * 2 + elevScore * 0.5 + waterScore;
    if (score > bestScore) {
      bestScore = score;
      bestX = x;
    }
  }

  return { x: bestX, y: getSurfaceY(terrain, bestX) };
}

/** Global belonging ramp: 0 while the world is young, dominant through the
 *  gathering, releasing its grip as dissolution begins. */
export function belongingBase(cycleProgress: number): number {
  if (cycleProgress <= BELONGING_RAMP_START) return 0;
  if (cycleProgress >= BELONGING_FADE_END) return 0;
  if (cycleProgress < BELONGING_RAMP_FULL) {
    const t = (cycleProgress - BELONGING_RAMP_START) / (BELONGING_RAMP_FULL - BELONGING_RAMP_START);
    return BELONGING_PEAK * t * t * (3 - 2 * t); // smoothstep
  }
  if (cycleProgress <= BELONGING_FADE_START) return BELONGING_PEAK;
  const t = (cycleProgress - BELONGING_FADE_START) / (BELONGING_FADE_END - BELONGING_FADE_START);
  return BELONGING_PEAK * (1 - t);
}

function record(world: World, name: string): void {
  if (world.colony.milestones.some(m => m.name === name)) return;
  world.colony.milestones.push({ name, time: world.time, progress: world.cycleProgress });
}

/**
 * Called once per simulation step, after motes/clusters update. Appends each
 * arc milestone at most once per cycle and shapes the last-survivor state.
 * Reads only world state — no Date.now/Math.random/performance.now — so the
 * arc is identical across sim speeds and cross-machine (spec §5). Arrival is
 * measured relative to the SITE'S BASIN: motes stranded across water are
 * stragglers/texture, not part of the gathering (spec 2.0 §6.2).
 */
export function updateColony(world: World): void {
  const c = world.colony;
  const population = world.motes.length;
  c.peakPopulation = Math.max(c.peakPopulation, population);

  if (population > 0 && world.motes.some(m => m.bonds.length > 0)) record(world, "first-bond");
  if (world.clusters.some(cl => cl.length >= 4)) record(world, "first-cluster");

  if (!c.arrived && belongingBase(world.cycleProgress) > 0 && population >= 8) {
    const basinPop = world.motes.filter(m => m.x >= c.basinLo && m.x <= c.basinHi).length;
    const near = world.motes.filter(m => Math.abs(m.x - c.siteX) < SITE_ARRIVE_DIST).length;
    if (basinPop > 0 && near / basinPop >= 0.5) {
      c.arrived = true;
      record(world, "arrival");
    }
  }

  // Dissolution & silence: crown the last survivor — the hardiest living mote
  // endures while the rest fade, so every cycle ends on a single figure. The
  // crowning begins in dissolution (phase 4) because the community would
  // otherwise fully fade before silence ever starts; protecting one mote
  // guarantees a final figure remains to the end. (Spec §5)
  if (world.phaseIndex >= 4) {
    if (c.lastSurvivor === null || c.lastSurvivor.energy <= 0) {
      let hardiest: Mote | null = null;
      for (const m of world.motes) {
        if (!hardiest || m.temperament.hardiness > hardiest.temperament.hardiness) hardiest = m;
      }
      c.lastSurvivor = hardiest;
    }
    if (population === 1) record(world, "last-survivor");
  }
}

export function createColony(terrain: Terrain): ColonyState {
  const basin = largestWalkableBasin(terrain);
  const site = chooseSite(terrain);
  return {
    siteX: site.x,
    siteY: site.y,
    basinLo: basin.lo,
    basinHi: basin.hi,
    milestones: [],
    arrived: false,
    peakPopulation: 0,
    lastSurvivor: null,
  };
}
