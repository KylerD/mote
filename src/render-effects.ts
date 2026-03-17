// render-effects.ts — Visual effects: eclipse, aurora, meteor, impact, crater, vignette, phase flash, bloom.

import { W, H } from "./config";
import type { Mote, ActiveEvent, Biome } from "./types";
import { setPixel } from "./render";
import { getMeteorPosition } from "./events";

// ─── Screen-space bloom ────────────────────────────────────────────────────
// Pre-allocated buffers — never allocate during the frame loop.
const _BLOOM_N = W * H;
const _bloomExtR = new Uint8Array(_BLOOM_N);
const _bloomExtG = new Uint8Array(_BLOOM_N);
const _bloomExtB = new Uint8Array(_BLOOM_N);
const _bloomBufR = new Uint8Array(_BLOOM_N);
const _bloomBufG = new Uint8Array(_BLOOM_N);
const _bloomBufB = new Uint8Array(_BLOOM_N);
// Chromatic aberration: one row of (R, _, B, _) data — reused per frame
const _caRowBuf = new Uint8Array(W * 4);

/**
 * Screen-space bloom: threshold bright pixels, apply separable box blur,
 * additive-blend the glow back onto the frame.  Creates the "lens glow"
 * around mote eyes, bond sparks, death flashes, and celestial bodies.
 *
 * @param strength   0 = no bloom, 1 = full (0.3–0.7 recommended)
 * @param tintR/G/B  Per-channel glow tint multipliers (1.0 = neutral).
 *                   Use e.g. (1.4, 0.7, 0.5) for a volcanic red-orange glow.
 */
export function applyBloom(buf: ImageData, strength: number, tintR = 1.0, tintG = 1.0, tintB = 1.0): void {
  if (strength <= 0) return;
  const d = buf.data;
  const THRESHOLD = 140;
  const R = 4; // blur radius → 9-tap kernel each axis

  // Pass 1 — extract bright pixels (luma above threshold, scaled by excess)
  for (let i = 0; i < _BLOOM_N; i++) {
    const di = i << 2;
    // Fast integer luma: coefficients ≈ 0.299, 0.587, 0.114
    const lum = (d[di] * 77 + d[di + 1] * 150 + d[di + 2] * 29) >> 8;
    if (lum > THRESHOLD) {
      const excess = lum - THRESHOLD; // 0..115
      _bloomExtR[i] = (d[di]     * excess) >> 7;
      _bloomExtG[i] = (d[di + 1] * excess) >> 7;
      _bloomExtB[i] = (d[di + 2] * excess) >> 7;
    } else {
      _bloomExtR[i] = _bloomExtG[i] = _bloomExtB[i] = 0;
    }
  }

  // Pass 2 — horizontal box blur
  for (let y = 0; y < H; y++) {
    const row = y * W;
    for (let x = 0; x < W; x++) {
      let sr = 0, sg = 0, sb = 0, cnt = 0;
      const xMin = x - R < 0 ? 0 : x - R;
      const xMax = x + R >= W ? W - 1 : x + R;
      for (let xi = xMin; xi <= xMax; xi++) {
        const pi = row + xi;
        sr += _bloomExtR[pi];
        sg += _bloomExtG[pi];
        sb += _bloomExtB[pi];
        cnt++;
      }
      const pi = row + x;
      _bloomBufR[pi] = sr / cnt;
      _bloomBufG[pi] = sg / cnt;
      _bloomBufB[pi] = sb / cnt;
    }
  }

  // Pass 3 — vertical box blur + additive blend into main buffer
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) {
      let sr = 0, sg = 0, sb = 0, cnt = 0;
      const yMin = y - R < 0 ? 0 : y - R;
      const yMax = y + R >= H ? H - 1 : y + R;
      for (let yi = yMin; yi <= yMax; yi++) {
        const pi = yi * W + x;
        sr += _bloomBufR[pi];
        sg += _bloomBufG[pi];
        sb += _bloomBufB[pi];
        cnt++;
      }
      const di = (y * W + x) << 2;
      const blr = (sr / cnt * strength * tintR) | 0;
      const blg = (sg / cnt * strength * tintG) | 0;
      const blb = (sb / cnt * strength * tintB) | 0;
      d[di]     = d[di]     + blr > 255 ? 255 : d[di]     + blr;
      d[di + 1] = d[di + 1] + blg > 255 ? 255 : d[di + 1] + blg;
      d[di + 2] = d[di + 2] + blb > 255 ? 255 : d[di + 2] + blb;
    }
  }
}

// ─── Eclipse corona geometry ───────────────────────────────────────────────
// Used only during renderEclipse — kept here to avoid repeated allocation.
const CORONA_RAY_COUNT = 14;

/** Draw aurora light curtains in the sky */
export function renderAuroraCurtains(buf: ImageData, time: number, eventStart: number): void {
  const elapsed = time - eventStart;
  const fadeIn = Math.min(1, elapsed / 4);
  const fadeOut = elapsed > 55 ? Math.max(0, 1 - (elapsed - 55) / 10) : 1;
  const intensity = fadeIn * fadeOut;

  for (let x = 0; x < W; x++) {
    // Five overlapping curtain waves at different frequencies and speeds
    const c1 = Math.sin(x * 0.060 + time * 0.40) * 0.5 + 0.5;
    const c2 = Math.sin(x * 0.040 - time * 0.25 + 1.5) * 0.5 + 0.5;
    const c3 = Math.sin(x * 0.090 + time * 0.60 + 3.7) * 0.4 + 0.5;
    const c4 = Math.sin(x * 0.030 - time * 0.15 + 5.2) * 0.3 + 0.5;
    const c5 = Math.sin(x * 0.140 + time * 0.85 + 0.9) * 0.2 + 0.5;
    const curtainStr = c1 * 0.32 + c2 * 0.26 + c3 * 0.20 + c4 * 0.14 + c5 * 0.08;

    const maxY = Math.floor(H * 0.52);
    for (let y = 0; y < maxY; y++) {
      const yNorm = y / maxY;
      // Bell-curve falloff: dim at zenith and horizon, peak at ~25% down
      const yShape = Math.sin(yNorm * Math.PI * 1.0 + 0.15) * (1 - yNorm * 0.4);
      const alpha = Math.round(curtainStr * yShape * intensity * 100);
      if (alpha < 4) continue;

      // Color cycles through green → teal → blue → purple across x and time
      const colorT = (Math.sin(x * 0.033 + time * 0.11) + 1) / 2;
      let ar: number, ag: number, ab: number;
      if (colorT < 0.35) {
        // Green
        const t = colorT / 0.35;
        ar = Math.round(15 + t * 40);
        ag = Math.round(215 - t * 35);
        ab = Math.round(60 + t * 110);
      } else if (colorT < 0.65) {
        // Teal to blue
        const t = (colorT - 0.35) / 0.30;
        ar = Math.round(55 + t * 75);
        ag = Math.round(180 - t * 100);
        ab = Math.round(170 + t * 65);
      } else {
        // Blue to purple
        const t = (colorT - 0.65) / 0.35;
        ar = Math.round(130 + t * 90);
        ag = Math.round(80 - t * 45);
        ab = Math.round(235 - t * 15);
      }
      setPixel(buf, x, y, ar, ag, ab, alpha);
    }
  }
}

