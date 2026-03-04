// terrain.ts — Procedural landscape generation.
// Height map from noise, water, terrain layers, features (trees, rocks, caves, ruins).
// Everything is a tile map that motes can query for physics.

import { noise2, seedNoise } from "./noise";
import { W, H, setPixel } from "./render";
import { PAL, Biome, BiomePalette, getBiomePalette, pickBiome, lerpColor, RGB } from "./palette";

/** Tile types */
export const enum Tile {
  Air = 0,
  DeepWater,
  ShallowWater,
  Sand,
  Ground,
  DarkGround,
  Cliff,
  TreeTrunk,
  TreeCanopy,
  Cave,
  Ruin,
  Settlement, // placed by motes during gameplay
}

export interface Terrain {
  tiles: Uint8Array;   // W × H tile map
  heights: Float32Array; // height per column (0 = bottom, H = top). Index = x.
  waterLevel: number;  // y position of water surface (from bottom)
  biome: Biome;
  bp: BiomePalette;
  seed: number;
}

/** Generate a new terrain from a seed */
export function generateTerrain(seed: number): Terrain {
  seedNoise(seed);

  // Seeded RNG for placement decisions
  let s = seed | 0;
  function rng(): number {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  const biome = pickBiome(rng());
  const bp = getBiomePalette(biome);

  // Height map: 1D noise across width
  const heights = new Float32Array(W);
  const baseHeight = 0.35 + rng() * 0.15; // 35-50% of canvas height as base
  const roughness = 0.6 + rng() * 0.6;    // terrain bumpiness

  for (let x = 0; x < W; x++) {
    const n1 = noise2(x * 0.03, seed * 0.1) * roughness;
    const n2 = noise2(x * 0.08, seed * 0.1 + 50) * roughness * 0.3;
    const h = baseHeight + n1 * 0.25 + n2 * 0.1;
    heights[x] = Math.max(0.1, Math.min(0.85, h)) * H;
  }

  // Water level
  const waterLevel = Math.floor(H * (0.2 + rng() * 0.15));

  // Build tile map
  const tiles = new Uint8Array(W * H);

  for (let x = 0; x < W; x++) {
    const surfaceY = Math.floor(H - heights[x]); // screen Y (top = 0)

    for (let y = 0; y < H; y++) {
      const worldY = H - y; // world height (bottom = 0)
      const idx = y * W + x;

      if (y < surfaceY) {
        // Above terrain = air
        tiles[idx] = Tile.Air;
      } else if (y === surfaceY) {
        // Surface
        if (worldY <= waterLevel) {
          tiles[idx] = Tile.ShallowWater;
        } else if (worldY <= waterLevel + 2) {
          tiles[idx] = Tile.Sand;
        } else {
          tiles[idx] = Tile.Ground;
        }
      } else {
        // Below surface
        if (worldY <= waterLevel - 3) {
          tiles[idx] = Tile.DeepWater;
        } else if (worldY <= waterLevel) {
          tiles[idx] = Tile.ShallowWater;
        } else {
          // Underground — check for cliff (steep slope)
          const depth = y - surfaceY;
          if (depth <= 2) {
            tiles[idx] = Tile.DarkGround;
          } else {
            tiles[idx] = Tile.Cliff;
          }
        }
      }
    }
  }

  // Mark cliffs: where slope is steep
  for (let x = 1; x < W - 1; x++) {
    const slope = Math.abs(heights[x + 1] - heights[x - 1]);
    if (slope > 4) {
      const surfaceY = Math.floor(H - heights[x]);
      for (let dy = 0; dy < Math.min(6, H - surfaceY); dy++) {
        const idx = (surfaceY + dy) * W + x;
        if (tiles[idx] === Tile.Ground || tiles[idx] === Tile.DarkGround) {
          tiles[idx] = Tile.Cliff;
        }
      }
    }
  }

  const terrain: Terrain = { tiles, heights, waterLevel, biome, bp, seed };

  // Place features
  placeFeatures(terrain, rng);

  return terrain;
}

function placeFeatures(t: Terrain, rng: () => number): void {
  // Trees: on flat ground above water
  const treeCount = 20 + Math.floor(rng() * 30);
  for (let i = 0; i < treeCount; i++) {
    const x = 4 + Math.floor(rng() * (W - 8));
    const surfaceY = getSurfaceY(t, x);
    if (surfaceY < 2) continue;

    const worldH = H - surfaceY;
    if (worldH <= t.waterLevel + 2) continue; // too close to water

    // Check flat enough
    if (x > 0 && x < W - 1) {
      const slope = Math.abs(t.heights[x + 1] - t.heights[x - 1]);
      if (slope > 2) continue; // too steep
    }

    // Draw tree: trunk (1px wide, 2-3px tall) + canopy (3px wide, 2px tall)
    const trunkH = 2 + Math.floor(rng() * 2);
    const ty = surfaceY - 1; // one pixel above surface

    // Trunk
    for (let dy = 0; dy < trunkH; dy++) {
      const idx = (ty - dy) * W + x;
      if (ty - dy >= 0) t.tiles[idx] = Tile.TreeTrunk;
    }

    // Canopy
    const canopyY = ty - trunkH;
    for (let dy = 0; dy < 2; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const cx = x + dx;
        const cy = canopyY - dy;
        if (cx >= 0 && cx < W && cy >= 0) {
          // Skip corners on top row for rounder shape
          if (dy === 1 && Math.abs(dx) === 1 && rng() < 0.3) continue;
          t.tiles[cy * W + cx] = Tile.TreeCanopy;
        }
      }
    }
  }

  // Rocks: small clusters on ground
  const rockCount = 8 + Math.floor(rng() * 12);
  for (let i = 0; i < rockCount; i++) {
    const x = 2 + Math.floor(rng() * (W - 4));
    const surfaceY = getSurfaceY(t, x);
    if (surfaceY < 1) continue;

    const worldH = H - surfaceY;
    if (worldH <= t.waterLevel) continue;

    const ry = surfaceY - 1;
    if (ry >= 0) t.tiles[ry * W + x] = Tile.Cliff; // reuse cliff color for rocks
    if (rng() < 0.5 && x + 1 < W && ry >= 0) {
      t.tiles[ry * W + x + 1] = Tile.Cliff;
    }
  }

  // Caves: dark openings in steep cliffs (0-2 per map)
  const caveCount = Math.floor(rng() * 3);
  for (let i = 0; i < caveCount; i++) {
    // Find a steep spot
    for (let attempt = 0; attempt < 20; attempt++) {
      const x = 10 + Math.floor(rng() * (W - 20));
      if (x <= 0 || x >= W - 1) continue;
      const slope = Math.abs(t.heights[x + 1] - t.heights[x - 1]);
      if (slope < 3) continue;

      const surfaceY = getSurfaceY(t, x);
      const worldH = H - surfaceY;
      if (worldH <= t.waterLevel + 3) continue;

      // Carve 3×2 cave opening
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const cx = x + dx;
          const cy = surfaceY + dy;
          if (cx >= 0 && cx < W && cy >= 0 && cy < H) {
            t.tiles[cy * W + cx] = Tile.Cave;
          }
        }
      }
      break;
    }
  }

  // Ruins: tiny rectangular outlines on flat plateaus (rare)
  if (rng() < 0.25) {
    for (let attempt = 0; attempt < 30; attempt++) {
      const x = 10 + Math.floor(rng() * (W - 25));
      // Check 5px of flatness
      let flat = true;
      for (let dx = 0; dx < 5; dx++) {
        if (Math.abs(t.heights[x + dx] - t.heights[x]) > 1) {
          flat = false;
          break;
        }
      }
      if (!flat) continue;

      const surfaceY = getSurfaceY(t, x);
      const worldH = H - surfaceY;
      if (worldH <= t.waterLevel + 3) continue;

      // Draw 5×3 ruin outline
      const ry = surfaceY - 1;
      for (let dx = 0; dx < 5; dx++) {
        if (ry >= 0) t.tiles[ry * W + x + dx] = Tile.Ruin;
      }
      for (let dy = 1; dy < 3; dy++) {
        if (ry - dy >= 0) {
          t.tiles[(ry - dy) * W + x] = Tile.Ruin;
          t.tiles[(ry - dy) * W + x + 4] = Tile.Ruin;
        }
      }
      break;
    }
  }
}

