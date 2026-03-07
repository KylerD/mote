// terrain-render.ts — Terrain rendering: sky gradient, tile colors, surface detail.

import { noise2 } from "./noise";
import { W, H } from "./config";
import { Tile } from "./types";
import type { Terrain, RGB, BiomePalette } from "./types";
import { setPixel } from "./render";
import { PAL, lerpColor } from "./palette";
import { getSurfaceY } from "./terrain-query";

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
    case Tile.Subsoil: return bp.subsoil;
    case Tile.DeepRock: return bp.deepRock;
    case Tile.CaveInterior: return 0; // near-black void
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

/** Smooth interpolated sky tint for a given cycle position (0-1) */
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

/** Pre-compute background mountain heights (called once per terrain generation) */
function generateBgMountains(seed: number): Float32Array {
  const bgHeights = new Float32Array(W);
  for (let x = 0; x < W; x++) {
    const n1 = noise2(x * 0.012, seed * 0.3 + 100);
    const n2 = noise2(x * 0.03, seed * 0.3 + 200) * 0.3;
    bgHeights[x] = (0.3 + (n1 + n2) * 0.18) * H;
  }
  return bgHeights;
}

// Cache background mountains per seed
let bgMountainCache: { seed: number; heights: Float32Array } | null = null;

function getBgMountains(seed: number): Float32Array {
  if (bgMountainCache && bgMountainCache.seed === seed) return bgMountainCache.heights;
  const heights = generateBgMountains(seed);
  bgMountainCache = { seed, heights };
  return heights;
}