/** Render eclipse darkness, stars, glowing mote eyes, and solar corona */
export function renderEclipse(
  buf: ImageData,
  event: ActiveEvent,
  time: number,
  motes: Mote[],
  moteColors: Map<Mote, [number, number, number]>,
  cycleNumber: number,
  celestialX = W * 0.62,
  celestialY = H * 0.22,
): void {
  const eclipseElapsed = time - event.startTime;
  const eclipseProgress = eclipseElapsed / event.duration;
  const darkness = eclipseProgress < 0.15
    ? eclipseProgress / 0.15
    : eclipseProgress > 0.85
      ? (1 - eclipseProgress) / 0.15
      : 1.0;
  const dimFactor = 0.12 + (1 - darkness) * 0.88;
  const d = buf.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = d[i] * dimFactor;
    d[i + 1] = d[i + 1] * dimFactor;
    d[i + 2] = Math.min(255, d[i + 2] * dimFactor * 1.3);
  }

  // Stars emerge
  if (darkness > 0.3) {
    const starAlpha = Math.round((darkness - 0.3) / 0.7 * 200);
    const starSeed = cycleNumber * 31337;
    for (let i = 0; i < 40; i++) {
      const sx = Math.abs((starSeed + i * 7919) % W);
      const sy = Math.abs((starSeed + i * 4793) % Math.floor(H * 0.5));
      const brightness = (starSeed + i * 2287) % 3;
      const twinkle = Math.sin(time * (2 + i * 0.3) + i) * 0.3 + 0.7;
      const sa = Math.round(starAlpha * twinkle);
      if (brightness === 0) {
        setPixel(buf, sx, sy, 220, 230, 255, sa);
        setPixel(buf, sx - 1, sy, 180, 190, 220, Math.round(sa * 0.4));
        setPixel(buf, sx + 1, sy, 180, 190, 220, Math.round(sa * 0.4));
        setPixel(buf, sx, sy - 1, 180, 190, 220, Math.round(sa * 0.4));
        setPixel(buf, sx, sy + 1, 180, 190, 220, Math.round(sa * 0.4));
      } else {
        setPixel(buf, sx, sy, 200, 210, 240, Math.round(sa * 0.6));
      }
    }
  }

  // Mote eyes glow in darkness
  if (darkness > 0.2) {
    const glowIntensity = (darkness - 0.2) / 0.8;
    for (const m of motes) {
      const ga = Math.round(glowIntensity * 255 * m.energy);
      const dir = m.direction;
      if (dir > 0) {
        setPixel(buf, m.x, m.y - 1, 255, 255, 240, ga);
        setPixel(buf, m.x + 1, m.y - 1, 255, 255, 240, ga);
      } else {
        setPixel(buf, m.x - 1, m.y - 1, 255, 255, 240, ga);
        setPixel(buf, m.x, m.y - 1, 255, 255, 240, ga);
      }
      const ha = Math.round(ga * 0.15);
      const [mcr, mcg, mcb] = moteColors.get(m)!;
      setPixel(buf, m.x, m.y, mcr, mcg, mcb, ha);
    }
  }

  // Solar corona — appears as darkness deepens, reveals the sun's crown
  if (darkness > 0.45) {
    const coronaIntensity = Math.min(1, (darkness - 0.45) / 0.55);
    const scx = Math.round(celestialX);
    const scy = Math.round(celestialY);
    const moonR = 7;

    // ── Corona halo: exponential falloff glow ring just outside moon disc ──
    const haloOuter = moonR + 20;
    for (let dy = -haloOuter; dy <= haloOuter; dy++) {
      for (let dx = -haloOuter; dx <= haloOuter; dx++) {
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < moonR + 1 || dist > haloOuter) continue;
        const t = (dist - moonR - 1) / (haloOuter - moonR - 1);
        // Angular texture: corona is brighter along equatorial axis
        const angle = Math.atan2(dy, dx);
        const angTex = Math.sin(angle * 3 + time * 0.08) * 0.15 + 0.85;
        const ga = Math.round(coronaIntensity * Math.exp(-t * 3.2) * 72 * angTex);
        if (ga < 2) continue;
        setPixel(buf, scx + dx, scy + dy, 255, 243, 205, ga);
      }
    }

    // ── Corona rays: bright streaks radiating outward ──
    const raySeed = cycleNumber * 4397;
    for (let ri = 0; ri < CORONA_RAY_COUNT; ri++) {
      // Deterministic base angle with small per-cycle variation
      const baseAngle = (ri / CORONA_RAY_COUNT) * Math.PI * 2;
      const angleJitter = ((raySeed + ri * 2311) % 100 - 50) * 0.008;
      // Slow waving animation (same for all viewers at same UTC time)
      const angle = baseAngle + angleJitter + Math.sin(time * 0.12 + ri * 0.94) * 0.055;

      // Ray length varies per ray (deterministic + slow breathe)
      const lenBase = 10 + ((raySeed + ri * 1733) % 14);    // 10-24px
      const lenPulse = Math.sin(time * 0.28 + ri * 1.41) * 4;
      const rayLen = Math.round(lenBase + lenPulse);

      const cosA = Math.cos(angle);
      const sinA = Math.sin(angle);
      const perpX = -sinA;
      const perpY = cosA;

      for (let step = moonR + 1; step <= moonR + rayLen; step++) {
        const rx = scx + cosA * step;
        const ry = scy + sinA * step;
        const t = (step - moonR - 1) / rayLen;
        const ga = Math.round(coronaIntensity * (1 - t) * (1 - t) * 175);
        if (ga < 3) continue;
        setPixel(buf, rx, ry, 255, 249, 218, ga);
        // Rays are slightly wider near their base for a feathered look
        if (step < moonR + 7) {
          setPixel(buf, rx + perpX, ry + perpY, 255, 240, 195, Math.round(ga * 0.38));
          setPixel(buf, rx - perpX, ry - perpY, 255, 240, 195, Math.round(ga * 0.38));
        }
      }
    }

    // ── Moon disc: dark mass at the celestial position, eclipsing the sun ──
    // Rendered last so it cleanly covers any corona pixels that bled inward.
    const d = buf.data;
    for (let dy = -moonR; dy <= moonR; dy++) {
      for (let dx = -moonR; dx <= moonR; dx++) {
        if (dx * dx + dy * dy > moonR * moonR) continue;
        const px = scx + dx;
        const py = scy + dy;
        if (px < 0 || px >= W || py < 0 || py >= H) continue;
        // Limb darkening: center of moon disc is deepest; edge has faint inner corona bleed
        const edgeFrac = Math.sqrt(dx * dx + dy * dy) / moonR;
        const dimTo = Math.round(edgeFrac * edgeFrac * 12 * coronaIntensity);
        const idx = (py * W + px) * 4;
        d[idx]   = Math.min(dimTo, d[idx]);
        d[idx+1] = Math.min(dimTo, d[idx+1]);
        d[idx+2] = Math.min(Math.round(dimTo * 1.4), d[idx+2]);
      }
    }
  }
}

