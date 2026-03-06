// render-bonds.ts — Bond lines, cluster glow, death particles.

import type { Mote, DeathRecord } from "./types";
import { setPixel } from "./render";
import { drawLine } from "./render";

/** Draw soft glow + identity ring around bonded clusters */
export function renderClusterGlow(
  buf: ImageData,
  cluster: Mote[],
  colors: Map<Mote, [number, number, number]>,
  time: number,
): void {
  let cx = 0, cy = 0, avgR = 0, avgG = 0, avgB = 0;
  for (const m of cluster) {
    cx += m.x; cy += m.y;
    const [r, g, b] = colors.get(m)!;
    avgR += r; avgG += g; avgB += b;
  }
  cx /= cluster.length; cy /= cluster.length;
  avgR = Math.round(avgR / cluster.length);
  avgG = Math.round(avgG / cluster.length);
  avgB = Math.round(avgB / cluster.length);

  const radius = Math.min(16, 6 + cluster.length * 1.5);
  const pulse = Math.sin(time * 2 + cx * 0.1) * 0.15 + 0.85;
  const maxAlpha = Math.min(30, 10 + cluster.length * 3) * pulse;

  const rcx = Math.round(cx);
  const rcy = Math.round(cy);
  const r2 = radius * radius;

  for (let dy = -Math.ceil(radius); dy <= Math.ceil(radius); dy++) {
    for (let dx = -Math.ceil(radius); dx <= Math.ceil(radius); dx++) {
      const d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;
      const falloff = 1 - Math.sqrt(d2) / radius;
      const a = Math.round(maxAlpha * falloff * falloff);
      if (a < 2) continue;
      setPixel(buf, rcx + dx, rcy + dy, avgR, avgG, avgB, a);
    }
  }

  // IDENTITY RING — clusters of 4+ earn a pulsing perimeter that marks their territory.
  // Larger clusters pulse more slowly: a big community breathes with gravity.
  if (cluster.length >= 4) {
    const ringRadius = Math.min(22, 9 + cluster.length * 2);
    // Pulse frequency inversely proportional to size: 4-mote cluster = fast, 10-mote = stately
    const ringPulseHz = 3.0 / Math.max(cluster.length, 2);
    const ringPulse = Math.sin(time * ringPulseHz + cx * 0.07) * 0.5 + 0.5;
    const ringAlpha = Math.round(ringPulse * Math.min(65, 18 + cluster.length * 6));

    // Dash count scales with cluster size — more members = denser ring
    const dashCount = 8 + cluster.length * 2;
    // Ring slowly rotates: large clusters rotate slower
    const rotOffset = time * (0.25 / Math.max(cluster.length, 4));

    for (let i = 0; i < dashCount; i++) {
      // Skip every 4th dot to create gaps (dashed appearance)
      if (i % 4 === 3) continue;
      const angle = (i / dashCount) * Math.PI * 2 + rotOffset;
      const rx = Math.round(cx + Math.cos(angle) * ringRadius);
      const ry = Math.round(cy + Math.sin(angle) * ringRadius);
      setPixel(buf, rx, ry, avgR, avgG, avgB, ringAlpha);
      // Second pixel for slightly thicker ring on large clusters
      if (cluster.length >= 6) {
        const rx2 = Math.round(cx + Math.cos(angle) * (ringRadius - 1));
        const ry2 = Math.round(cy + Math.sin(angle) * (ringRadius - 1));
        setPixel(buf, rx2, ry2, avgR, avgG, avgB, Math.round(ringAlpha * 0.45));
      }
    }

    // SPOKES — clusters of 6+ radiate lines from center to ring
    if (cluster.length >= 6) {
      const spokeCount = Math.min(6, Math.floor(cluster.length / 2));
      const spokePulse = Math.sin(time * ringPulseHz * 0.7 + cx * 0.1) * 0.4 + 0.6;
      const spokeAlpha = Math.round(spokePulse * Math.min(40, cluster.length * 4));
      for (let i = 0; i < spokeCount; i++) {
        const angle = (i / spokeCount) * Math.PI * 2 + rotOffset * 0.5;
        // Draw 3 pixels along each spoke (inner half of ring radius)
        for (let step = 2; step <= Math.floor(ringRadius * 0.6); step += 3) {
          const sx = Math.round(cx + Math.cos(angle) * step);
          const sy = Math.round(cy + Math.sin(angle) * step);
          const falloffAlpha = Math.round(spokeAlpha * (1 - step / (ringRadius * 0.6)));
          setPixel(buf, sx, sy, avgR, avgG, avgB, falloffAlpha);
        }
      }
    }
  }
}