/** Render terrain + sky into the buffer */
export function renderTerrain(
  buf: ImageData,
  terrain: Terrain,
  time: number,
  cycleProgress: number,
): void {
  const { tiles, bp } = terrain;
  const biome = terrain.biome;
  const skyTop = PAL[bp.sky];
  const skyBot = PAL[bp.skyHorizon];
  const tint = skyTintAt(cycleProgress);
  const bgMountains = getBgMountains(terrain.seed);
  const bgColor = PAL[bp.cliff];

  // Pre-compute surface Y per column for horizon glow
  const surfaceYCache = new Int16Array(W);
  for (let hx = 0; hx < W; hx++) surfaceYCache[hx] = getSurfaceY(terrain, hx);

  // Horizon glow: warm amber/orange at genesis & dissolution, cool violet at silence
  // Each glows at the sky-terrain seam and fades upward over ~16 pixels
  const inGenesis     = cycleProgress < 0.16;
  const inDissolution = cycleProgress >= 0.76 && cycleProgress < 0.92;
  const inSilence     = cycleProgress >= 0.92;
  const glowStrength  =
    inGenesis     ? Math.sin(cycleProgress / 0.16 * Math.PI * 0.5) * 0.72 :
    inDissolution ? Math.sin((cycleProgress - 0.76) / 0.16 * Math.PI) * 1.0 :
    inSilence     ? 0.48 * (1 - (cycleProgress - 0.92) / 0.08) :
    0;
  const glowWarm = !inSilence; // warm amber vs cool violet

  // Background mountain color: biome-matched silhouette
  // Slightly lighter/tinted version of the cliff color for atmospheric depth
  const bgMtnR = biome === "desert"   ? Math.min(255, bgColor[0] + 30) :
                 biome === "tundra"   ? Math.min(255, bgColor[0] + 20) :
                 biome === "volcanic" ? bgColor[0] :
                 biome === "lush"     ? Math.max(0, bgColor[0] - 10) :
                                        bgColor[0] + 15;
  const bgMtnG = biome === "desert"   ? Math.min(255, bgColor[1] + 18) :
                 biome === "tundra"   ? Math.min(255, bgColor[1] + 25) :
                 biome === "volcanic" ? bgColor[1] :
                 biome === "lush"     ? Math.min(255, bgColor[1] + 18) :
                                        bgColor[1] + 15;
  const bgMtnB = biome === "desert"   ? Math.min(255, bgColor[2] + 8)  :
                 biome === "tundra"   ? Math.min(255, bgColor[2] + 40) :
                 biome === "volcanic" ? bgColor[2] :
                 biome === "lush"     ? Math.max(0, bgColor[2] - 5)    :
                                        bgColor[2] + 18;

  const d = buf.data;

  // Pre-compute sky reflection color for water tiles — mid-sky tinted by phase
  const midSky = lerpColor(skyTop, skyBot, 0.4);
  const skyReflR = Math.max(0, Math.min(255, midSky[0] + tint[0] * 0.6));
  const skyReflG = Math.max(0, Math.min(255, midSky[1] + tint[1] * 0.6));
  const skyReflB = Math.max(0, Math.min(255, midSky[2] + tint[2] * 0.6));

  // Phase-driven terrain lighting: sunlight angle/color shifts through the cycle
  const inGoldenHour = cycleProgress >= 0.68 && cycleProgress < 0.92;
  const inDawn       = cycleProgress < 0.12;
  const inDusk       = cycleProgress >= 0.92;
  let lightR = 0, lightG = 0, lightB = 0, lightStr = 0;
  if (inGoldenHour) {
    // Warm amber-gold light — peaks at dissolution, fades toward silence
    const gp = (cycleProgress - 0.68) / 0.24;
    lightStr = Math.sin(gp * Math.PI) * 0.55;
    lightR = 38; lightG = 14; lightB = -22;
  } else if (inDawn) {
    // Cool blue-violet pre-dawn — fades as sun rises
    const dp = cycleProgress / 0.12;
    lightStr = (1 - dp) * 0.35;
    lightR = -8; lightG = -5; lightB = 22;
  } else if (inDusk) {
    // Deep indigo moonlight
    lightStr = 0.38;
    lightR = -12; lightG = -8; lightB = 24;
  }

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = y * W + x;
      const tile = tiles[idx] as Tile;
      const pi = idx * 4;

      if (tile === Tile.Air) {
        // Sky gradient
        const t = y / (H * 0.6);
        const st = Math.min(1, Math.max(0, t));
        const c: RGB = lerpColor(skyTop, skyBot, st);
        const tintStr = 1 - st * 0.7;
        let r = Math.max(0, Math.min(255, c[0] + tint[0] * tintStr));
        let g = Math.max(0, Math.min(255, c[1] + tint[1] * tintStr));
        let b = Math.max(0, Math.min(255, c[2] + tint[2] * tintStr));

        // Background mountains — blend distant silhouettes over sky
        // Two depth layers: far (lighter) and near (darker), based on height
        const bgSurfY = Math.floor(H - bgMountains[x]);
        if (y >= bgSurfY) {
          // Depth-based blend: stronger near the surface (more opaque mountains)
          const depthIntoMtn = y - bgSurfY;
          const blend = Math.min(0.52, 0.35 + depthIntoMtn * 0.025);
          r = r * (1 - blend) + bgMtnR * blend;
          g = g * (1 - blend) + bgMtnG * blend;
          b = b * (1 - blend) + bgMtnB * blend;
        }

        // Horizon glow: warm/cool band rising from the terrain surface
        if (glowStrength > 0) {
          const dist = surfaceYCache[x] - y; // pixels above terrain surface
          if (dist >= 0 && dist < 16) {
            const gf = (1 - dist / 16) * (1 - dist / 16) * glowStrength; // quadratic falloff
            if (glowWarm) {
              // Dawn / dusk: warm amber-orange
              r = Math.min(255, r + 95 * gf);
              g = Math.min(255, g + 38 * gf);
              b = Math.max(0,   b - 22 * gf);
            } else {
              // Twilight / silence: cool blue-violet
              r = Math.min(255, r + 28 * gf);
              g = Math.max(0,   g - 12 * gf);
              b = Math.min(255, b + 55 * gf);
            }
          }
        }

        d[pi]     = Math.round(r);
        d[pi + 1] = Math.round(g);
        d[pi + 2] = Math.round(b);
        d[pi + 3] = 255;
      } else if (tile === Tile.CaveInterior) {
        // Cave interiors: near-black with subtle texture
        const flicker = noise2(x * 0.3, y * 0.3) * 0.5 + 0.5;
        const brightness = 8 + flicker * 12;
        d[pi]     = brightness;
        d[pi + 1] = brightness;
        d[pi + 2] = brightness + 4;
        d[pi + 3] = 255;
      } else if (biome === "volcanic" && (tile === Tile.DeepWater || tile === Tile.ShallowWater)) {
        // Lava: animated orange-red glow — volcanic water is molten rock
        const lavaFlicker = noise2(x * 0.28 + time * 0.55, y * 0.22 - time * 0.35) * 0.5 + 0.5;
        const depthDim = tile === Tile.DeepWater ? 0.70 : 0.88; // deep lava slightly darker
        d[pi]     = Math.round(Math.min(255, (145 + lavaFlicker * 95) * depthDim));
        d[pi + 1] = Math.round(Math.min(255, (28  + lavaFlicker * 72) * depthDim));
        d[pi + 2] = 8;
        d[pi + 3] = 255;
      } else if (tile === Tile.DeepWater || tile === Tile.ShallowWater) {
        // Water with sky reflection: blend phase-tinted sky into the water surface
        const ci = tileColor(tile, bp);
        const wc = PAL[ci];
        const refl = tile === Tile.ShallowWater ? 0.28 : 0.14;
        d[pi]     = Math.round(Math.min(255, wc[0] + (skyReflR - wc[0]) * refl));
        d[pi + 1] = Math.round(Math.min(255, wc[1] + (skyReflG - wc[1]) * refl));
        d[pi + 2] = Math.round(Math.min(255, wc[2] + (skyReflB - wc[2]) * refl));
        d[pi + 3] = 255;
      } else {
        const ci = tileColor(tile, bp);
        if (ci >= 0) {
          d[pi]     = PAL[ci][0];
          d[pi + 1] = PAL[ci][1];
          d[pi + 2] = PAL[ci][2];
          d[pi + 3] = 255;
          // Phase lighting on surface tiles: warm at golden hour, cool at dawn/dusk
          if (lightStr > 0) {
            const distSurf = y - surfaceYCache[x];
            if (distSurf >= 0 && distSurf < 3) {
              const fade = (1 - distSurf * 0.4) * lightStr;
              d[pi]     = Math.min(255, Math.max(0, d[pi]     + Math.round(lightR * fade)));
              d[pi + 1] = Math.min(255, Math.max(0, d[pi + 1] + Math.round(lightG * fade)));
              d[pi + 2] = Math.min(255, Math.max(0, d[pi + 2] + Math.round(lightB * fade)));
            }
          }
        }
      }
    }
  }

  // Surface detail: grass blades, flowers, vines
  renderSurfaceDetail(buf, terrain);

  // Water surface shimmer: animated wave highlights across water
  renderWaterShimmer(buf, terrain, time);
}