/** Get the surface Y (screen coords, top=0) for a column */
export function getSurfaceY(t: Terrain, x: number): number {
  const cx = Math.max(0, Math.min(W - 1, Math.round(x)));
  return Math.floor(H - t.heights[cx]);
}

/** Get the tile at a screen position */
export function getTile(t: Terrain, x: number, y: number): Tile {
  const ix = Math.round(x);
  const iy = Math.round(y);
  if (ix < 0 || ix >= W || iy < 0 || iy >= H) return Tile.Air;
  return t.tiles[iy * W + ix] as Tile;
}

/** Is a tile solid (motes can't pass through)? */
export function isSolid(tile: Tile): boolean {
  return tile !== Tile.Air && tile !== Tile.Cave;
}

/** Is a tile walkable surface (motes can stand on it)? */
export function isWalkable(tile: Tile): boolean {
  return (
    tile === Tile.Ground ||
    tile === Tile.Sand ||
    tile === Tile.DarkGround ||
    tile === Tile.Ruin ||
    tile === Tile.Settlement
  );
}

// ---- Rendering ----

/** Tile-to-palette-index mapping (uses biome palette) */
function tileColor(tile: Tile, bp: BiomePalette): number {
  switch (tile) {
    case Tile.DeepWater: return bp.deepWater;
    case Tile.ShallowWater: return bp.shallowWater;
    case Tile.Sand: return bp.sand;
    case Tile.Ground: return bp.ground;
    case Tile.DarkGround: return bp.darkGround;
    case Tile.Cliff: return bp.cliff;
    case Tile.TreeTrunk: return bp.treeTrunk;
    case Tile.TreeCanopy: return bp.treeCanopy;
    case Tile.Cave: return 0;  // void black
    case Tile.Ruin: return 3;  // stone
    case Tile.Settlement: return 10; // sand/warm
    default: return -1; // air — don't draw
  }
}