/** Aurora luminous boost — brightens the scene */
export function applyAuroraBoost(buf: ImageData): void {
  const d = buf.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = Math.min(255, d[i] * 1.08);
    d[i + 1] = Math.min(255, d[i + 1] * 1.12);
    d[i + 2] = Math.min(255, d[i + 2] * 1.18);
  }
}

/** Meteor visual state — tracks impact flash between frames */
export interface MeteorState {
  wasVisible: boolean;
  impactFlash: number;
  impactX: number;
  impactY: number;
}

export function createMeteorState(): MeteorState {
  return { wasVisible: false, impactFlash: 0, impactX: 0, impactY: 0 };
}

/** Render meteor fireball + trail, and manage impact flash state */
export function renderMeteorVisual(
  buf: ImageData,
  ms: MeteorState,
  event: ActiveEvent | null,
  time: number,
  cycleNumber: number,
  dt: number,
): void {
  const meteorPos = getMeteorPosition(event, time, cycleNumber);
  if (meteorPos) {
    const mx = Math.round(meteorPos.x);
    const my = Math.round(meteorPos.y);
    // Bright 3x3 head
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const dist = Math.abs(dx) + Math.abs(dy);
        if (dist === 0) {
          setPixel(buf, mx, my, 255, 255, 220, 255);
        } else {
          setPixel(buf, mx + dx, my + dy, 255, 200, 100, 220);
        }
      }
    }
    // Fiery trail
    for (let i = 1; i <= 15; i++) {
      const ta = Math.round(220 * (1 - i / 15));
      const tr = Math.round(255 - i * 6);
      const tg = Math.round(180 - i * 10);
      const tb = Math.max(0, Math.round(80 - i * 4));
      setPixel(buf, mx + i, my - i, tr, tg, tb, ta);
      if (i < 10) {
        setPixel(buf, mx + i, my - i + 1, tr, tg, tb, Math.round(ta * 0.5));
        setPixel(buf, mx + i + 1, my - i, tr, tg, tb, Math.round(ta * 0.5));
      }
      if (i % 3 === 0 && i < 12) {
        const sparkY = my - i + (i % 2 === 0 ? 2 : -1);
        setPixel(buf, mx + i + 1, sparkY, 255, 220, 100, Math.round(ta * 0.7));
      }
    }
    ms.wasVisible = true;
    ms.impactX = mx;
    ms.impactY = my;
  } else if (ms.wasVisible) {
    ms.wasVisible = false;
    ms.impactFlash = 1.0;
  }

  // Impact flash
  if (ms.impactFlash > 0) {
    const flashRadius = Math.round((1 - ms.impactFlash) * 24 + 4);
    for (let dy = -flashRadius; dy <= flashRadius; dy++) {
      for (let dx = -flashRadius; dx <= flashRadius; dx++) {
        const d2 = dx * dx + dy * dy;
        if (d2 <= flashRadius * flashRadius) {
          const falloff = 1 - Math.sqrt(d2) / flashRadius;
          const fa = Math.round(ms.impactFlash * 250 * falloff);
          const heat = falloff;
          setPixel(buf, ms.impactX + dx, ms.impactY + dy,
            Math.round(255 * heat + 180 * (1 - heat)),
            Math.round(240 * heat + 100 * (1 - heat)),
            Math.round(200 * heat + 40 * (1 - heat)),
            fa);
        }
      }
    }
    ms.impactFlash = Math.max(0, ms.impactFlash - dt * 2.0);
  }
}

/**
 * Per-phase color grade with biome correction — perceptible warm/cool tint applied
 * to the final composed frame.  Two layers:
 *
 * 1. Phase grade   — blends in over first 25% of each phase; drives the emotional arc
 *                    (violet genesis → amber complexity → cold-blue silence)
 * 2. Biome overlay — always-on correction giving each world a characteristic color
 *                    temperature (volcanic reds, tundra ice-blues, desert ambers, etc.)
 *
 * Both layers are strictly additive so they never crush blacks or blow out highlights.
 */
export function applyPhaseColorGrade(
  buf: ImageData,
  phaseIndex: number,
  phaseProgress: number,
  biome = "",
): void {
  // Phase grades: ~2× stronger than the original — now perceptible at a glance.
  // Each phase has a distinct emotional color temperature.
  const GRADES: [number, number, number][] = [
    [  0,   0,  14],  // 0 genesis:      deep violet — the world igniting from cold
    [  6,   2,  -4],  // 1 exploration:  warm amber push — life spreading outward
    [  0,   0,   0],  // 2 organization: neutral (skip — the world is steady)
    [  9,   4,  -6],  // 3 complexity:   vivid warm peak — community at its hottest
    [ 14,  -2, -10],  // 4 dissolution:  hot amber-red — the world burning out
    [ -6,  -4,  12],  // 5 silence:      cold winter blue — absence made visible
  ];

  // Per-biome additive overlay — gives each world a characteristic color cast.
  // Applied at full strength always (not phase-gated) — the biome never stops being itself.
  // Values are moderate so they enhance rather than override terrain/mote colors.
  const BIOME_GRADE: Record<string, [number, number, number]> = {
    volcanic:  [  8,  -2,  -5],  // hot red-orange cast
    tundra:    [ -4,   1,  10],  // cold ice-blue
    desert:    [  6,   3,  -6],  // dry amber warmth
    lush:      [ -2,   6,  -3],  // green vitality
    temperate: [  0,   0,   0],  // neutral
  };

  const pi = Math.min(5, Math.max(0, phaseIndex));
  const [pr, pg, pb] = GRADES[pi];
  const [br, bg, bb] = BIOME_GRADE[biome] ?? [0, 0, 0];

  // Phase grade fades in over first 25% of the phase; biome correction is constant.
  const phaseBlend = Math.min(1, phaseProgress / 0.25);
  const totalR = Math.round(pr * phaseBlend) + br;
  const totalG = Math.round(pg * phaseBlend) + bg;
  const totalB = Math.round(pb * phaseBlend) + bb;
  if (totalR === 0 && totalG === 0 && totalB === 0) return;

  const d = buf.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i]     = Math.min(255, Math.max(0, d[i]     + totalR));
    d[i + 1] = Math.min(255, Math.max(0, d[i + 1] + totalG));
    d[i + 2] = Math.min(255, Math.max(0, d[i + 2] + totalB));
  }
}

/** Meteor crater afterglow */
export function renderCraterGlow(
  buf: ImageData,
  event: ActiveEvent,
  time: number,
): void {
  if (event.data.craterX === undefined) return;
  const craterElapsed = time - event.startTime;
  const glowLife = Math.max(0, 1 - (craterElapsed - 2) / 10);
  if (glowLife <= 0) return;

  const cx = event.data.craterX;
  const cy = event.data.craterY;
  const glowR = 8;
  for (let dy = -glowR; dy <= glowR; dy++) {
    for (let dx = -glowR; dx <= glowR; dx++) {
      const d2 = dx * dx + dy * dy;
      if (d2 <= glowR * glowR) {
        const falloff = 1 - Math.sqrt(d2) / glowR;
        const ga = Math.round(glowLife * 30 * falloff);
        if (ga > 0) setPixel(buf, cx + dx, cy + dy, 255, 120, 40, ga);
      }
    }
  }
}

