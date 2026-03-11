// render-bonds.ts — Bond lines, cluster glow, death particles.

import type { Mote, DeathRecord } from "./types";
import { H } from "./config";
import { setPixel } from "./render";
import { drawLine } from "./render";

/** Warm campfire-light on terrain beneath a cluster.
 *  Drawn BEFORE motes so it sits on the ground under them.
 *  Phase-scaled so complexity glows rich and genesis stays cold. */
export function renderClusterGroundGlow(
  buf: ImageData,
  cluster: Mote[],
  colors: Map<Mote, [number, number, number]>,
  phaseIndex: number,
  time: number,
): void {
  // Phase multiplier — ground warmth tracks the life arc
  const PHASE_STR = [0.0, 0.18, 0.52, 1.0, 0.58, 0.08];
  const phaseStr = PHASE_STR[Math.min(5, Math.max(0, phaseIndex))];
  if (phaseStr < 0.04) return;

  // Average mote color + find lowest (ground-level) mote Y
  let cx = 0, avgR = 0, avgG = 0, avgB = 0, groundY = 0;
  for (const m of cluster) {
    cx += m.x;
    if (m.y > groundY) groundY = m.y;
    const [r, g, b] = colors.get(m)!;
    avgR += r; avgG += g; avgB += b;
  }
  cx /= cluster.length;
  avgR = Math.round(avgR / cluster.length);
  avgG = Math.round(avgG / cluster.length);
  avgB = Math.round(avgB / cluster.length);

  // Warm the glow toward amber campfire — ground absorbs the cluster's light
  const glowR = Math.min(255, Math.round(avgR * 1.12 + 22));
  const glowG = Math.min(255, Math.round(avgG * 0.92 + 8));
  const glowB = Math.min(255, Math.round(avgB * 0.68));

  // Ellipse: horizontal spread, shallow height — light pooling on flat ground
  const glowW = Math.min(26, 9 + cluster.length * 2.8);
  const glowH = Math.min(5, 2 + cluster.length * 0.55);
  const peakAlpha = Math.min(38, 11 + cluster.length * 3.8) * phaseStr;

  // Breathe — synchronized with the cluster glow pulse
  const pulse = Math.sin(time * 1.3 + cx * 0.09) * 0.13 + 0.87;

  const rcx = Math.round(cx);
  const rgy = Math.min(H - 1, Math.round(groundY) + 1); // just below ground mote

  for (let dy = -Math.ceil(glowH); dy <= Math.ceil(glowH) + 1; dy++) {
    for (let dx = -Math.ceil(glowW); dx <= Math.ceil(glowW); dx++) {
      const normX = dx / glowW;
      const normY = dy / glowH;
      const d2 = normX * normX + normY * normY;
      if (d2 > 1) continue;
      const falloff = 1 - Math.sqrt(d2);
      const a = Math.round(peakAlpha * falloff * falloff * falloff * pulse);
      if (a < 2) continue;
      setPixel(buf, rcx + dx, rgy + dy, glowR, glowG, glowB, a);
    }
  }
}

