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

/** Render eclipse darkness, stars, and glowing mote eyes */
export function renderEclipse(
  buf: ImageData,
  event: ActiveEvent,
  time: number,
  motes: Mote[],
  moteColors: Map<Mote, [number, number, number]>,
  cycleNumber: number,
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

/** Per-phase color grade — subtle warm/cool tint applied to the final composed frame */
export function applyPhaseColorGrade(buf: ImageData, phaseIndex: number, phaseProgress: number): void {
  // Additive RGB shifts [r, g, b] for each phase — small but perceptible
  const GRADES: [number, number, number][] = [
    [ 0,  0,  7],  // 0 genesis:      cool violet cast
    [ 3,  1, -2],  // 1 exploration:  slight warm push
    [ 0,  0,  0],  // 2 organization: neutral (skip)
    [ 4,  2, -3],  // 3 complexity:   vivid warm peak
    [ 7, -1, -5],  // 4 dissolution:  amber decline
    [-3, -2,  6],  // 5 silence:      cold blue absence
  ];
  const [dr, dg, db] = GRADES[Math.min(5, Math.max(0, phaseIndex))];
  if (dr === 0 && dg === 0 && db === 0) return;
  // Blend in gradually — full strength by 25% into the phase
  const blend = Math.min(1, phaseProgress / 0.25);
  const fr = Math.round(dr * blend);
  const fg = Math.round(dg * blend);
  const fb = Math.round(db * blend);
  if (fr === 0 && fg === 0 && fb === 0) return;

  const d = buf.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i]     = Math.min(255, Math.max(0, d[i]     + fr));
    d[i + 1] = Math.min(255, Math.max(0, d[i + 1] + fg));
    d[i + 2] = Math.min(255, Math.max(0, d[i + 2] + fb));
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

/** Phase transition pulse — colored flash matching each phase's mood */
export function renderPhaseFlash(buf: ImageData, phaseFlash: number, phaseIndex: number): void {
  if (phaseFlash <= 0) return;
  // Per-phase additive RGB boost [r, g, b] applied at full flash intensity
  const PHASE_FLASHES: [number, number, number][] = [
    [ 0,  2, 18],  // 0 genesis:      cool violet
    [14,  6,  0],  // 1 exploration:  warm gold
    [ 8,  7,  7],  // 2 organization: soft white
    [12,  5,  0],  // 3 complexity:   vivid warm
    [18,  0, -4],  // 4 dissolution:  deep amber-red
    [ 0,  2, 16],  // 5 silence:      cold blue
  ];
  const tint = PHASE_FLASHES[Math.min(5, Math.max(0, phaseIndex))];
  const f = phaseFlash;
  const d = buf.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i]     = Math.min(255, Math.max(0, Math.round(d[i]     + (d[i]     * 0.07 + tint[0]) * f)));
    d[i + 1] = Math.min(255, Math.max(0, Math.round(d[i + 1] + (d[i + 1] * 0.07 + tint[1]) * f)));
    d[i + 2] = Math.min(255, Math.max(0, Math.round(d[i + 2] + (d[i + 2] * 0.07 + tint[2]) * f)));
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
    // Genesis: ascending stardust — fades in fast, fades out by ~70%
    const fadeIn  = Math.min(1, phaseProgress * 10);
    const fadeOut = phaseProgress > 0.65 ? Math.max(0, 1 - (phaseProgress - 0.65) / 0.35) : 1;
    const intensity = fadeIn * fadeOut;
    if (intensity < 0.02) return;

    const COUNT = 28;
    const seed  = cycleNumber * 7919;
    for (let i = 0; i < COUNT; i++) {
      const h1 = Math.abs(seed + i * 6271) % (W * 100);
      const h2 = Math.abs(seed + i * 4397) % (H * 100);
      const h3 = Math.abs(seed + i * 2311) % 100;
      const h4 = Math.abs(seed + i * 1129) % 200;
      const h5 = Math.abs(seed + i *  997) % 100;

      const baseX     = h1 % W;
      const baseY     = h2 % H;
      const riseSpeed = 2.0 + h3 / 33.3;           // 2.0–5.0 px/s upward
      const drift     = (h4 - 100) / 250;          // –0.4..+0.4 px/s horizontal
      const twinkle   = Math.sin(time * (1.5 + h5 / 50) + i * 2.1) * 0.35 + 0.65;

      const x = ((baseX + drift * time + W * 10) % W + W) % W | 0;
      const y = ((baseY - riseSpeed * time)       % H + H * 50) % H | 0;

      const a = Math.round(intensity * twinkle * 160);
      if (a < 4) continue;

      setPixel(buf, x, y, 245, 233, 190, a);
      // 1-in-5 particles get a faint cross halo
      if (h3 % 5 === 0) {
        const ha = Math.round(a * 0.38);
        setPixel(buf, x - 1, y, 255, 248, 215, ha);
        setPixel(buf, x + 1, y, 255, 248, 215, ha);
        setPixel(buf, x, y - 1, 255, 248, 215, ha);
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

/** Vignette — darken edges with phase-colored tint. Each phase has a distinct atmospheric hue. */
export function applyVignette(buf: ImageData, phaseIndex: number, phaseProgress: number): void {
  // Minimum brightness at extreme corners per phase (lower = darker edges)
  // silence is most dramatic; exploration is most open
  const VIGNETTE_FLOORS = [0.57, 0.62, 0.56, 0.55, 0.46, 0.32];
  const floor = VIGNETTE_FLOORS[Math.min(5, Math.max(0, phaseIndex))];

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
  const [tr, tg, tb, ts] = TINTS[Math.min(5, Math.max(0, phaseIndex))];
  // Blend tint in gradually over first 25% of the phase so transitions feel smooth
  const tintStrength = ts * Math.min(1, phaseProgress / 0.25);

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
      const tint = darkness * tintStrength;
      const i = (y * W + x) * 4;
      d[i]     = Math.min(255, Math.max(0, d[i]     * f + tr * tint)) | 0;
      d[i + 1] = Math.min(255, Math.max(0, d[i + 1] * f + tg * tint)) | 0;
      d[i + 2] = Math.min(255, Math.max(0, d[i + 2] * f + tb * tint)) | 0;
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