/** Phase transition pulse — colored shockwave ring expanding from canvas center.
 *
 * When a phase changes, phaseFlash is set to 1.0 and decays at ~1.0/s.
 * We emit:
 *   1. A subtle uniform screen brightening (reduced from the old approach, used for tint)
 *   2. A bright expanding ring that travels from center to beyond the canvas edges
 *
 * The ring is most vivid at the leading edge and has a soft trailing glow, creating
 * the impression of a wave of energy rolling through the world.
 */
export function renderPhaseFlash(buf: ImageData, phaseFlash: number, phaseIndex: number): void {
  if (phaseFlash <= 0) return;

  // Per-phase RGB tint [r, g, b] — drives both the subtle screen tint and ring color
  const PHASE_FLASHES: [number, number, number][] = [
    [ 60,  50, 255],  // 0 genesis:      violet
    [255, 200,  50],  // 1 exploration:  gold
    [220, 220, 220],  // 2 organization: cool white
    [255, 190,  60],  // 3 complexity:   warm amber
    [255,  90,  20],  // 4 dissolution:  red-orange
    [ 60, 100, 255],  // 5 silence:      cold blue
  ];
  const [tr, tg, tb] = PHASE_FLASHES[Math.min(5, Math.max(0, phaseIndex))];

  // 1 — Subtle uniform screen tint (much reduced from before; ring carries the drama)
  const f = phaseFlash * 0.35;
  const d = buf.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i]     = Math.min(255, Math.max(0, Math.round(d[i]     + (d[i]     * 0.04 + tr * 0.04) * f)));
    d[i + 1] = Math.min(255, Math.max(0, Math.round(d[i + 1] + (d[i + 1] * 0.04 + tg * 0.04) * f)));
    d[i + 2] = Math.min(255, Math.max(0, Math.round(d[i + 2] + (d[i + 2] * 0.04 + tb * 0.04) * f)));
  }

  // 2 — Expanding shockwave ring
  // phaseFlash: 1.0 (just transitioned) → 0 (done). Ring progress inverts this.
  const ringT = 1 - phaseFlash;                         // 0 = center, 1 = fully expanded
  // Max radius: just beyond corner-to-center distance so ring exits the screen
  const maxR = Math.sqrt((W * 0.5) * (W * 0.5) + (H * 0.5) * (H * 0.5)) + 8;
  const ringR = ringT * maxR;

  // Ring is only visible while expanding across the screen
  if (ringR < maxR && phaseFlash > 0.02) {
    const cx = W * 0.5;
    const cy = H * 0.5;
    // Leading edge is bright (ringR), trailing soft glow extends inward ~12px
    const trailWidth = 12;

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const dist = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy));
        const delta = dist - ringR;            // + = outside (ahead of ring), − = inside (behind)
        if (delta > 2 || delta < -trailWidth) continue;

        let ringFalloff: number;
        if (delta >= -2 && delta <= 2) {
          // Leading edge: bright band
          ringFalloff = 1 - Math.abs(delta) / 2;
        } else {
          // Trailing glow: fade from edge inward
          ringFalloff = Math.max(0, 1 - (-delta - 2) / (trailWidth - 2));
          ringFalloff *= ringFalloff;  // quadratic fade for soft trailing look
        }

        const ra = Math.round(phaseFlash * ringFalloff * 160);
        if (ra < 4) continue;
        setPixel(buf, x, y, tr, tg, tb, ra);
      }
    }
  }
}

/**
 * Phase-specific atmospheric particle field.
 *
 * Genesis:     ascending stardust — bright gold-white sparks drifting upward
 * Dissolution: falling ash       — warm grey particles accumulating as the cycle dies
 * Silence:     drifting dust     — barely-visible specks, the world holding its breath
 *
 * All particles are deterministic: same cycleNumber → same positions/motion.
 * Movement is driven purely by time, so they animate continuously.
 */
export function renderAtmosphericParticles(
  buf: ImageData,
  phaseIndex: number,
  phaseProgress: number,
  time: number,
  cycleNumber: number,
): void {
  if (phaseIndex === 0) {
    // Genesis: ascending stardust — birth sparks rising from the ground into the sky.
    // Fades in fast (world ignites), fades out by ~70% (stardust settles as life begins).
    const fadeIn  = Math.min(1, phaseProgress * 10);
    const fadeOut = phaseProgress > 0.65 ? Math.max(0, 1 - (phaseProgress - 0.65) / 0.35) : 1;
    const intensity = fadeIn * fadeOut;
    if (intensity < 0.02) return;

    const COUNT = 44;   // more particles — the world kindling
    const seed  = cycleNumber * 7919;
    for (let i = 0; i < COUNT; i++) {
      const h1 = Math.abs(seed + i * 6271) % (W * 100);
      const h2 = Math.abs(seed + i * 4397) % (H * 100);
      const h3 = Math.abs(seed + i * 2311) % 100;
      const h4 = Math.abs(seed + i * 1129) % 200;
      const h5 = Math.abs(seed + i *  997) % 100;
      const h6 = Math.abs(seed + i * 1481) % 100;  // color variance

      // Particles spawn in lower 60% of screen — rising up from the ground
      const baseX     = h1 % W;
      const baseY     = Math.floor(H * 0.4) + (h2 % Math.floor(H * 0.6));
      const riseSpeed = 2.5 + h3 / 25;           // 2.5–6.5 px/s upward (faster than before)
      const drift     = (h4 - 100) / 200;        // gentle horizontal wander
      const twinkle   = Math.sin(time * (1.8 + h5 / 40) + i * 2.1) * 0.3 + 0.7;

      const x = ((baseX + drift * time + W * 10) % W + W) % W | 0;
      const y = ((baseY - riseSpeed * time)       % H + H * 50) % H | 0;

      const a = Math.round(intensity * twinkle * 210);  // brighter peak
      if (a < 4) continue;

      // Warm gold–white range, with subtle color variance
      const cr = 240 + Math.floor(h6 / 17);
      const cg = 225 + Math.floor((h6 % 20) / 2);
      const cb = 160 + Math.floor(h6 / 5);

      setPixel(buf, x, y, cr, cg, cb, a);

      // 1-in-3 particles get a full cross halo (more magical density)
      if (h3 % 3 === 0) {
        const ha = Math.round(a * 0.45);
        setPixel(buf, x - 1, y, cr, cg, cb, ha);
        setPixel(buf, x + 1, y, cr, cg, cb, ha);
        setPixel(buf, x, y - 1, cr, cg, cb, ha);
        setPixel(buf, x, y + 1, cr, cg, cb, Math.round(ha * 0.6));
      }
      // 1-in-7 get a faint outer halo (the biggest sparks)
      if (h3 % 7 === 0) {
        const ha2 = Math.round(a * 0.18);
        setPixel(buf, x - 2, y, cr, cg, cb, ha2);
        setPixel(buf, x + 2, y, cr, cg, cb, ha2);
        setPixel(buf, x, y - 2, cr, cg, cb, ha2);
      }
    }

  } else if (phaseIndex === 4) {
    // Dissolution: falling ash — density builds with phaseProgress
    const intensity      = Math.min(1, phaseProgress * 1.6);
    const particleCount  = Math.floor(18 + phaseProgress * 44);
    const seed           = cycleNumber * 5381;

    for (let i = 0; i < particleCount; i++) {
      const h1 = Math.abs(seed + i * 4691) % (W * 100);
      const h2 = Math.abs(seed + i * 3779) % (H * 100);
      const h3 = Math.abs(seed + i * 1733) % 100;
      const h4 = Math.abs(seed + i * 2719) % 200;

      const baseX     = h1 % W;
      const baseY     = h2 % H;
      const fallSpeed = 1.5 + h3 / 37;             // 1.5–4.2 px/s downward
      const sway      = (h4 - 100) / 450;          // gentle horizontal meander

      const x = ((baseX + sway * time + Math.sin(time * 0.45 + i * 0.9) * 1.4 + W * 10) % W + W) % W | 0;
      const y = (baseY + fallSpeed * time) % H | 0;

      // Warm grey ash — each particle slightly different shade
      const grey = 138 + h3 % 22;
      const a    = Math.round(intensity * (52 + Math.sin(time * 0.55 + i * 1.3) * 18));
      if (a < 4) continue;

      setPixel(buf, x, y, grey + 18, grey + 5, grey - 12, Math.min(255, Math.max(0, a)));
    }

  } else if (phaseIndex === 5) {
    // Silence: barely-visible drifting dust motes
    const COUNT = 12;
    const seed  = cycleNumber * 3371;

    for (let i = 0; i < COUNT; i++) {
      const h1 = Math.abs(seed + i * 5003) % (W * 100);
      const h2 = Math.abs(seed + i * 2897) % (H * 100);
      const h3 = Math.abs(seed + i * 1021) % 40;
      const h4 = Math.abs(seed + i * 1847) % 40;

      const baseX  = h1 % W;
      const baseY  = h2 % H;
      const ySpeed = (h3 - 20) / 55;              // –0.36..+0.36 px/s mixed up/down
      const xSpeed = (h4 - 20) / 100;             // very slow horizontal drift

      const x = ((baseX + xSpeed * time + W * 10) % W + W) % W | 0;
      const y = ((baseY + ySpeed * time + H * 50) % H + H) % H | 0;

      const twinkle = (Math.sin(time * 0.55 + i * 1.8) * 0.4 + 0.6);
      const a = Math.round(twinkle * 40);
      if (a < 5) continue;

      setPixel(buf, x, y, 138, 143, 158, a);
    }
  }
}