/** Draw soft glow + identity ring around bonded clusters */
export function renderClusterGlow(
  buf: ImageData,
  cluster: Mote[],
  colors: Map<Mote, [number, number, number]>,
  time: number,
  phaseIndex = 3,
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

  // Phase scaling — glow strongest at complexity, weakest at genesis/silence
  const PHASE_GLOW = [0.55, 0.70, 0.88, 1.0, 0.72, 0.38];
  const phaseScale = PHASE_GLOW[Math.min(5, Math.max(0, phaseIndex))];

  const radius = Math.min(16, 6 + cluster.length * 1.5);
  const pulse = Math.sin(time * 2 + cx * 0.1) * 0.15 + 0.85;
  const maxAlpha = Math.min(30, 10 + cluster.length * 3) * pulse * phaseScale;

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

      // BOND AGE: bonds start cool blue-white (new connection, fresh energy),
      // mature to mote colors (familiarity), then warm to amber-gold (proven, ancient bond).
      // Reading the world: a gold-glowing bond is a long relationship — its eventual break is a loss.
      const bondAge = ((m.bondAges.get(bonded) ?? 0) + (bonded.bondAges.get(m) ?? 0)) / 2;
      const youngT = Math.max(0, 1 - bondAge / 8);       // 1→0 over first 8s (cool flash fading)
      const oldT = Math.min(1, Math.max(0, (bondAge - 25) / 45)); // 0→1 from 25s→70s (warming)
      const ancientT = Math.min(1, Math.max(0, (bondAge - 70) / 30)); // 0→1 beyond 70s (deep gold)

      // Age-tinted base color: young=cool blue-white, old=warm amber, ancient=deep gold
      const ageR = Math.round(avgR - youngT * 20 + oldT * 55 + ancientT * 20);
      const ageG = Math.round(avgG + youngT * 15 + oldT * 20);
      const ageB = Math.round(avgB + youngT * 50 - oldT * 55 - ancientT * 20);
      const baseR = Math.min(255, Math.max(0, ageR));
      const baseG = Math.min(255, Math.max(0, ageG));
      const baseB = Math.min(255, Math.max(0, ageB));

      const flash = Math.max(m.bondFlash, bonded.bondFlash);
      const bondPulse = Math.sin(time * 3 + m.x * 0.05 + bonded.x * 0.05) * 0.15 + 0.85;
      // Old bonds are slightly brighter — they've earned it
      const bondAlpha = Math.round((160 + flash * 95 + oldT * 35 + ancientT * 20) * bondPulse);

      // STRESSED BOND: when either mote is dying, the bond glows with urgent warmth.
      // The relationship shows its strain — the line between them burns brighter as time runs out.
      const stressLevel = Math.max(
        m.energy < 0.3 ? 1 - m.energy / 0.3 : 0,
        bonded.energy < 0.3 ? 1 - bonded.energy / 0.3 : 0,
      );
      let br = baseR, bg = baseG, bb = baseB;
      let finalAlpha = bondAlpha;
      if (stressLevel > 0) {
        // Shift toward hot orange-white as stress peaks — the bond fights to hold
        br = Math.min(255, baseR + Math.round(stressLevel * (255 - baseR) * 0.65));
        bg = Math.min(255, baseG + Math.round(stressLevel * (110 - baseG) * 0.35));
        bb = Math.max(0, baseB - Math.round(stressLevel * baseB * 0.55));
        // Fast urgent pulse (3x normal speed) — the bond flickers with effort
        const stressPulse = Math.sin(time * 10 + m.x * 0.1) * 0.25 + 0.75;
        finalAlpha = Math.min(255, Math.round(bondAlpha * (1 + stressLevel * 0.65) * stressPulse));
      }

      drawLine(buf, m.x, m.y, bonded.x, bonded.y, br, bg, bb, finalAlpha);
      const glowAlpha = Math.round(finalAlpha * 0.35);
      drawLine(buf, m.x, m.y - 1, bonded.x, bonded.y - 1, br, bg, bb, glowAlpha);

      // ANCIENT BOND GLOW — bonds past 70s earn a faint warm outer halo.
      // These are the oldest relationships in the world; they deserve to be seen.
      if (ancientT > 0.05) {
        const ancientGlow = Math.round(ancientT * 28 * bondPulse);
        if (ancientGlow > 3) {
          drawLine(buf, m.x, m.y + 1, bonded.x, bonded.y + 1, br, bg, bb, ancientGlow);
          drawLine(buf, m.x - 1, m.y, bonded.x - 1, bonded.y, br, bg, bb, Math.round(ancientGlow * 0.55));
        }
      }
      // Extra thickness pixel for stressed bonds — makes them physically wider, unmissable
      if (stressLevel > 0.25) {
        const extraAlpha = Math.round(stressLevel * 70 * (Math.sin(time * 10 + m.x * 0.1) * 0.2 + 0.8));
        if (extraAlpha > 4) {
          drawLine(buf, m.x, m.y + 1, bonded.x, bonded.y + 1, br, bg, bb, extraAlpha);
        }
      }

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

        // Bond midpoint burst — a brief starburst at the moment of connection.
        // Only fires while the bond is very fresh (flash > 0.80): the first ~0.2s.
        // The starburst fades in and out quickly, leaving only the sparks.
        if (flash > 0.80) {
          const burstT = (flash - 0.80) / 0.20;   // 1→0 during this window
          const midX = (m.x + bonded.x) / 2;
          const midY = (m.y + bonded.y) / 2;
          // Bright center pixel
          setPixel(buf, midX, midY, 255, 255, 255, Math.round(burstT * 255));
          // 4-direction arms radiating outward; length 1–4px with falloff
          for (let step = 1; step <= 4; step++) {
            const falloff = 1 - step / 5;
            const ca = Math.round(burstT * falloff * falloff * 220);
            if (ca < 4) continue;
            setPixel(buf, midX + step, midY,       255, 255, 255, ca);
            setPixel(buf, midX - step, midY,       255, 255, 255, ca);
            setPixel(buf, midX,        midY - step, 255, 255, 255, ca);
            setPixel(buf, midX,        midY + step, 255, 255, 255, ca);
          }
          // Diagonal arms (bond color, dimmer) — adds a classic star shape
          for (let step = 1; step <= 3; step++) {
            const falloff = 1 - step / 4;
            const da = Math.round(burstT * falloff * falloff * 140);
            if (da < 4) continue;
            setPixel(buf, midX + step, midY - step, avgR, avgG, avgB, da);
            setPixel(buf, midX - step, midY - step, avgR, avgG, avgB, da);
            setPixel(buf, midX + step, midY + step, avgR, avgG, avgB, da);
            setPixel(buf, midX - step, midY + step, avgR, avgG, avgB, da);
          }
        }
      }

      // CLUSTER MERGE BLOOM — fires only when both motes were already bonded before this link.
      // Two communities becoming one: an expanding color wave from the joining point,
      // much larger and longer than the regular bond starburst.
      const mergeFlash = Math.min(m.clusterMergeFlash, bonded.clusterMergeFlash);
      if (mergeFlash > 0) {
        const midX = (m.x + bonded.x) / 2;
        const midY = (m.y + bonded.y) / 2;
        const mf = mergeFlash;

        // Outer expanding ring: radius sweeps from 4 → 22 as flash decays (1 → 0)
        const outerR = 4 + (1 - mf) * 18;
        const outerA = Math.round(mf * mf * 190);
        if (outerA > 3) {
          const dotCount = 20 + Math.round((1 - mf) * 16); // more dots as it expands
          for (let i = 0; i < dotCount; i++) {
            const angle = (i / dotCount) * Math.PI * 2;
            setPixel(buf, midX + Math.cos(angle) * outerR, midY + Math.sin(angle) * outerR, avgR, avgG, avgB, outerA);
          }
        }

        // Inner tight ring: stays near midpoint, fades faster — the spark of contact
        const innerR = 3 + (1 - mf) * 5;
        const innerA = Math.round(mf * mf * mf * 240);
        if (innerA > 4) {
          const innerDots = 12;
          for (let i = 0; i < innerDots; i++) {
            const angle = (i / innerDots) * Math.PI * 2;
            setPixel(buf, midX + Math.cos(angle) * innerR, midY + Math.sin(angle) * innerR, 255, 255, 255, innerA);
          }
        }

        // Soft area fill at peak (mf > 0.7) — a brief warm bloom before the rings dominate
        if (mf > 0.7) {
          const fillT = (mf - 0.7) / 0.3; // 1→0
          const fillR = Math.round(fillT * 8);
          for (let dy = -fillR; dy <= fillR; dy++) {
            for (let dx = -fillR; dx <= fillR; dx++) {
              const d2 = dx * dx + dy * dy;
              if (d2 > fillR * fillR) continue;
              const falloff = 1 - Math.sqrt(d2) / fillR;
              const fa = Math.round(fillT * falloff * falloff * 70);
              if (fa < 3) continue;
              setPixel(buf, midX + dx, midY + dy, avgR, avgG, avgB, fa);
            }
          }
        }
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

    // Wanderer death trail — ghost path that outlives the walker.
    // Trail points saved at death persist up to 4.5s (natural 3s + 1.5s ghost extension),
    // oldest points dying first. Color bleeds toward ghost grey as time passes.
    if (d.trail && d.trail.length > 0 && age < 4.5) {
      const maxAge = 4.5;
      for (const pt of d.trail) {
        const effectiveAge = pt.age + age;   // trail point age grows as death ages
        if (effectiveAge > maxAge) continue;
        const ageFrac = effectiveAge / maxAge;
        const ghostT = Math.min(1, age / 1.5); // fully grey after 1.5s
        // Bleed from mote color toward cold ghost grey
        const gr = Math.round(d.r * (1 - ghostT) + 88 * ghostT);
        const gg = Math.round(d.g * (1 - ghostT) + 82 * ghostT);
        const gb = Math.round(d.b * (1 - ghostT) + 78 * ghostT);
        const ta = Math.round((1 - ageFrac) * 26 * (1 - ghostT * 0.4));
        if (ta > 2) setPixel(buf, pt.x, pt.y, gr, gg, gb, ta);
      }
    }
  }
}