/** Draw bond lines between connected motes */
export function renderBondLines(
  buf: ImageData,
  motes: Mote[],
  moteColors: Map<Mote, [number, number, number]>,
  time: number,
): void {
  const drawn = new Set<string>();
  for (const m of motes) {
    for (const bonded of m.bonds) {
      const bdx = bonded.x - m.x;
      const bdy = bonded.y - m.y;
      if (bdx * bdx + bdy * bdy > 50 * 50) continue;
      const key = m.x < bonded.x
        ? `${m.x},${m.y}-${bonded.x},${bonded.y}`
        : `${bonded.x},${bonded.y}-${m.x},${m.y}`;
      if (drawn.has(key)) continue;
      drawn.add(key);
      const [r1, g1, b1] = moteColors.get(m)!;
      const [r2, g2, b2] = moteColors.get(bonded)!;
      const avgR = Math.round((r1 + r2) / 2);
      const avgG = Math.round((g1 + g2) / 2);
      const avgB = Math.round((b1 + b2) / 2);

      const flash = Math.max(m.bondFlash, bonded.bondFlash);
      const bondPulse = Math.sin(time * 3 + m.x * 0.05 + bonded.x * 0.05) * 0.15 + 0.85;
      const bondAlpha = Math.round((160 + flash * 95) * bondPulse);
      drawLine(buf, m.x, m.y, bonded.x, bonded.y, avgR, avgG, avgB, bondAlpha);
      const glowAlpha = Math.round(bondAlpha * 0.35);
      drawLine(buf, m.x, m.y - 1, bonded.x, bonded.y - 1, avgR, avgG, avgB, glowAlpha);

      // Bond formation arc: two sparks converge from each mote toward midpoint
      if (flash > 0.02) {
        const t = 1 - flash;          // 0→1 as flash decays
        const t1 = t * 0.5;           // spark from m: 0 → 0.5
        const t2 = 1 - t * 0.5;      // spark from bonded: 1 → 0.5
        const s1x = m.x + (bonded.x - m.x) * t1;
        const s1y = m.y + (bonded.y - m.y) * t1;
        const s2x = m.x + (bonded.x - m.x) * t2;
        const s2y = m.y + (bonded.y - m.y) * t2;
        const sparkA = Math.round(flash * 240);
        const glowA  = Math.round(flash * 110);
        setPixel(buf, s1x,     s1y,     255,  255,  255,  sparkA);
        setPixel(buf, s1x - 1, s1y,     avgR, avgG, avgB, glowA);
        setPixel(buf, s1x + 1, s1y,     avgR, avgG, avgB, glowA);
        setPixel(buf, s2x,     s2y,     255,  255,  255,  sparkA);
        setPixel(buf, s2x - 1, s2y,     avgR, avgG, avgB, glowA);
        setPixel(buf, s2x + 1, s2y,     avgR, avgG, avgB, glowA);
      }
    }
  }
}