/**
 * Biome ambient life — organic background particles that make each world feel inhabited.
 * Active during exploration (1), organization (2), complexity (3), peaking at complexity.
 *
 * lush:       fireflies blinking in the undergrowth
 * volcanic:   ember sparks rising from the hot ground
 * temperate:  pollen seeds drifting on the breeze
 * tundra:     ice crystal glints catching the light
 * desert:     heat dust spiraling in warm thermals
 *
 * Rendered before bloom so the particles glow softly.
 */
export function renderBiomeAmbientLife(
  buf: ImageData,
  biome: string,
  phaseIndex: number,
  phaseProgress: number,
  time: number,
  cycleNumber: number,
): void {
  if (phaseIndex < 1 || phaseIndex > 3) return;

  // Intensity ramps across phases and within each phase
  const PHASE_STR = [0, 0.35, 0.70, 1.0, 0, 0];
  const phaseStr = PHASE_STR[phaseIndex];
  const ramp = Math.min(1, phaseProgress / 0.18);
  const intensity = phaseStr * ramp;
  if (intensity < 0.03) return;

  if (biome === "lush")       renderFireflies(buf, intensity, time, cycleNumber);
  else if (biome === "volcanic") renderVolcanicAtmosphere(buf, intensity, time, cycleNumber);
  else if (biome === "temperate") renderPollenDrift(buf, intensity, time, cycleNumber);
  else if (biome === "tundra")  renderTundraSparkles(buf, intensity, time, cycleNumber);
  else if (biome === "desert")  renderDesertDust(buf, intensity, time, cycleNumber);
}

// ─── Biome life helpers ─────────────────────────────────────────────────────

/** Lush: fireflies — tiny warm-green lights that blink independently */
function renderFireflies(buf: ImageData, intensity: number, time: number, cycleNumber: number): void {
  const COUNT = Math.round(10 + intensity * 18); // 10–28 fireflies at peak
  const seed = cycleNumber * 6271;

  for (let i = 0; i < COUNT; i++) {
    const h1 = Math.abs(seed + i * 4397) % (W * 100);
    const h2 = Math.abs(seed + i * 2311) % (H * 100);
    const h3 = Math.abs(seed + i * 1481) % 100;
    const h4 = Math.abs(seed + i * 1129) % 200;
    const h5 = Math.abs(seed + i *  997) % 100;

    const baseX = h1 % W;
    const baseY = Math.floor(H * 0.35) + (h2 % Math.floor(H * 0.55)); // lower portion
    const driftX = (h4 - 100) / 280;
    const driftY = (h3 - 50) / 220;
    const blinkRate = 1.1 + h5 / 28; // each firefly has its own blink speed
    const blinkPhase = i * 2.73;

    const x = ((baseX + driftX * time + W * 10) % W + W) % W | 0;
    const y = ((baseY + driftY * time + H * 50) % H + H) % H | 0;

    // Sharp blink: squared sine gives quick on, slow fade
    const sinVal = Math.sin(time * blinkRate + blinkPhase);
    const blink = Math.max(0, sinVal) * Math.max(0, sinVal);
    const a = Math.round(intensity * blink * 195);
    if (a < 5) continue;

    // Warm yellow-green core
    setPixel(buf, x, y, 210, 255, 100, a);
    // Soft colored halo
    const ha = Math.round(a * 0.42);
    if (ha > 3) {
      setPixel(buf, x - 1, y,     175, 240,  70, ha);
      setPixel(buf, x + 1, y,     175, 240,  70, ha);
      setPixel(buf, x,     y - 1, 190, 248,  85, ha);
      setPixel(buf, x,     y + 1, 160, 225,  55, Math.round(ha * 0.7));
    }
  }
}

