// terrain-gen.ts — Procedural landscape generation.
// Height map from noise, water, terrain layers, features (trees, rocks, caves, ruins).

import { noise2, seedNoise } from "./noise";
import { W, H } from "./config";
import { Tile } from "./types";
import type { Terrain, Biome } from "./types";
import { getBiomePalette, pickBiome } from "./palette";
import { mulberry32 } from "./rng";
import { getSurfaceY } from "./terrain-query";

/** Terrain archetype — controls the structural shape of the landscape */
interface TerrainArchetype {
  name: string;
  freq1: number;
  freq2: number;
  amp1: number;
  amp2: number;
  baseHeight: [number, number];
  roughness: [number, number];
  waterLevel: [number, number];
  postProcess?: (heights: Float32Array, rng: () => number) => void;
  /** Water feature noise parameters — controls pools/gaps beyond the base waterLevel */
  waterFeatures?: {
    freq: number;         // noise frequency for water carving
    poolThreshold: number; // noise > this creates elevated pools
    dryThreshold: number;  // noise < this removes water (creates islands)
    poolRange: number;     // how far above waterLevel pools can form
  };
}

// Terrain sits low — ground-level, zoomed-in feel. Less sky, more land.
const ARCHETYPES: TerrainArchetype[] = [
  {
    name: "rolling",
    freq1: 0.025, freq2: 0.06,
    amp1: 0.12, amp2: 0.05,
    baseHeight: [0.22, 0.30], roughness: [0.5, 0.8],
    waterLevel: [0.12, 0.18],
    waterFeatures: { freq: 0.04, poolThreshold: 0.6, dryThreshold: -0.3, poolRange: 6 },
  },
  {
    name: "canyon",
    freq1: 0.015, freq2: 0.12,
    amp1: 0.18, amp2: 0.08,
    baseHeight: [0.25, 0.35], roughness: [0.6, 0.9],
    waterLevel: [0.08, 0.14],
    waterFeatures: { freq: 0.02, poolThreshold: 0.55, dryThreshold: -0.5, poolRange: 4 },
  },
  {
    name: "archipelago",
    freq1: 0.04, freq2: 0.09,
    amp1: 0.12, amp2: 0.06,
    baseHeight: [0.20, 0.28], roughness: [0.4, 0.7],
    waterLevel: [0.22, 0.28],
    waterFeatures: { freq: 0.08, poolThreshold: 0.45, dryThreshold: 0.1, poolRange: 10 },
  },
  {
    name: "plateau",
    freq1: 0.02, freq2: 0.15,
    amp1: 0.10, amp2: 0.04,
    baseHeight: [0.28, 0.35], roughness: [0.3, 0.5],
    waterLevel: [0.10, 0.18],
    waterFeatures: { freq: 0.06, poolThreshold: 0.5, dryThreshold: -0.4, poolRange: 8 },
    postProcess(heights) {
      for (let x = 0; x < W; x++) {
        const h = heights[x] / H;
        if (h > 0.38) heights[x] = Math.min(heights[x], H * 0.38);
      }
    },
  },
  {
    name: "marsh",
    freq1: 0.05, freq2: 0.03,
    amp1: 0.06, amp2: 0.03,
    baseHeight: [0.18, 0.24], roughness: [0.3, 0.5],
    waterLevel: [0.14, 0.20],
    waterFeatures: { freq: 0.10, poolThreshold: 0.35, dryThreshold: 0.15, poolRange: 12 },
  },
  {
    name: "hills",
    freq1: 0.008, freq2: 0.04,
    amp1: 0.20, amp2: 0.08,
    baseHeight: [0.22, 0.32], roughness: [0.6, 0.9],
    waterLevel: [0.10, 0.16],
    waterFeatures: { freq: 0.05, poolThreshold: 0.55, dryThreshold: -0.2, poolRange: 6 },
  },
  {
    name: "staircase",
    freq1: 0.02, freq2: 0.07,
    amp1: 0.12, amp2: 0.05,
    baseHeight: [0.22, 0.30], roughness: [0.4, 0.6],
    waterLevel: [0.12, 0.18],
    waterFeatures: { freq: 0.07, poolThreshold: 0.48, dryThreshold: -0.1, poolRange: 10 },
    postProcess(heights) {
      const step = H * 0.05;
      for (let x = 0; x < W; x++) {
        heights[x] = Math.round(heights[x] / step) * step;
      }
    },
  },
  {
    // Caldera: high rim peaks flanking a central lava basin.
    // Side-view: two elevated ridges ~35% from center, with the middle sunk
    // below waterLevel so it fills with lava. Signature volcanic terrain.
    name: "caldera",
    freq1: 0.025, freq2: 0.09,
    amp1: 0.10, amp2: 0.04,
    baseHeight: [0.30, 0.40], roughness: [0.55, 0.80],
    waterLevel: [0.24, 0.32],
    waterFeatures: { freq: 0.03, poolThreshold: 0.88, dryThreshold: -0.75, poolRange: 3 },
    postProcess(heights) {
      const cx = W / 2;
      for (let x = 0; x < W; x++) {
        const normDist = Math.abs(x - cx) / (W / 2);
        // Rim peaks: bell curve at ~36% from center
        const rimPeak = Math.exp(-Math.pow((normDist - 0.36) / 0.12, 2)) * H * 0.15;
        // Basin: smooth drop that zeros out at 22% from center
        const basinDrop = Math.max(0, 1.0 - normDist / 0.22) * H * 0.20;
        heights[x] = Math.max(H * 0.06, Math.min(H * 0.90,
          heights[x] + rimPeak - basinDrop
        ));
      }
    },
  },
  {
    // Fjord: high flat tundra plateau with 1-2 deep water channels carved through it.
    // The channels plunge far below waterLevel — cold deep fjords fill with still water.
    name: "fjord",
    freq1: 0.012, freq2: 0.055,
    amp1: 0.08, amp2: 0.03,
    baseHeight: [0.32, 0.44], roughness: [0.38, 0.60],
    waterLevel: [0.28, 0.38],
    waterFeatures: { freq: 0.03, poolThreshold: 0.92, dryThreshold: -0.80, poolRange: 2 },
    postProcess(heights, rng) {
      // Lift the plateau to create high, flat terrain
      for (let x = 0; x < W; x++) {
        heights[x] = Math.min(H * 0.90, heights[x] * 1.22);
      }
      // Carve 1 or 2 deep fjord channels into the plateau
      const fjordCount = rng() < 0.45 ? 2 : 1;
      for (let f = 0; f < fjordCount; f++) {
        const fjordX = Math.floor(W * (0.18 + rng() * 0.64));
        const fjordW = 9 + Math.floor(rng() * 13); // 9–22px wide
        for (let x = 0; x < W; x++) {
          const dist = Math.abs(x - fjordX);
          if (dist < fjordW) {
            const depth = Math.cos((dist / fjordW) * Math.PI * 0.5);
            heights[x] = Math.max(H * 0.05, heights[x] - depth * H * 0.34);
          }
        }
      }
    },
  },
];