/** Animated water shimmer — layered waves with depth variation */
function renderWaterShimmer(buf: ImageData, terrain: Terrain, time: number): void {
  const { bp, biome } = terrain;

  if (biome === "volcanic") {
    // Lava surface: bright yellow-orange hotspot glints and dark crust cracks
    for (let x = 0; x < W; x++) {
      const surfaceY = getSurfaceY(terrain, x);
      const worldH = H - surfaceY;
      if (worldH > terrain.waterLevel || worldH < terrain.waterLevel - 6) continue;
      // Slow roiling hotspots
      const lw1 = Math.sin(x * 0.22 + time * 0.7) * 0.5 + 0.5;
      const lw2 = Math.sin(x * 0.41 - time * 0.5 + 2.1) * 0.5 + 0.5;
      const lwave = lw1 * 0.6 + lw2 * 0.4;
      // Bright yellow hotspot — crust cracking open
      if (lwave > 0.72) {
        const a = Math.round((lwave - 0.72) / 0.28 * 200);
        setPixel(buf, x, surfaceY, 255, Math.round(180 + lwave * 60), 20, a);
      }
      // Dark crust between hot spots
      if (lwave < 0.28) {
        const a = Math.round((0.28 - lwave) / 0.28 * 80);
        setPixel(buf, x, surfaceY, 35, 18, 5, a);
      }
    }
    return;
  }

  const shallowC = PAL[bp.shallowWater];
  const skyC = PAL[bp.sky];

  for (let x = 0; x < W; x++) {
    const surfaceY = getSurfaceY(terrain, x);
    const worldH = H - surfaceY;
    if (worldH > terrain.waterLevel || worldH < terrain.waterLevel - 8) continue;

    // Three overlapping wave frequencies for organic motion
    const w1 = Math.sin(x * 0.18 + time * 1.8) * 0.5 + 0.5;
    const w2 = Math.sin(x * 0.31 - time * 2.4 + 1.3) * 0.5 + 0.5;
    const w3 = Math.sin(x * 0.07 + time * 0.9 + 2.7) * 0.5 + 0.5;
    const wave = w1 * 0.5 + w2 * 0.3 + w3 * 0.2;

    // Surface glint — brightest highlights
    if (wave > 0.78) {
      const a = Math.round((wave - 0.78) / 0.22 * 160);
      setPixel(buf, x, surfaceY,
        Math.min(255, skyC[0] + 40),
        Math.min(255, skyC[1] + 40),
        Math.min(255, skyC[2] + 30), a);
    }

    // Shallow shimmer — sub-surface ripple color
    if (wave > 0.55 && surfaceY + 1 < H) {
      const a = Math.round((wave - 0.55) / 0.45 * 70);
      setPixel(buf, x, surfaceY + 1,
        shallowC[0] + 20, shallowC[1] + 20, shallowC[2] + 25, a);
    }

    // Occasional dark trough between waves
    if (wave < 0.22) {
      const a = Math.round((0.22 - wave) / 0.22 * 40);
      setPixel(buf, x, surfaceY,
        Math.max(0, shallowC[0] - 15),
        Math.max(0, shallowC[1] - 12),
        Math.max(0, shallowC[2] - 8), a);
    }
  }
}