/**
 * Sky tints per phase — RGB deltas applied on top of biome sky.
 * These shift the sky's mood across the cycle arc without overriding biome identity.
 * Top of sky gets full tint; horizon fades to 30% tint for a natural gradient blend.
 */
const SKY_TINTS: RGB[] = [
  [-8,  -8,  15],  // genesis:      cool violet — pre-dawn, a world not yet awake
  [ 0,   0,   0],  // exploration:  neutral — clear day, open sky
  [ 5,   3,  -3],  // organization: slight warmth — mid-day building
  [ 8,   4,  -5],  // complexity:   warm afternoon — peak light
  [20,   8, -15],  // dissolution:  golden hour — amber light, things fading
  [-5, -10,  12],  // silence:      indigo dusk — the world going to sleep
];

// Cumulative phase boundaries (fractions of cycle) — mirrors world.ts PHASE_DURATIONS
const TINT_BOUNDARIES = [0.10, 0.30, 0.55, 0.80, 0.92, 1.0];

/** Smooth interpolated sky tint for a given cycle position (0–1) */
function skyTintAt(cycleProgress: number): RGB {
  let prev = 0;
  for (let i = 0; i < TINT_BOUNDARIES.length; i++) {
    if (cycleProgress <= TINT_BOUNDARIES[i]) {
      const t = (cycleProgress - prev) / (TINT_BOUNDARIES[i] - prev);
      const a = SKY_TINTS[i];
      const b = SKY_TINTS[(i + 1) % SKY_TINTS.length];
      return [
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t,
      ];
    }
    prev = TINT_BOUNDARIES[i];
  }
  return SKY_TINTS[5];
}

/** Render terrain + sky into the buffer */
export function renderTerrain(
  buf: ImageData,
  terrain: Terrain,
  time: number,
  cycleProgress: number,
): void {
  const { tiles, bp } = terrain;
  const skyTop = PAL[bp.sky];
  const skyBot = PAL[bp.skyHorizon];
  const tint = skyTintAt(cycleProgress);

  const d = buf.data;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = y * W + x;
      const tile = tiles[idx] as Tile;
      const pi = idx * 4;

      if (tile === Tile.Air) {
        // Sky gradient
        const t = y / (H * 0.6); // gradient occupies top 60%
        const st = Math.min(1, Math.max(0, t));
        const c: RGB = lerpColor(skyTop, skyBot, st);
        // Tint is strongest at zenith, fades toward horizon — top sky sets the mood
        const tintStr = 1 - st * 0.7;
        d[pi]     = Math.max(0, Math.min(255, c[0] + tint[0] * tintStr));
        d[pi + 1] = Math.max(0, Math.min(255, c[1] + tint[1] * tintStr));
        d[pi + 2] = Math.max(0, Math.min(255, c[2] + tint[2] * tintStr));
        d[pi + 3] = 255;
      } else {
        const ci = tileColor(tile, bp);
        if (ci >= 0) {
          d[pi] = PAL[ci][0];
          d[pi + 1] = PAL[ci][1];
          d[pi + 2] = PAL[ci][2];
          d[pi + 3] = 255;
        }
      }
    }
  }

  // Water surface shimmer: occasional lighter pixels on water surface
  for (let x = 0; x < W; x++) {
    const surfaceY = getSurfaceY(terrain, x);
    const worldH = H - surfaceY;
    if (worldH <= terrain.waterLevel && worldH >= terrain.waterLevel - 1) {
      // This is a water surface pixel — add shimmer
      if ((x + Math.floor(time * 2)) % 5 === 0) {
        setPixel(buf, x, surfaceY, PAL[8][0], PAL[8][1], PAL[8][2], 120);
      }
    }
  }
}