/** Volcanic: ember sparks drifting upward from the heated ground */
function renderVolcanicAtmosphere(buf: ImageData, intensity: number, time: number, cycleNumber: number): void {
  const COUNT = Math.round(14 + intensity * 22); // 14–36 sparks
  const seed = cycleNumber * 5381;

  for (let i = 0; i < COUNT; i++) {
    const h1 = Math.abs(seed + i * 6271) % (W * 100);
    const h2 = Math.abs(seed + i * 3779) % (H * 100);
    const h3 = Math.abs(seed + i * 1733) % 100;
    const h4 = Math.abs(seed + i * 2719) % 200;

    const baseX = h1 % W;
    const baseY = Math.floor(H * 0.45) + (h2 % Math.floor(H * 0.55)); // bottom half
    const riseSpeed = 1.6 + h3 / 30; // 1.6–4.9 px/s upward
    const drift = (h4 - 100) / 380;

    const x = ((baseX + drift * time + Math.sin(time * 0.9 + i * 0.6) * 1.8 + W * 10) % W + W) % W | 0;
    const y = ((baseY - riseSpeed * time + H * 50) % H + H) % H | 0;

    const twinkle = Math.sin(time * 2.8 + i * 1.1) * 0.22 + 0.78;
    const a = Math.round(intensity * twinkle * (32 + h3 % 20));
    if (a < 3) continue;

    // Orange / red / yellow ember tones
    const heat = h3 % 3;
    if (heat === 0) setPixel(buf, x, y, 255,  95, 25, Math.min(255, a)); // hot orange
    else if (heat === 1) setPixel(buf, x, y, 255, 175, 45, Math.min(255, a)); // yellow
    else                 setPixel(buf, x, y, 255,  45, 10, Math.min(255, a)); // deep red
  }
}

/** Temperate: pollen seeds on the breeze */
function renderPollenDrift(buf: ImageData, intensity: number, time: number, cycleNumber: number): void {
  const COUNT = Math.round(12 + intensity * 20); // 12–32 pollen specks
  const seed = cycleNumber * 4397;

  for (let i = 0; i < COUNT; i++) {
    const h1 = Math.abs(seed + i * 5003) % (W * 100);
    const h2 = Math.abs(seed + i * 2897) % (H * 100);
    const h3 = Math.abs(seed + i * 1021) % 100;
    const h4 = Math.abs(seed + i * 1847) % 200;

    const baseX = h1 % W;
    const baseY = h2 % H;
    const riseSpeed = 0.7 + h3 / 62; // very slow rise
    const drift = (h4 - 100) / 230;

    const x = ((baseX + drift * time + Math.sin(time * 0.38 + i * 1.2) * 2.2 + W * 10) % W + W) % W | 0;
    const y = ((baseY - riseSpeed * time + H * 50) % H + H) % H | 0;

    const twinkle = Math.sin(time * 1.1 + i * 2.3) * 0.28 + 0.72;
    const a = Math.round(intensity * twinkle * (22 + h3 % 14));
    if (a < 3) continue;

    setPixel(buf, x, y, 245, 238, 175, Math.min(255, a)); // soft pale-yellow
  }
}

/** Tundra: ice crystals catching and releasing light */
function renderTundraSparkles(buf: ImageData, intensity: number, time: number, cycleNumber: number): void {
  const COUNT = Math.round(8 + intensity * 16); // 8–24 crystal glints
  const seed = cycleNumber * 7919;

  for (let i = 0; i < COUNT; i++) {
    const h1 = Math.abs(seed + i * 4691) % (W * 100);
    const h2 = Math.abs(seed + i * 3337) % (H * 100);
    const h3 = Math.abs(seed + i * 1597) % 100;
    const h4 = Math.abs(seed + i * 2803) % 200;

    const baseX = h1 % W;
    const baseY = h2 % H;
    const fallSpeed = 0.55 + h3 / 48;
    const drift = (h4 - 100) / 330;

    const x = ((baseX + drift * time + W * 10) % W + W) % W | 0;
    const y = ((baseY + fallSpeed * time) % H) | 0;

    // Sharp sparkle: high-powered sine — almost always off, briefly brilliant
    const raw = Math.sin(time * (2.2 + h3 / 22) + i * 3.7);
    const sparkle = Math.pow(Math.max(0, raw), 3);
    const a = Math.round(intensity * sparkle * 210);
    if (a < 6) continue;

    setPixel(buf, x, y, 195, 225, 255, a); // ice-blue white
    if (sparkle > 0.5) {
      const ha = Math.round(a * 0.48);
      setPixel(buf, x - 1, y,     175, 210, 255, ha);
      setPixel(buf, x + 1, y,     175, 210, 255, ha);
      setPixel(buf, x,     y - 1, 210, 235, 255, ha);
    }
  }
}

/** Desert: heat dust spiraling in warm thermals */
function renderDesertDust(buf: ImageData, intensity: number, time: number, cycleNumber: number): void {
  const COUNT = Math.round(10 + intensity * 16); // 10–26 dust motes
  const seed = cycleNumber * 3371;

  for (let i = 0; i < COUNT; i++) {
    const h1 = Math.abs(seed + i * 5003) % (W * 100);
    const h2 = Math.abs(seed + i * 2287) % (H * 100);
    const h3 = Math.abs(seed + i * 1361) % 100;
    const h4 = Math.abs(seed + i * 2017) % 200;

    const baseX = h1 % W;
    const baseY = Math.floor(H * 0.35) + (h2 % Math.floor(H * 0.55));
    const riseSpeed = 0.5 + h3 / 85;
    const sway = (h4 - 100) / 175;

    const x = ((baseX + sway * time + Math.sin(time * 0.55 + i * 0.8) * 3.0 + W * 10) % W + W) % W | 0;
    const y = ((baseY - riseSpeed * time + H * 50) % H + H) % H | 0;

    const shimmer = Math.sin(time * 0.85 + i * 1.6) * 0.28 + 0.72;
    const a = Math.round(intensity * shimmer * (18 + h3 % 13));
    if (a < 3) continue;

    setPixel(buf, x, y, 215, 190, 128, Math.min(255, a)); // warm sandy beige
  }
}

/** Vignette — darken edges with phase-colored tint. Each phase has a distinct atmospheric hue.
 *
 * @param prevPhaseIndex  Phase we transitioned FROM (for cross-fade; pass same as phaseIndex when stable)
 * @param transitionBlend 0 = fully on new phase tint, 1 = fully on prev phase tint (use phaseFlash value)
 * @param moteCount       Current live mote count — deepens silence vignette when near-empty
 */
