// terrain-render.ts — Terrain rendering: sky gradient, tile colors, surface detail.

import { noise2 } from "./noise";
import { W, H } from "./config";
import { Tile } from "./types";
import type { Terrain, RGB, BiomePalette, Weather } from "./types";
import { setPixel } from "./render";
import { PAL, lerpColor } from "./palette";
import { getSurfaceY } from "./terrain-query";

// Fixed star x-columns — same 140 stars every cycle (positions not cycle-seeded in weather-render).
// Precomputed once for water star-reflection lookup.
const _STAR_COLS = new Uint8Array(W);
(function () {
  for (let i = 0; i < 140; i++) {
    _STAR_COLS[Math.abs((i * 8191 + 23747) % W)] = 1;
  }
}());

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
  [-22, -18,  30],  // genesis:      deep indigo night — stars visible, world not yet awake
  [  4,   2,  -6],  // exploration:  cool dawn light — clear day opening
  [  8,   5,  -5],  // organization: slight warmth — mid-day building
  [ 12,   6,  -8],  // complexity:   warm afternoon — peak light
  [ 48,  16, -28],  // dissolution:  golden hour — amber light, things fading
  [-18, -22,  35],  // silence:      deep indigo return to night — the world going to sleep
];

// Cumulative phase boundaries (fractions of cycle) — mirrors world.ts PHASE_DURATIONS
const TINT_BOUNDARIES = [0.10, 0.30, 0.55, 0.80, 0.92, 1.0];

/**
 * Per-phase horizon glow: [strength, rOff, gOff, bOff]
 * A band of atmospheric light rising from the terrain surface into the lower sky.
 * Each phase has a distinct atmospheric color — this is the emotional heartbeat of the cycle.
 *   Genesis:      cold pre-dawn violet — world barely stirring, moon still overhead
 *   Exploration:  warm sunrise pink-orange — world waking, sun cresting hills
 *   Organization: golden midday warmth — life building under full light
 *   Complexity:   soft amber vitality — peak life, world humming with energy
 *   Dissolution:  blazing amber sunset — the light that says goodbye
 *   Silence:      ice-blue moonlight — cold, still, the world emptied
 */
const HORIZON_GLOW: [number, number, number, number][] = [
  [0.68,  18,  -8,  52],  // genesis:      cold pre-dawn violet-blue
  [0.52,  82,  40,   8],  // exploration:  warm sunrise orange-pink
  [0.34,  52,  32,   2],  // organization: golden midday shimmer
  [0.24,  38,  20,  -2],  // complexity:   soft warm vitality glow
  [1.05,  95,  38, -22],  // dissolution:  blazing amber-gold sunset
  [0.45,  12, -18,  58],  // silence:      ice-blue moonlight
];