/** Death particles — four-phase soul departure: flash → shards → spirit → echo */
export function renderDeathParticles(
  buf: ImageData,
  deaths: DeathRecord[],
  time: number,
): void {
  for (const d of deaths) {
    const age = time - d.time;

    // Precompute brightened identity color
    const br = Math.min(255, Math.round(d.r * 1.5 + 50));
    const bg = Math.min(255, Math.round(d.g * 1.5 + 50));
    const bb = Math.min(255, Math.round(d.b * 1.5 + 50));

    // Phase 1: Flash burst (0–0.28s) — white core + expanding color ring
    if (age < 0.28) {
      const t = age / 0.28;
      const ring = t * 10; // radius expands 0→10px
      const ringA = Math.round((1 - t) * 210);
      for (let i = 0; i < 12; i++) {
        const angle = (i / 12) * Math.PI * 2;
        setPixel(buf, d.x + Math.cos(angle) * ring, d.y - 1 + Math.sin(angle) * ring, br, bg, bb, ringA);
      }
      const coreA = Math.round((1 - t) * 255);
      setPixel(buf, d.x, d.y - 1, 255, 255, 255, coreA);
      setPixel(buf, d.x - 1, d.y - 1, 255, 255, 255, Math.round(coreA * 0.6));
      setPixel(buf, d.x + 1, d.y - 1, 255, 255, 255, Math.round(coreA * 0.6));
      setPixel(buf, d.x, d.y, 255, 255, 255, Math.round(coreA * 0.5));
      setPixel(buf, d.x, d.y - 2, br, bg, bb, Math.round(coreA * 0.45));
    }

    // Phase 2: Soul shards (0–1.8s) — 5 particles arc upward and fade
    if (age < 1.8) {
      for (let i = 0; i < 5; i++) {
        // Deterministic spread: fan upward, ±1.1 rad around straight-up (-π/2)
        const spread = (i - 2) * 0.55;
        // Small position-based jitter so each death looks slightly unique
        const jitter = ((d.x * 13 + d.y * 7 + i * 31) % 100) * 0.006 - 0.3;
        const angle = -Math.PI / 2 + spread + jitter;
        const spd = 10 + ((d.x * 3 + i * 17) % 6); // 10–15 px/s
        const px = d.x + Math.cos(angle) * spd * age;
        // Upward launch with mild gravity pulling back
        const py = d.y - 1 + Math.sin(angle) * spd * age + 3.5 * age * age;
        // Alpha: ramp 0→0.2s, plateau, fade 0.6→1.8s
        let alpha: number;
        if (age < 0.2) alpha = Math.round((age / 0.2) * 170);
        else if (age < 0.6) alpha = 170;
        else alpha = Math.round((1 - (age - 0.6) / 1.2) * 170);
        if (alpha > 3) {
          setPixel(buf, px, py, d.r, d.g, d.b, alpha);
          // Bright tip
          setPixel(buf, px, py - 1, br, bg, bb, Math.round(alpha * 0.45));
        }
      }
    }

    // Phase 3: Spirit orb (0–2.8s) — rises high, pulses, then fades away
    if (age < 2.8) {
      // Ease-out rise: fast at start, decelerating
      const rise = 16 * age - 2.2 * age * age;
      const sway = Math.sin(age * 3.5 + d.x * 0.2) * 1.5;
      const sx = d.x + sway;
      const sy = d.y - 1 - Math.max(0, rise);
      const pulse = Math.sin(age * 7) * 0.15 + 0.85;
      let spiritA: number;
      if (age < 0.15) spiritA = Math.round((age / 0.15) * 230 * pulse);
      else if (age < 1.8) spiritA = Math.round(230 * pulse);
      else spiritA = Math.round((1 - (age - 1.8) / 1.0) * 230 * pulse);
      if (spiritA > 4) {
        setPixel(buf, sx, sy, br, bg, bb, spiritA);
        setPixel(buf, sx - 1, sy, d.r, d.g, d.b, Math.round(spiritA * 0.55));
        setPixel(buf, sx + 1, sy, d.r, d.g, d.b, Math.round(spiritA * 0.55));
        setPixel(buf, sx, sy - 1, 255, 255, 255, Math.round(spiritA * 0.35));
        // Faint trail below spirit
        if (rise > 4) {
          const trailRise = rise * 0.55;
          setPixel(buf, d.x + sway * 0.5, d.y - 1 - trailRise, d.r, d.g, d.b, Math.round(spiritA * 0.18));
        }
      }
    }

    // Phase 4: Ground echo (1.2–7.0s) — soft glow at death site
    if (age >= 1.2 && age < 7.0) {
      const markLife = 1 - (age - 1.2) / 5.8;
      const ma = Math.round(markLife * markLife * 38);
      if (ma > 1) {
        setPixel(buf, d.x, d.y, d.r, d.g, d.b, ma);
        setPixel(buf, d.x - 1, d.y, d.r, d.g, d.b, Math.round(ma * 0.5));
        setPixel(buf, d.x + 1, d.y, d.r, d.g, d.b, Math.round(ma * 0.5));
      }
    }
  }
}