/** Silence constellation — faint star-crosses at every death position from the cycle.
 *  Only renders during the silence phase with no motes alive.
 *  Each death site becomes a tiny memorial: the world remembers who walked here.
 *  The constellation materializes gradually over the first ~8 seconds of silence
 *  rather than appearing all at once — the world slowly recalling what it lost. */
export function renderSilenceConstellation(
  buf: ImageData,
  allDeaths: Array<{ x: number; y: number; r: number; g: number; b: number }>,
  phaseName: string,
  motesCount: number,
  time: number,
  phaseProgress: number,
): void {
  if (phaseName !== "silence" || motesCount > 0 || allDeaths.length === 0) return;

  // Silence phase is 24s long (0.08 of 300s cycle).
  // Reveal over first ~8s → phaseProgress 0→0.333 → multiply × 3 and clamp to 1.
  // Eased: slow start so it feels like gradual remembrance, not a pop.
  const revealRaw = Math.min(1, phaseProgress * 3.0);
  const revealFade = revealRaw * revealRaw * (3 - 2 * revealRaw); // smoothstep

  // Gentle, slow breathing — the world inhales its memories
  const breathe = Math.sin(time * 0.38) * 0.18 + 0.82;

  for (let i = 0; i < allDeaths.length; i++) {
    const d = allDeaths[i];
    // Earlier deaths are dimmer — they happened longer ago, further from memory
    const recency = i / Math.max(1, allDeaths.length - 1); // 0 = oldest, 1 = most recent

    // Each memorial star has its own gentle twinkle rhythm — the constellation breathes
    const twinkle = Math.sin(time * (1.8 + i * 0.33 + d.x * 0.09) + i * 2.1) * 0.30 + 0.70;
    const baseAlpha = Math.round((12 + recency * 26) * breathe * twinkle * revealFade);
    if (baseAlpha < 2) continue;

    // Color-tinted ghost: recent deaths retain their hue; oldest fade to anonymous white.
    // recency=0 (oldest) → 15% original color; recency=1 (most recent) → 55% original color.
    // The silence is not anonymous — the world remembers who each light was.
    const colorHold = 0.15 + recency * 0.40;
    const ghostR = 145, ghostG = 138, ghostB = 148;
    const gr = Math.round(d.r * colorHold + ghostR * (1 - colorHold));
    const gg = Math.round(d.g * colorHold + ghostG * (1 - colorHold));
    const gb = Math.round(d.b * colorHold + ghostB * (1 - colorHold));

    const x = Math.round(d.x);
    const y = Math.round(d.y) - 1;

    // Tiny 5-pixel cross — center bright, arms dim
    setPixel(buf, x,     y,     gr, gg, gb, baseAlpha);
    setPixel(buf, x - 1, y,     gr, gg, gb, Math.round(baseAlpha * 0.55));
    setPixel(buf, x + 1, y,     gr, gg, gb, Math.round(baseAlpha * 0.55));
    setPixel(buf, x,     y - 1, gr, gg, gb, Math.round(baseAlpha * 0.55));
    setPixel(buf, x,     y + 1, gr, gg, gb, Math.round(baseAlpha * 0.45));

    // Most recent deaths (top 25%) earn a bright warm center — the freshest memory shines
    if (recency > 0.75) {
      const highlight = Math.round(baseAlpha * 1.6);
      if (highlight > 5) setPixel(buf, x, y, 235, 232, 255, Math.min(255, highlight));
    }
  }
}