/** Decorative surface detail — grass, flowers, vines, mushrooms */
function renderSurfaceDetail(buf: ImageData, terrain: Terrain): void {
  const { tiles, bp, biome, waterLevel } = terrain;
  const skipGrass = biome === "desert" || biome === "volcanic";
  const lushBoost = biome === "lush" ? 0.15 : 0;

  for (let x = 0; x < W; x++) {
    const surfaceY = getSurfaceY(terrain, x);
    const worldH = H - surfaceY;
    if (worldH <= waterLevel) continue; // underwater — no decoration

    const surfTile = tiles[surfaceY * W + x] as Tile;
    const aboveIdx = (surfaceY - 1) * W + x;

    // Grass blades: 1px above ground surface
    if (!skipGrass && surfaceY > 0 &&
        (surfTile === Tile.Ground || surfTile === Tile.Sand) &&
        (tiles[aboveIdx] as Tile) === Tile.Air) {
      const grassChance = noise2(x * 0.5, terrain.seed * 0.7) * 0.5 + 0.5;
      if (grassChance > (0.55 - lushBoost)) {
        const gc = PAL[bp.treeCanopy];
        // Slightly brighter than canopy for contrast
        setPixel(buf, x, surfaceY - 1, gc[0] + 15, gc[1] + 20, gc[2] + 10, 180);
      }
    }

    // Flowers: rare bright pixels on grassy surfaces
    if (!skipGrass && surfaceY > 0 &&
        surfTile === Tile.Ground &&
        (tiles[aboveIdx] as Tile) === Tile.Air) {
      const flowerChance = noise2(x * 1.3, terrain.seed * 1.1) * 0.5 + 0.5;
      if (flowerChance > (0.93 - lushBoost * 0.5)) {
        // Pick flower color deterministically from position
        const colorPick = Math.floor(noise2(x * 2.7, terrain.seed * 0.3) * 3 + 3) % 3;
        const flowerColors: RGB[] = [
          PAL[13], // ember
          PAL[14], // gold
          PAL[15], // dusk
        ];
        const fc = flowerColors[colorPick];
        setPixel(buf, x, surfaceY - 1, fc[0], fc[1], fc[2], 220);
      }
    }

    // Vines on cliff faces: hanging pixels next to Air
    if ((biome === "temperate" || biome === "lush") && surfTile === Tile.Cliff) {
      // Check if there's air to the left or right
      const hasAirLeft = x > 0 && (tiles[surfaceY * W + x - 1] as Tile) === Tile.Air;
      const hasAirRight = x < W - 1 && (tiles[surfaceY * W + x + 1] as Tile) === Tile.Air;
      if (hasAirLeft || hasAirRight) {
        const vineChance = noise2(x * 0.8, surfaceY * 0.6) * 0.5 + 0.5;
        if (vineChance > 0.75) {
          const vineX = hasAirLeft ? x - 1 : x + 1;
          const vc = PAL[11]; // dark green
          setPixel(buf, vineX, surfaceY, vc[0], vc[1], vc[2], 160);
          // Extend vine downward 1-2 pixels
          if (surfaceY + 1 < H && (tiles[(surfaceY + 1) * W + vineX] as Tile) === Tile.Air) {
            setPixel(buf, vineX, surfaceY + 1, vc[0], vc[1], vc[2], 120);
          }
        }
      }
    }

    // Mushrooms in caves
    if (surfTile === Tile.Cave && surfaceY + 1 < H) {
      const mushChance = noise2(x * 1.5, surfaceY * 0.9) * 0.5 + 0.5;
      if (mushChance > 0.75) {
        const mc = PAL[15]; // dusk purple
        setPixel(buf, x, surfaceY, mc[0], mc[1], mc[2], 180);
      }
    }

    // Frost crystals on tundra ground — icy white-blue glint on and above the surface
    if (biome === "tundra" &&
        (surfTile === Tile.Ground || surfTile === Tile.DarkGround || surfTile === Tile.Sand)) {
      const frostNoise = noise2(x * 0.85, terrain.seed * 0.4 + 311) * 0.5 + 0.5;
      if (frostNoise > 0.52) {
        // Frost on the ground tile itself — lightens and blue-shifts the surface
        const fi = Math.round((frostNoise - 0.52) / 0.48 * 100);
        setPixel(buf, x, surfaceY, 210, 225, 245, fi);
        // Frost crystal pixel above the surface — taller crystals at higher noise values
        if (surfaceY > 0 && frostNoise > 0.70) {
          const crystalA = Math.round((frostNoise - 0.70) / 0.30 * 80);
          setPixel(buf, x, surfaceY - 1, 240, 248, 255, crystalA);
        }
      }
    }
  }
}