/**
 * Biome archetype weights — each biome favors terrain shapes that suit its character.
 * Indices match ARCHETYPES array: rolling, canyon, archipelago, plateau, marsh, hills, staircase.
 *
 *  rolling   — gentle undulating plains: good for temperate, tundra, lush
 *  canyon    — deep cuts, dramatic drops: good for desert, volcanic
 *  archipelago — scattered islands, lots of water: good for lush, temperate
 *  plateau   — flat-topped highlands: good for desert, tundra
 *  marsh     — low and wet: great for lush
 *  hills     — large slow waves: tundra, temperate
 *  staircase — terraced steps: volcanic drama, desert dunes
 */
const BIOME_ARCHETYPE_WEIGHTS: Record<Biome, number[]> = {
  //             rolling  canyon  arch  plateau  marsh  hills  staircase  caldera  fjord
  temperate: [      3,      1,    2,      1,      1,     3,       1,        0,      0  ],
  desert:    [      1,      4,    0,      3,      0,     1,       3,        0,      0  ],
  tundra:    [      3,      0,    1,      2,      1,     4,       0,        0,      3  ], // fjord: glacial channels
  volcanic:  [      0,      4,    1,      1,      0,     2,       4,        4,      0  ], // caldera: iconic volcano bowl
  lush:      [      3,      0,    3,      1,      4,     2,       0,        0,      0  ],
};

function pickArchetype(biome: Biome, rng: () => number): TerrainArchetype {
  const weights = BIOME_ARCHETYPE_WEIGHTS[biome];
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = rng() * total;
  for (let i = 0; i < weights.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return ARCHETYPES[i];
  }
  return ARCHETYPES[ARCHETYPES.length - 1];
}

