// render-effects.ts — Visual effects: eclipse, aurora, meteor, impact, crater, vignette, phase flash.

import { W, H } from "./config";
import type { Mote, ActiveEvent } from "./types";
import { setPixel } from "./render";
import { getMeteorPosition } from "./events";

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

/** Vignette — darken edges, strength varies by phase */
export function applyVignette(buf: ImageData, phaseIndex: number): void {
  // Minimum brightness at extreme corners per phase (lower = darker edges)
  // silence is most dramatic; exploration is most open
  const VIGNETTE_FLOORS = [0.57, 0.62, 0.56, 0.55, 0.46, 0.32];
  const floor = VIGNETTE_FLOORS[Math.min(5, Math.max(0, phaseIndex))];
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
      const i = (y * W + x) * 4;
      d[i]     = d[i]     * f;
      d[i + 1] = d[i + 1] * f;
      d[i + 2] = d[i + 2] * f;
    }
  }
}