/**
 * Volcanic ash accumulation — during dissolution/silence, ash progressively coats
 * the ground in volcanic biomes. Surface tiles grey-shift toward dark warm ash,
 * as if the world's fires are banking and the fallout is settling.
 * Call after terrain + weather are composited, before motes.
 */
export function applyVolcanicAsh(buf: ImageData, terrain: Terrain, cycleProgress: number): void {
  if (terrain.biome !== "volcanic") return;

  const ashStart = 0.68;
  const ashStrength = Math.max(0, Math.min(1, (cycleProgress - ashStart) / 0.24));
  if (ashStrength < 0.02) return;

  // Ash color: warm dark grey — volcanic ash has a faint reddish warmth
  const ashR = 58, ashG = 50, ashB = 45;
  const d = buf.data;

  for (let x = 0; x < W; x++) {
    const surfaceY = getSurfaceY(terrain, x);
    // Coat surface tile and one pixel above (exposed tops of spires, cliffs)
    for (let dy = -1; dy <= 0; dy++) {
      const y = surfaceY + dy;
      if (y < 0 || y >= H) continue;
      const tile = terrain.tiles[y * W + x] as Tile;
      // Skip air and water/lava — ash only settles on solid surfaces
      if (tile === Tile.Air || tile === Tile.DeepWater || tile === Tile.ShallowWater) continue;

      // Surface tile gets heavier coat, pixel above gets lighter dusting
      const blendStr = dy === 0 ? ashStrength * 0.40 : ashStrength * 0.16;
      const pi = (y * W + x) * 4;
      d[pi]     = Math.round(d[pi]     * (1 - blendStr) + ashR * blendStr);
      d[pi + 1] = Math.round(d[pi + 1] * (1 - blendStr) + ashG * blendStr);
      d[pi + 2] = Math.round(d[pi + 2] * (1 - blendStr) + ashB * blendStr);
    }
  }
}

/**
 * Desert heat haze — warm shimmering glow in the air above hot desert terrain.
 * Call after terrain + weather are composited, before motes are drawn.
 * Only active in hot phases (exploration through dissolution).
 */
export function applyHeatHaze(buf: ImageData, terrain: Terrain, time: number, cycleProgress: number): void {
  if (terrain.biome !== "desert") return;

  // Only during the hot part of the day
  const hotStart = 0.10, hotEnd = 0.88;
  if (cycleProgress < hotStart || cycleProgress > hotEnd) return;

  // Intensity peaks at midday, tapers at dawn/dusk
  const p = (cycleProgress - hotStart) / (hotEnd - hotStart);
  const intensity = Math.sin(p * Math.PI);
  if (intensity < 0.08) return;

  const d = buf.data;

  for (let x = 0; x < W; x++) {
    const surfaceY = getSurfaceY(terrain, x);

    // Heat haze zone: 3–28px above surface
    for (let dist = 3; dist < 28; dist++) {
      const y = surfaceY - dist;
      if (y < 0) break;

      // Two overlapping noise frequencies for organic shimmering bands
      const n1 = noise2(x * 0.18 + time * 1.2, y * 0.22 - time * 0.6) * 0.5 + 0.5;
      const n2 = noise2(x * 0.31 - time * 0.9, y * 0.15 + time * 0.4) * 0.5 + 0.5;
      const haze = n1 * 0.6 + n2 * 0.4;

      // Quadratic falloff with height — hottest just above ground
      const nearGround = Math.pow(1 - dist / 28, 2);
      const hazeStr = haze * nearGround * intensity;
      if (hazeStr < 0.05) continue;

      const pi = (y * W + x) * 4;
      // Warm yellow shimmer: boost R and G, slightly cool B
      d[pi]     = Math.min(255, d[pi]     + Math.round(hazeStr * 26));
      d[pi + 1] = Math.min(255, d[pi + 1] + Math.round(hazeStr * 13));
      d[pi + 2] = Math.max(0,   d[pi + 2] - Math.round(hazeStr * 9));
    }
  }
}