/** Smooth interpolated horizon glow for a given cycle position (0-1) */
function horizonGlowAt(cycleProgress: number): [number, number, number, number] {
  let prev = 0;
  for (let i = 0; i < TINT_BOUNDARIES.length; i++) {
    if (cycleProgress <= TINT_BOUNDARIES[i]) {
      const t = (cycleProgress - prev) / (TINT_BOUNDARIES[i] - prev);
      const a = HORIZON_GLOW[i];
      const b = HORIZON_GLOW[(i + 1) % HORIZON_GLOW.length];
      return [
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t,
        a[3] + (b[3] - a[3]) * t,
      ];
    }
    prev = TINT_BOUNDARIES[i];
  }
  return HORIZON_GLOW[5];
}

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

  // Horizon glow: phase-specific atmospheric band at the terrain/sky seam.
  // Present in ALL phases — each has its own color and strength.
  // Interpolated smoothly across phase boundaries for fluid transitions.
  const [hgBaseStr, hgR, hgG, hgB] = horizonGlowAt(cycleProgress);
  // Modulate strength within key phases for dramatic arcs:
  // Genesis fades in slowly; dissolution pulses through its arc; silence fades to cold quiet.
  const inGenesis     = cycleProgress < 0.16;
  const inDissolution = cycleProgress >= 0.76 && cycleProgress < 0.92;
  const inSilence     = cycleProgress >= 0.92;
  const glowStrength  =
    inGenesis     ? hgBaseStr * Math.sin(cycleProgress / 0.16 * Math.PI * 0.5) :
    inDissolution ? hgBaseStr * Math.sin((cycleProgress - 0.76) / 0.16 * Math.PI) :
    inSilence     ? hgBaseStr * (1 - (cycleProgress - 0.92) / 0.08) :
    hgBaseStr;

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

  // Phase index from cycle progress — drives water reflection strength
  const phaseIndex =
    cycleProgress < 0.10 ? 0 : cycleProgress < 0.30 ? 1 :
    cycleProgress < 0.55 ? 2 : cycleProgress < 0.80 ? 3 :
    cycleProgress < 0.92 ? 4 : 5;

  // Night-phase star-reflection intensity: genesis fades out by 18%, silence fades in from 78%
  const nightReflStr =
    phaseIndex === 0 ? (cycleProgress < 0.06 ? 1.0 : Math.max(0, 1 - (cycleProgress - 0.06) / 0.12)) :
    phaseIndex === 5 ? Math.min(1, (cycleProgress - 0.92) / 0.06) : 0;

  // Sunset gradient strength: blazing orange-to-purple sky during dissolution
  const sunsetStr =
    cycleProgress >= 0.72 && cycleProgress < 0.94
      ? Math.sin((cycleProgress - 0.72) / 0.22 * Math.PI) * 1.15
      : 0;

  // Sky at zenith (top of screen) — what still water mirrors looking straight up.
  // Full phase tint applied: night water goes indigo-dark, golden-hour water warms.
  const skyReflR = Math.max(0, Math.min(255, skyTop[0] + tint[0] + Math.round(70 * sunsetStr)));
  const skyReflG = Math.max(0, Math.min(255, skyTop[1] + tint[1] + Math.round(22 * sunsetStr)));
  const skyReflB = Math.max(0, Math.min(255, skyTop[2] + tint[2] + Math.round(-48 * sunsetStr)));

  // Phase reflection multiplier — dawn/dusk and night produce the strongest mirror surface.
  // Golden hour (dissolution) is peak: the world's most beautiful moment reflected in water.
  const REFL_PHASE = [0.65, 0.82, 0.40, 0.50, 0.88, 0.70];
  const reflPhase = REFL_PHASE[phaseIndex];

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
    // Deep indigo moonlight — stronger than dawn, the world is cold and still
    const silenceDepth = Math.min(1, (cycleProgress - 0.92) / 0.05); // builds quickly
    lightStr = 0.42 + silenceDepth * 0.20; // 0.42 → 0.62 through silence
    lightR = -16; lightG = -10; lightB = 32;
  }

  // Silence: cold moonlit terrain wash — the entire world gets a blue-silver tint
  // as the last motes die and the moon rises over the empty land.
  const silenceColdStr = cycleProgress >= 0.92
    ? Math.min(1, (cycleProgress - 0.92) / 0.06) * 0.55
    : 0;

  // Sunrise band: warm pink-orange wash across the lower sky during dawn (exploration start)
  // Creates a visible transition from "dark night" to "open day"
  const sunriseStr =
    cycleProgress >= 0.06 && cycleProgress < 0.22
      ? Math.sin((cycleProgress - 0.06) / 0.16 * Math.PI) * 0.78
      : 0;

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

        // Horizon glow: phase-atmospheric band rising from the terrain surface.
        // Present every phase — colors shift from cold pre-dawn → warm noon → blazing dusk → moonlit silence.
        if (glowStrength > 0.01) {
          const dist = surfaceYCache[x] - y; // pixels above terrain surface
          if (dist >= 0 && dist < 22) {
            // Organic undulation: mist edge breathes and shifts
            const undulate = Math.sin(x * 0.14 + time * 0.38) * 0.12 + 0.88;
            const gf = (1 - dist / 22) * (1 - dist / 22) * glowStrength * undulate;
            r = Math.min(255, Math.max(0, r + hgR * gf));
            g = Math.min(255, Math.max(0, g + hgG * gf));
            b = Math.min(255, Math.max(0, b + hgB * gf));
          }
        }

        // Sunrise band: warm pink-orange wash across the lower sky at dawn
        if (sunriseStr > 0) {
          // Concentrate in the lower half of sky (y from H*0.1 to H*0.7)
          const skyFrac = y / H;
          if (skyFrac > 0.08 && skyFrac < 0.75) {
            // Bell-shaped, peaks near skyFrac=0.55 (just above horizon)
            const bandPeak = 0.55;
            const bandWidth = 0.35;
            const band = Math.max(0, 1 - Math.abs(skyFrac - bandPeak) / bandWidth);
            const sf = band * band * sunriseStr;
            r = Math.min(255, r + 120 * sf);
            g = Math.min(255, g + 55 * sf);
            b = Math.min(255, b + 35 * sf);  // slight warmth, not pure orange
          }
        }

        // Sunset gradient: blazing orange near horizon → deep purple at zenith
        if (sunsetStr > 0) {
          const skyFrac = y / H;  // 0 = zenith (top), 1 = horizon (bottom)
          if (skyFrac < 0.92) {
            // Orange/amber tide rising from horizon
            const horizonT = Math.max(0, (skyFrac - 0.08) / 0.68);
            const orangeStr = horizonT * horizonT * horizonT * sunsetStr;
            // Purple/violet crown at zenith
            const zenithT = Math.max(0, 1 - skyFrac / 0.32);
            const purpleStr = zenithT * zenithT * sunsetStr * 0.70;

            r = Math.min(255, r + Math.round(145 * orangeStr + 22 * purpleStr));
            g = Math.min(255, g + Math.round(48 * orangeStr));
            b = Math.max(0, Math.min(255, b + Math.round(-72 * orangeStr + 108 * purpleStr)));
          }
        }

        // Volcanic sky reddening — ash and smoke tint the sky warm amber-grey
        // during dissolution/silence, strongest near the horizon where ash settles
        if (biome === "volcanic") {
          const ashSkyStr = Math.max(0, Math.min(1, (cycleProgress - 0.68) / 0.32)) * 0.50;
          if (ashSkyStr > 0.01) {
            const altFade = Math.min(1, y / (H * 0.52)); // 0 at zenith, 1 near horizon
            const blend = ashSkyStr * altFade;
            r = r + (92 - r) * blend;
            g = g + (50 - g) * blend;
            b = b + (38 - b) * blend;
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
        // Water as sky mirror — phase-aware reflection with per-column ripple distortion.
        // Shallow water catches the most light; deep water reflects the dark depths.
        const ci = tileColor(tile, bp);
        const wc = PAL[ci];
        // Two-frequency ripple: organic, slightly phase-shifted per column
        const rip = Math.sin(x * 0.22 + time * 1.6 + y * 0.07) * 0.5 + 0.5;
        const ripStr = 0.88 + rip * 0.12;  // 0.88 → 1.00 modulation
        const baseRefl = tile === Tile.ShallowWater ? 0.58 : 0.30;
        const refl = baseRefl * reflPhase * ripStr;
        d[pi]     = Math.min(255, Math.round(wc[0] * (1 - refl) + skyReflR * refl));
        d[pi + 1] = Math.min(255, Math.round(wc[1] * (1 - refl) + skyReflG * refl));
        d[pi + 2] = Math.min(255, Math.round(wc[2] * (1 - refl) + skyReflB * refl));
        d[pi + 3] = 255;
        // Star reflections — twinkling specks in still water during genesis and silence
        if (nightReflStr > 0.05 && _STAR_COLS[x]) {
          const starRip = Math.sin(x * 0.55 + time * 2.2) * 0.45 + 0.55;
          const starA = Math.round(nightReflStr * 62 * starRip);
          if (starA > 5) {
            d[pi]     = Math.min(255, d[pi]     + starA);
            d[pi + 1] = Math.min(255, d[pi + 1] + starA);
            d[pi + 2] = Math.min(255, d[pi + 2] + Math.round(starA * 1.25));  // blue-white shimmer
          }
        }
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
            // Silence gets deeper moonlight penetration (8px vs 3px for golden hour)
            const lightDepth = inDusk ? 8 : 3;
            if (distSurf >= 0 && distSurf < lightDepth) {
              const fade = (1 - distSurf / lightDepth) * lightStr;
              d[pi]     = Math.min(255, Math.max(0, d[pi]     + Math.round(lightR * fade)));
              d[pi + 1] = Math.min(255, Math.max(0, d[pi + 1] + Math.round(lightG * fade)));
              d[pi + 2] = Math.min(255, Math.max(0, d[pi + 2] + Math.round(lightB * fade)));
            }
          }
          // Silence cold wash: blue-silver moonlight tints all terrain, not just surface
          if (silenceColdStr > 0) {
            // Partial desaturation toward cool grey-blue — the world empties of warmth
            const avg = (d[pi] + d[pi + 1] + d[pi + 2]) / 3;
            const cs = silenceColdStr;
            d[pi]     = Math.min(255, Math.max(0, Math.round(d[pi]     * (1 - cs * 0.28) + avg * cs * 0.14)));
            d[pi + 1] = Math.min(255, Math.max(0, Math.round(d[pi + 1] * (1 - cs * 0.20) + avg * cs * 0.10)));
            d[pi + 2] = Math.min(255, Math.round(d[pi + 2] + cs * 28));
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

/**
 * Water mist — soft wisps rising from water bodies at dawn and dusk.
 * Creates the sense that the world breathes: lakes exhale in the morning cold,
 * rivers steam at twilight. Per-biome mist color; volcanic uses ember drift instead.
 */
export function renderWaterMist(
  buf: ImageData,
  terrain: Terrain,
  time: number,
  cycleProgress: number,
): void {
  if (terrain.biome === "volcanic") return; // volcanic gets ember drift

  // Mist peaks at dawn (genesis) and dusk (dissolution → silence)
  const dawnStr = cycleProgress < 0.20 ? Math.sin(cycleProgress / 0.20 * Math.PI * 0.5) * 0.88 : 0;
  const duskStr = cycleProgress > 0.72 ? Math.min(1.0, (cycleProgress - 0.72) / 0.18) * 0.92 : 0;
  const mistStr = Math.max(dawnStr, duskStr, 0.10); // faint mid-day shimmer always present
  if (mistStr < 0.04) return;

  // Biome mist color: each world's water exhales its own character
  const [mr, mg, mb]: [number, number, number] =
    terrain.biome === "tundra"   ? [195, 212, 238] :  // icy blue-white
    terrain.biome === "lush"     ? [158, 198, 172] :  // humid green-white
    terrain.biome === "desert"   ? [208, 185, 148] :  // warm sandy haze
                                   [178, 192, 214];   // temperate cool grey

  for (let x = 0; x < W; x++) {
    const surfaceY = getSurfaceY(terrain, x);
    const worldH = H - surfaceY;

    // Only from water-level surfaces
    if (worldH > terrain.waterLevel + 4) continue;
    if (worldH < terrain.waterLevel - 10) continue;

    // Two-frequency noise shapes the mist column — each column breathes independently
    const n1 = noise2(x * 0.065 + time * 0.07, 88.3) * 0.5 + 0.5;
    const n2 = noise2(x * 0.110 - time * 0.04, 52.7) * 0.5 + 0.5;
    const mistColumn = n1 * 0.65 + n2 * 0.35;

    const maxRise = Math.floor(2 + mistColumn * 20 * mistStr);
    if (maxRise < 2) continue;

    for (let dy = 0; dy < maxRise; dy++) {
      const y = surfaceY - 1 - dy;
      if (y < 0) break;

      // Quadratic fade: dense near water, thins with height
      const hFade = Math.pow(1.0 - dy / maxRise, 2.4);
      // Horizontal tendril shimmer — organic mist texture
      const tendrilN = noise2(x * 0.20 + time * 0.26, dy * 0.30 + time * 0.15) * 0.5 + 0.5;

      const a = Math.round(hFade * tendrilN * mistStr * 54);
      if (a < 3) continue;
      setPixel(buf, x, y, mr, mg, mb, a);
    }
  }
}

/**
 * Volcanic ember drift — glowing sparks floating upward from lava surfaces.
 * Lava doesn't just shimmer; it breathes fire upward. Each ember cools as it rises:
 * yellow-hot near the lava, dimming to orange-red at altitude before winking out.
 */
export function renderVolcanicEmbers(
  buf: ImageData,
  terrain: Terrain,
  time: number,
  cycleProgress: number,
): void {
  if (terrain.biome !== "volcanic") return;

  // Embers peak during complexity and early dissolution — the volcano's height of activity
  const emberStr =
    cycleProgress > 0.55 && cycleProgress < 0.92
      ? Math.sin((cycleProgress - 0.55) / 0.37 * Math.PI) * 0.90
      : 0.28;

  for (let x = 2; x < W - 2; x++) {
    const surfaceY = getSurfaceY(terrain, x);
    const worldH = H - surfaceY;

    // Emit only from near-lava-level terrain
    if (worldH > terrain.waterLevel + 5) continue;
    if (worldH < terrain.waterLevel - 6) continue;

    // Sparse noise gate: not every lava column emits every frame
    const emitN = noise2(x * 0.30, time * 0.50 + 91.5) * 0.5 + 0.5;
    if (emitN < 0.48) continue;

    // How high has this ember risen? Animated with drift
    const riseN = noise2(x * 0.24 + time * 0.64, x * 0.11 - time * 0.40) * 0.5 + 0.5;
    const riseH = Math.floor(riseN * 16 * emberStr);
    if (riseH < 1) continue;

    const emberY = surfaceY - 1 - riseH;
    if (emberY < 0) continue;

    // Temperature: yellow-white at lava, cools to orange-red with height
    const heat = 1.0 - riseN * 0.55;
    const r = 255;
    const g = Math.round(55 + heat * 165);  // 55 (dim red-orange) → 220 (bright yellow)
    const b = Math.round(heat * 18);
    const a = Math.round(heat * emberStr * 140);
    if (a < 8) continue;

    setPixel(buf, x, emberY, r, g, b, a);

    // Secondary spark above for the brightest, hottest embers
    if (heat > 0.70 && emberY - 1 >= 0) {
      setPixel(buf, x, emberY - 1, 255, Math.round(g * 0.72), 0, Math.round(a * 0.30));
    }
  }
}

/**
 * Tundra ice crust — during genesis and silence in tundra, ice sheets form over
 * shallow water bodies. The ice is thickest at silence (the long cold), thinner
 * at genesis (forming as the cycle opens). Cracked texture from noise.
 */
export function applyTundraIce(
  buf: ImageData,
  terrain: Terrain,
  cycleProgress: number,
): void {
  if (terrain.biome !== "tundra") return;

  // Ice thickness: strongest at genesis start and silence peak
  const genesisIce = cycleProgress < 0.18 ? (1.0 - cycleProgress / 0.18) * 0.62 : 0;
  const silenceIce = cycleProgress > 0.90 ? Math.min(0.82, (cycleProgress - 0.90) / 0.08) : 0;
  const iceStr = Math.max(genesisIce, silenceIce);
  if (iceStr < 0.05) return;

  const d = buf.data;

  for (let x = 0; x < W; x++) {
    const surfaceY = getSurfaceY(terrain, x);
    const worldH = H - surfaceY;

    // Only shallow water at or near the waterline
    if (worldH > terrain.waterLevel + 2) continue;
    if (worldH < terrain.waterLevel - 4) continue;

    const tile = terrain.tiles[surfaceY * W + x] as Tile;
    if (tile !== Tile.ShallowWater && tile !== Tile.DeepWater) continue;

    // Crackle noise: irregular ice thickness / opacity
    const crackN = noise2(x * 0.22, surfaceY * 0.18 + terrain.seed * 0.5) * 0.5 + 0.5;
    const iceOpacity = iceStr * (0.38 + crackN * 0.62);
    const blendStr = iceOpacity * 0.68;

    // Ice color: bright blue-white fading to dim grey at cracks
    const iceR = Math.round(178 + crackN * 62);  // 178–240
    const iceG = Math.round(196 + crackN * 50);  // 196–246
    const iceB = Math.round(222 + crackN * 33);  // 222–255

    const pi = (surfaceY * W + x) * 4;
    d[pi]     = Math.min(255, Math.round(d[pi]     * (1 - blendStr) + iceR * blendStr));
    d[pi + 1] = Math.min(255, Math.round(d[pi + 1] * (1 - blendStr) + iceG * blendStr));
    d[pi + 2] = Math.min(255, Math.round(d[pi + 2] * (1 - blendStr) + iceB * blendStr));

    // Ice surface pixel one row above — the crystalline crust sits above the water
    if (surfaceY > 0) {
      const aboveTile = terrain.tiles[(surfaceY - 1) * W + x] as Tile;
      if (aboveTile === Tile.Air) {
        const surfA = Math.round(iceStr * crackN * 130);
        if (surfA > 5) setPixel(buf, x, surfaceY - 1, iceR, iceG, iceB, surfA);
      }
    }
  }
}

/**
 * Rain puddles — small shimmering water patches on flat ground during rain/storm.
 * Only on flat, dry-land surfaces above the water line.
 * Animated ripple shimmer from simulated raindrop impacts.
 * Call after applyWeatherDarkening so puddles share the darkened tone.
 */
export function renderRainPuddles(
  buf: ImageData,
  terrain: Terrain,
  weather: Weather,
  time: number,
): void {
  if (weather.type !== "rain" && weather.type !== "storm") return;
  if (terrain.biome === "volcanic") return; // lava doesn't puddle

  const { tiles, heights, waterLevel, seed } = terrain;

  for (let x = 1; x < W - 1; x++) {
    // Only flat terrain — adjacent columns within 1.5px of each other
    if (Math.abs(heights[x + 1] - heights[x]) > 1.5 || Math.abs(heights[x - 1] - heights[x]) > 1.5) continue;

    const surfY = getSurfaceY(terrain, x);
    const worldH = H - surfY;
    if (worldH <= waterLevel + 2) continue; // too close to water — already wet

    const tile = tiles[surfY * W + x] as Tile;
    if (tile !== Tile.Ground && tile !== Tile.Sand) continue;

    // Deterministic puddle placement — only some flat tiles get puddles
    const pNoise = noise2(x * 0.65, seed * 0.88 + 97);
    if (pNoise < 0.12) continue; // ~44% of flat tiles

    // Animated ripple: two overlapping wave frequencies
    const ripA = Math.sin(x * 0.42 + time * 3.8) * 0.5 + 0.5;
    const ripB = Math.sin(x * 0.71 - time * 4.5 + 1.6) * 0.5 + 0.5;
    const shimmer = ripA * 0.60 + ripB * 0.40;

    const a = Math.round(shimmer * weather.intensity * 60);
    if (a < 5) continue;

    // Blue-grey puddle surface
    setPixel(buf, x, surfY, 105, 130, 162, a);

    // Raindrop impact highlight: bright flash at wave peak
    if (shimmer > 0.80) {
      const ha = Math.round((shimmer - 0.80) / 0.20 * 110);
      if (surfY > 0) setPixel(buf, x, surfY - 1, 158, 185, 215, ha);
    }
  }
}