/** Generate a new terrain from a seed */
export function generateTerrain(seed: number): Terrain {
  seedNoise(seed);

  // Seeded RNG for placement decisions
  const rng = mulberry32(seed);

  const biome = pickBiome(rng());
  const bp = getBiomePalette(biome);

  // Pick terrain archetype weighted by biome — desert gets canyons, tundra gets hills, etc.
  const arch = pickArchetype(biome, rng);

  // Height map: 1D noise across width, shaped by archetype
  const heights = new Float32Array(W);
  const baseHeight = arch.baseHeight[0] + rng() * (arch.baseHeight[1] - arch.baseHeight[0]);
  const roughness = arch.roughness[0] + rng() * (arch.roughness[1] - arch.roughness[0]);

  for (let x = 0; x < W; x++) {
    const n1 = noise2(x * arch.freq1, seed * 0.1) * roughness;
    const n2 = noise2(x * arch.freq2, seed * 0.1 + 50) * roughness * 0.3;
    const h = baseHeight + n1 * arch.amp1 + n2 * arch.amp2;
    heights[x] = Math.max(0.1, Math.min(0.85, h)) * H;
  }

  if (arch.postProcess) arch.postProcess(heights, rng);

  // Water level
  const waterLevel = Math.floor(H * (arch.waterLevel[0] + rng() * (arch.waterLevel[1] - arch.waterLevel[0])));

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
          // Underground — layered strata with noise-warped boundaries
          const depth = y - surfaceY;
          const strataWarp = noise2(x * 0.1, y * 0.1) * 2;
          const effectiveDepth = depth + strataWarp;
          if (effectiveDepth <= 2) {
            tiles[idx] = Tile.DarkGround;
          } else if (effectiveDepth <= 6) {
            tiles[idx] = Tile.Subsoil;
          } else if (effectiveDepth <= 12) {
            tiles[idx] = Tile.Cliff;
          } else {
            tiles[idx] = Tile.DeepRock;
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

  // Underground cave networks: noise-carved pockets
  for (let x = 0; x < W; x++) {
    const surfaceY = Math.floor(H - heights[x]);
    for (let y = surfaceY + 6; y < H; y++) {
      const idx = y * W + x;
      const tile = tiles[idx] as Tile;
      // Skip water tiles
      if (tile === Tile.DeepWater || tile === Tile.ShallowWater) continue;
      // Use different noise domain for caves
      const caveNoise = noise2(x * 0.06, y * 0.08 + seed * 0.2);
      if (caveNoise > 0.52) {
        tiles[idx] = Tile.CaveInterior;
        // Underground water pools at the bottom of cave pockets
        const worldH = H - y;
        if (worldH <= waterLevel + 4 && caveNoise < 0.58) {
          tiles[idx] = Tile.ShallowWater;
        }
      }
    }
  }

  // Water feature pass: noise-carved pools and dry gaps for variety
  // Skip elevated pools for volcanic — lava pockets on land look wrong
  if (arch.waterFeatures) {
    const wf = arch.waterFeatures;
    const isVolcanic = biome === "volcanic";
    for (let x = 0; x < W; x++) {
      const surfaceY = Math.floor(H - heights[x]);
      for (let y = surfaceY; y < H; y++) {
        const worldY = H - y;
        const idx = y * W + x;
        const tile = tiles[idx] as Tile;

        // Use a separate noise domain (offset by seed * 0.3) for water features
        const waterNoise = noise2(x * wf.freq, y * wf.freq + seed * 0.3);

        // Elevated pools: above the water line, noise carves pockets of water
        // Skip for volcanic — elevated lava pools on land look unnatural
        if (!isVolcanic && worldY > waterLevel && worldY < waterLevel + wf.poolRange) {
          if (waterNoise > wf.poolThreshold && tile !== Tile.Air && tile !== Tile.CaveInterior) {
            tiles[idx] = Tile.ShallowWater;
          }
        }

        // Dry gaps: within the water zone, noise removes water to create islands/sandbars
        // Volcanic: use DarkGround instead of Sand to avoid grey patches next to lava
        if (worldY <= waterLevel && (tile === Tile.ShallowWater || tile === Tile.DeepWater)) {
          if (waterNoise < wf.dryThreshold) {
            tiles[idx] = isVolcanic ? Tile.DarkGround : Tile.Sand;
          }
        }
      }
    }
  }

  const terrain: Terrain = { tiles, heights, waterLevel, biome, bp, seed, archetype: arch.name };

  // Place features
  placeFeatures(terrain, rng);

  return terrain;
}

function placeFeatures(t: Terrain, rng: () => number): void {
  const biome = t.biome;

  if (biome === "desert") {
    // Cacti: vertical columns of TreeCanopy (dark green) with arm stubs
    // Desert bp has treeCanopy=11 (deep forest green) — perfect for cacti
    const cactusCount = 10 + Math.floor(rng() * 14);
    for (let i = 0; i < cactusCount; i++) {
      const x = 4 + Math.floor(rng() * (W - 8));
      const surfaceY = getSurfaceY(t, x);
      if (surfaceY < 2) continue;
      const worldH = H - surfaceY;
      if (worldH <= t.waterLevel + 2) continue;
      if (x > 0 && x < W - 1) {
        const slope = Math.abs(t.heights[x + 1] - t.heights[x - 1]);
        if (slope > 3) continue; // cacti grow on moderately sloped dunes
      }
      const height = 5 + Math.floor(rng() * 5); // 5–9px tall
      const armHeight = 1 + Math.floor(rng() * Math.floor(height / 2)); // arm level from base
      // Main column
      for (let dy = 0; dy < height; dy++) {
        const cy = surfaceY - 1 - dy;
        if (cy >= 0) t.tiles[cy * W + x] = Tile.TreeCanopy;
      }
      // Arms: one or two pixels to each side at armHeight
      const acy = surfaceY - 1 - armHeight;
      if (acy >= 0) {
        if (x > 0) t.tiles[acy * W + x - 1] = Tile.TreeCanopy;
        if (x < W - 1) t.tiles[acy * W + x + 1] = Tile.TreeCanopy;
        // Second arm segment reaches upward
        if (acy - 1 >= 0 && rng() < 0.6) {
          if (x > 0) t.tiles[(acy - 1) * W + x - 1] = Tile.TreeCanopy;
          if (x < W - 1) t.tiles[(acy - 1) * W + x + 1] = Tile.TreeCanopy;
        }
      }
    }
  } else if (biome === "volcanic") {
    // Rock spires: jagged Cliff columns jutting above the surface
    // Volcanic bp has cliff=0 (near-void black) — menacing dark spires
    const spireCount = 8 + Math.floor(rng() * 12);
    for (let i = 0; i < spireCount; i++) {
      const x = 4 + Math.floor(rng() * (W - 8));
      const surfaceY = getSurfaceY(t, x);
      if (surfaceY < 2) continue;
      const worldH = H - surfaceY;
      if (worldH <= t.waterLevel + 2) continue;
      const height = 5 + Math.floor(rng() * 10); // 5–14px tall spires
      const baseWidth = rng() < 0.4 ? 2 : 1; // some spires have a 2px base
      for (let dy = 0; dy < height; dy++) {
        const cy = surfaceY - 1 - dy;
        if (cy < 0) break;
        // Taper: full width at base, 1px near tip
        const w = dy < 2 ? baseWidth : 1;
        for (let dx = 0; dx < w; dx++) {
          const cx = x + dx;
          if (cx < W) t.tiles[cy * W + cx] = Tile.Cliff;
        }
      }
    }
  } else {
    // Trees: temperate, lush, tundra — organic canopy shapes
    // Tundra gets sparse dead trees; lush gets denser; temperate standard
    const treeCount = biome === "lush"   ? 32 + Math.floor(rng() * 26) :
                      biome === "tundra" ? 10 + Math.floor(rng() * 10) :
                                           24 + Math.floor(rng() * 30);
    for (let i = 0; i < treeCount; i++) {
      const x = 4 + Math.floor(rng() * (W - 8));
      const surfaceY = getSurfaceY(t, x);
      if (surfaceY < 2) continue;
      const worldH = H - surfaceY;
      if (worldH <= t.waterLevel + 2) continue;
      if (x > 0 && x < W - 1) {
        const slope = Math.abs(t.heights[x + 1] - t.heights[x - 1]);
        if (slope > 2) continue;
      }
      const trunkH = 3 + Math.floor(rng() * 3); // 3-5px trunk (was 2-3)
      const ty = surfaceY - 1;
      for (let dy = 0; dy < trunkH; dy++) {
        const idx = (ty - dy) * W + x;
        if (ty - dy >= 0) t.tiles[idx] = Tile.TreeTrunk;
      }
      const canopyY = ty - trunkH;
      if (biome === "tundra") {
        // Dead tree: narrow silhouette, sparse branching
        if (canopyY >= 0) t.tiles[canopyY * W + x] = Tile.TreeCanopy;
        if (canopyY - 1 >= 0) t.tiles[(canopyY - 1) * W + x] = Tile.TreeCanopy;
        // Sparse branch stubs off to one or both sides
        if (canopyY + 1 >= 0 && canopyY + 1 < H && rng() < 0.65) {
          const side = rng() < 0.5 ? -1 : 1;
          if (x + side >= 0 && x + side < W) {
            t.tiles[(canopyY + 1) * W + x + side] = Tile.TreeCanopy;
          }
        }
      } else {
        // Full canopy: 5px wide × 3px tall (lush gets 4 rows)
        const canopyRows = biome === "lush" ? 4 : 3;
        for (let dy = 0; dy < canopyRows; dy++) {
          // Wider at base (±2), narrower at top (±1)
          const halfW = dy < canopyRows - 1 ? 2 : 1;
          for (let dx = -halfW; dx <= halfW; dx++) {
            const cx = x + dx;
            const cy = canopyY - dy;
            if (cx >= 0 && cx < W && cy >= 0) {
              // Randomly skip outer corners on top row for organic shape
              if (dy === canopyRows - 1 && Math.abs(dx) === halfW && rng() < 0.3) continue;
              t.tiles[cy * W + cx] = Tile.TreeCanopy;
            }
          }
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
