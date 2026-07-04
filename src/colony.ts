// colony.ts — The gathering: site selection, belonging, arc milestones.
// Every cycle, the colony converges on one deterministically chosen place.
// (Spec 2.0 §6.2)

import { Tile } from "./types";
import type { Terrain, Mote } from "./types";
import { getSurfaceY, getTile } from "./terrain-query";
import { W, H } from "./config";
import { SITE_MARGIN, SITE_SCAN_STEP, SITE_FLAT_RADIUS, SITE_WATER_RANGE } from "./constants";

export interface Milestone {
  name: string;
  time: number;      // world.time at the moment
  progress: number;  // cycleProgress at the moment
}

export interface ColonyState {
  siteX: number;
  siteY: number;
  milestones: Milestone[];
  arrived: boolean;
  peakPopulation: number;
  lastSurvivor: Mote | null;
}

/**
 * Deterministically pick the gathering site: the flattest, reasonably
 * elevated walkable spot, with a mild preference for being near water.
 * Pure function of terrain — this is what makes cross-cycle memory
 * derivable without simulation (spec §6.4).
 */
export function chooseSite(terrain: Terrain): { x: number; y: number } {
  let bestX = Math.floor(W / 2);
  let bestScore = -Infinity;

  for (let x = SITE_MARGIN; x <= W - SITE_MARGIN; x += SITE_SCAN_STEP) {
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

    const score = flatScore * 2 + elevScore + waterScore;
    if (score > bestScore) {
      bestScore = score;
      bestX = x;
    }
  }

  return { x: bestX, y: getSurfaceY(terrain, bestX) };
}

export function createColony(terrain: Terrain): ColonyState {
  const site = chooseSite(terrain);
  return {
    siteX: site.x,
    siteY: site.y,
    milestones: [],
    arrived: false,
    peakPopulation: 0,
    lastSurvivor: null,
  };
}