export function applyVignette(
  buf: ImageData,
  phaseIndex: number,
  phaseProgress: number,
  moteCount = 0,
  prevPhaseIndex = -1,
  transitionBlend = 0,
): void {
  // Minimum brightness at extreme corners per phase (lower = darker edges)
  // silence is most dramatic; exploration is most open
  const VIGNETTE_FLOORS = [0.57, 0.62, 0.56, 0.55, 0.46, 0.32];
  let floor = VIGNETTE_FLOORS[Math.min(5, Math.max(0, phaseIndex))];

  // Mote-count-aware: during silence, deepen the vignette as the world empties
  if (phaseIndex === 5 && moteCount <= 2) {
    const deepen = moteCount === 0 ? 0.14 : 0.08;
    floor = Math.max(0.14, floor - deepen);
  }

  // Per-phase edge tint: [r, g, b, strength] — colors the shadow at the vignette boundary.
  // The tint is additive into the darkened edge zone, painting mood without blowing out the center.
  //   genesis:     deep violet — the world just kindled, starlike
  //   exploration: no tint    — open sky, neutral
  //   organization: soft jade — life organizing, green haze at periphery
  //   complexity:  warm amber  — peak warmth, campfire at the edge
  //   dissolution: amber-red   — decay bleeds to the horizon
  //   silence:     cold indigo — void closes in, blue absence
  const TINTS: [number, number, number, number][] = [
    [ 22,  0, 55, 0.55],
    [  0,  0,  0, 0.00],
    [  0, 18,  8, 0.30],
    [ 30, 13,  0, 0.45],
    [ 50,  9,  0, 0.65],
    [  0,  8, 45, 0.80],
  ];
  const pi = Math.min(5, Math.max(0, phaseIndex));
  const [tr, tg, tb, ts] = TINTS[pi];
  // Blend tint in gradually over first 25% of the phase so transitions feel smooth
  const tintStrength = ts * Math.min(1, phaseProgress / 0.25);

  // Cross-fade: when transitionBlend > 0, interpolate with the outgoing phase tint
  let xtr = tr, xtg = tg, xtb = tb, xts = tintStrength;
  if (transitionBlend > 0 && prevPhaseIndex >= 0 && prevPhaseIndex !== phaseIndex) {
    const ppi = Math.min(5, Math.max(0, prevPhaseIndex));
    const [ptr, ptg, ptb, pts] = TINTS[ppi];
    const tb2 = transitionBlend;
    xtr = tr * (1 - tb2) + ptr * tb2;
    xtg = tg * (1 - tb2) + ptg * tb2;
    xtb = tb * (1 - tb2) + ptb * tb2;
    xts = tintStrength * (1 - tb2) + pts * tb2;
  }

  const cx = W / 2;
  const cy = H / 2;
  const maxDist = Math.sqrt(cx * cx + cy * cy);
  const d = buf.data;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy) / maxDist;
      const fade = dist < 0.65 ? 1 : 1 - (dist - 0.65) * 1.2;
      const f = Math.max(floor, fade);
      // How much darkness is in this pixel's zone (0 at center, up to 1−floor at extreme corner)
      const darkness = 1 - f;
      const tintFactor = darkness * xts;
      const i = (y * W + x) * 4;
      d[i]     = Math.min(255, Math.max(0, d[i]     * f + xtr * tintFactor)) | 0;
      d[i + 1] = Math.min(255, Math.max(0, d[i + 1] * f + xtg * tintFactor)) | 0;
      d[i + 2] = Math.min(255, Math.max(0, d[i + 2] * f + xtb * tintFactor)) | 0;
    }
  }
}

/**
 * Last-light cinematic spotlight — when the world has only 1–3 motes left during
 * late-game phases, the stage darkens around the survivors.
 *
 * Areas far from any living mote are progressively dimmed; the motes themselves
 * remain fully lit.  Creates a theatrical "spotlight on the last act" as the
 * cycle winds toward silence.
 *
 * Activates during:
 *   - dissolution phase (fades in over first 30% of the phase)
 *   - final 20% of complexity when ≤3 motes remain
 *
 * Darkness scales with remaining count: 3→25%, 2→45%, 1→65%.
 */
export function applyLastLight(
  buf: ImageData,
  motes: Mote[],
  phaseIndex: number,
  phaseProgress: number,
  time: number,
): void {
  const count = motes.length;
  if (count === 0 || count > 3) return;
  if (phaseIndex < 3) return;
  // Late complexity: only last 20% of the phase
  if (phaseIndex === 3 && phaseProgress < 0.80) return;

  // Max darkness outside the spotlight by remaining mote count
  const baseDarkness = count === 1 ? 0.65 : count === 2 ? 0.45 : 0.25;

  // Fade in — dissolution ramps over first 30% of phase; late-complexity quick ramp
  let fadeIn: number;
  if (phaseIndex === 4) {
    fadeIn = Math.min(1, phaseProgress * 3.0);
  } else {
    // phaseIndex === 3, phaseProgress ∈ [0.80, 1.00]
    fadeIn = (phaseProgress - 0.80) / 0.20;
  }
  const maxDarkness = baseDarkness * fadeIn;
  if (maxDarkness < 0.02) return;

  // Spotlight geometry
  const spotR   = 45;               // full spotlight circle radius in px
  const spotR2  = spotR * spotR;
  const innerR2 = (spotR * 0.35) * (spotR * 0.35);   // full brightness core

  // Very slow atmospheric breathing — the darkness feels alive, not digital
  const breathe = Math.sin(time * 0.55) * 0.025 + 0.975;

  const d = buf.data;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // Distance to nearest surviving mote (squared, to avoid sqrt in most cases)
      let minD2 = Infinity;
      for (const m of motes) {
        const ddx = x - m.x;
        const ddy = y - m.y;
        const d2  = ddx * ddx + ddy * ddy;
        if (d2 < minD2) minD2 = d2;
      }

      let brightness: number;
      if (minD2 <= innerR2) {
        brightness = 1.0;                             // full light at core
      } else if (minD2 <= spotR2) {
        // Smooth ease-in-out falloff from inner edge to spotlight boundary
        const t       = (minD2 - innerR2) / (spotR2 - innerR2);  // 0→1
        const smoothT = t * t * (3 - 2 * t);          // smoothstep
        brightness    = 1.0 - smoothT * maxDarkness;
      } else {
        brightness = (1.0 - maxDarkness) * breathe;   // uniform dim beyond spotlight
      }

      const i = (y * W + x) * 4;
      d[i]     = (d[i]     * brightness + 0.5) | 0;
      d[i + 1] = (d[i + 1] * brightness + 0.5) | 0;
      d[i + 2] = (d[i + 2] * brightness + 0.5) | 0;
    }
  }
}

/**
 * Chromatic aberration — brief lateral colour fringing at the moment of a
 * phase transition.  Simulates a lens impact: red channel slides left one pixel,
 * blue slides right, while green stays anchored.
 *
 * The effect fires when phaseFlash > 0.05 and decays exactly with the flash.
 * At peak (phaseFlash = 1.0) the shift is 3 px; at 0.40 it's 1 px; below 0.05
 * the function returns immediately so there is zero per-frame cost during normal play.
 *
 * At 256×144 up-scaled to 1024+ px on screen, even a 3-pixel canvas-space shift
 * reads as 12+ screen pixels — visibly filmic without being distracting.
 */
export function applyChromaticAberration(buf: ImageData, phaseFlash: number): void {
  if (phaseFlash < 0.05) return;
  // Shift ramps 0 → 3 pixels as phaseFlash goes from 0.05 → 1.0
  const shiftF = (phaseFlash - 0.05) / 0.95;
  const shift  = Math.max(1, Math.round(shiftF * 3));

  const d = buf.data;
  for (let y = 0; y < H; y++) {
    const rowBase = y * W;
    // Snapshot R and B values for this row before writing
    for (let x = 0; x < W; x++) {
      const si         = (rowBase + x) * 4;
      _caRowBuf[x * 4]     = d[si];        // R
      _caRowBuf[x * 4 + 2] = d[si + 2];   // B  (G stays — green is the reference channel)
    }
    // Write shifted channels back; green channel is untouched
    for (let x = 0; x < W; x++) {
      const di = (rowBase + x) * 4;
      // Red from x + shift (red image shifts left → fringes on left sides of bright edges)
      const rx = x + shift < W ? x + shift : W - 1;
      d[di]     = _caRowBuf[rx * 4];
      // Blue from x − shift (blue image shifts right)
      const bx  = x - shift >= 0 ? x - shift : 0;
      d[di + 2] = _caRowBuf[bx * 4 + 2];
    }
  }
}

/**
 * Cluster radiance — soft ambient light pools emanating from large bonded clusters.
 * Each cluster centroid glows with biome-warm light, creating a camp-fire-in-darkness
 * effect. Rendered pre-bloom so the light feeds into the glow pass.
 *
 * Phase multiplier ensures radiance peaks at complexity and fades in dissolution/silence.
 */
export function renderClusterRadiance(
  buf: ImageData,
  clusters: Mote[][],
  biome: Biome,
  phaseIndex: number,
  time: number,
): void {
  // Phase multiplier — radiance grows with mote social activity
  const PHASE_STRENGTH = [0.0, 0.25, 0.65, 1.0, 0.45, 0.15];
  const phaseStr = PHASE_STRENGTH[Math.min(5, Math.max(0, phaseIndex))];
  if (phaseStr < 0.01) return;

  // Per-biome light color — warm tone matching each biome's character
  const BIOME_LIGHT: Record<string, [number, number, number]> = {
    temperate: [210, 195, 145],
    desert:    [245, 185,  70],
    tundra:    [130, 195, 245],
    volcanic:  [255, 115,  35],
    lush:      [155, 225, 100],
  };
  const [lr, lg, lb] = BIOME_LIGHT[biome] ?? [210, 195, 145];

  for (const cluster of clusters) {
    if (cluster.length < 4) continue;

    // Centroid of the cluster
    let cx = 0, cy = 0;
    for (const m of cluster) { cx += m.x; cy += m.y; }
    cx /= cluster.length; cy /= cluster.length;

    // Radius and peak alpha scale with cluster size
    const glowRadius = Math.min(32, 10 + cluster.length * 2.5);
    const peakAlpha  = Math.min(26, 5 + cluster.length * 2.2) * phaseStr;
    // Slow pulse: large clusters breathe more slowly, like a settled community
    const pulseHz = 1.8 / Math.max(cluster.length, 3);
    const pulse = Math.sin(time * pulseHz + cx * 0.06) * 0.12 + 0.88;

    const rcx = Math.round(cx);
    const rcy = Math.round(cy);
    const r2 = glowRadius * glowRadius;

    for (let dy = -Math.ceil(glowRadius); dy <= Math.ceil(glowRadius); dy++) {
      for (let dx = -Math.ceil(glowRadius); dx <= Math.ceil(glowRadius); dx++) {
        const d2 = dx * dx + dy * dy;
        if (d2 > r2) continue;
        const falloff = 1 - Math.sqrt(d2) / glowRadius;
        // Cubic falloff = very soft, wide spread. No harsh edges.
        const a = Math.round(peakAlpha * falloff * falloff * falloff * pulse);
        if (a < 2) continue;
        setPixel(buf, rcx + dx, rcy + dy, lr, lg, lb, a);
      }
    }
  }
}

// ─── Flood storm overlay ───────────────────────────────────────────────────

/**
 * Flood event storm overlay — renders when "THE WATERS RISE" is active.
 * Dark storm clouds roll in, heavy diagonal rain hammers down, a thunder
 * flash lights the sky at the moment the flood begins.
 * Call after base weather but before bloom so rain streaks catch the glow.
 */
export function renderFloodStorm(
  buf: ImageData,
  event: ActiveEvent | null,
  time: number,
  cycleNumber: number,
): void {
  if (!event || event.type !== "flood" || event.startTime < 0) return;

  const elapsed = time - event.startTime;
  if (elapsed < 0 || elapsed > event.duration) return;

  const progress = elapsed / event.duration;
  // Build up over first 3s, sustain, ease out over last 30% of event
  const buildIn = Math.min(1.0, elapsed / 3.0);
  const fadeOut = progress > 0.70 ? 1.0 - (progress - 0.70) / 0.30 : 1.0;
  const str = buildIn * fadeOut;
  if (str < 0.02) return;

  const d = buf.data;

  // 1. Storm sky shadow — blue-grey darkness rolls over the upper sky
  const skyH = Math.floor(H * 0.65);
  for (let y = 0; y < skyH; y++) {
    const yf = 1.0 - y / skyH;      // 1 at top, 0 at horizon
    const sk = str * (0.28 + yf * 0.52);
    // Precompute per-row values to avoid per-pixel branches
    const darkR  = Math.round(sk * 52);
    const darkG  = Math.round(sk * 42);
    const darkB  = Math.round(sk * 18);
    const blueAdd = Math.round(str * yf * 16);
    for (let x = 0; x < W; x++) {
      const pi = (y * W + x) << 2;
      d[pi]     = Math.max(0, d[pi]     - darkR);
      d[pi + 1] = Math.max(0, d[pi + 1] - darkG);
      d[pi + 2] = Math.max(0, Math.min(255, d[pi + 2] - darkB + blueAdd));
    }
  }

  // 2. Heavy rain — 70 diagonal streaks falling fast, deterministic per cycle
  const RAIN_N = 70;
  for (let i = 0; i < RAIN_N; i++) {
    const ix = ((i * 7919 + cycleNumber * 173) >>> 0) % W;
    const spd = 74 + (i * 29 % 32);
    // Evenly space particles vertically then scroll with time
    const py = (Math.floor(time * spd) + Math.floor(i * H / RAIN_N)) % H;
    const px = ((ix + Math.round(py * 0.44)) % W + W) % W;
    const rawA = 34 + (i * 23 % 36);
    const alpha = Math.round(str * rawA);
    if (alpha < 2) continue;
    setPixel(buf, px,     py,     148, 172, 218, alpha);
    setPixel(buf, px,     py - 1, 125, 152, 202, Math.round(alpha * 0.55));
    setPixel(buf, px,     py - 2, 105, 134, 188, Math.round(alpha * 0.28));
  }

  // 3. Thunder flash — bright white-blue pulse at the moment the flood begins
  //    Peaks at 0.35s, fully gone by 2.5s — mimics a lightning strike overhead
  if (elapsed < 2.5) {
    const flashPeak = 0.35;
    const flashT = elapsed < flashPeak
      ? elapsed / flashPeak
      : Math.max(0.0, (2.5 - elapsed) / (2.5 - flashPeak));
    const flashA = Math.round(flashT * flashT * 52);
    if (flashA > 2) {
      for (let j = 0; j < d.length; j += 4) {
        d[j]     = Math.min(255, d[j]     + Math.round(flashA * 0.72));
        d[j + 1] = Math.min(255, d[j + 1] + Math.round(flashA * 0.78));
        d[j + 2] = Math.min(255, d[j + 2] + flashA);
      }
    }
  }
}
