// render-bonds.ts — Bond lines, cluster glow, death particles.

import type { Mote, DeathRecord } from "./types";
import { H } from "./config";
import { setPixel } from "./render";
import { drawLine } from "./render";

/** Soft light beacon rising from large clusters into the sky.
 *  Each cluster of 6+ motes emits a column of warm colored vapor that climbs
 *  toward the clouds — communities made visible from across the world.
 *  Phase-aware: invisible at genesis, peaks at complexity, gone at silence.
 *  Drawn BEFORE mote sprites so creatures sit inside their beacon glow. */
export function renderClusterBeacons(
  buf: ImageData,
  clusters: Mote[][],
  colors: Map<Mote, [number, number, number]>,
  phaseIndex: number,
  time: number,
): void {
  const PHASE_STR = [0.0, 0.08, 0.44, 1.0, 0.50, 0.04];
  const phaseStr = PHASE_STR[Math.min(5, Math.max(0, phaseIndex))];
  if (phaseStr < 0.02) return;

  for (const cluster of clusters) {
    if (cluster.length < 6) continue;

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

    // Beacon height scales with cluster size — larger communities cast higher light
    const beaconH = Math.min(82, 22 + cluster.length * 5);
    // Peak alpha: soft vapor — bloom pass will enrich this
    const peakAlpha = Math.min(24, 6 + cluster.length * 2.0) * phaseStr;
    // Flicker rate matches cluster heartbeat: large clusters breathe slowly
    const pulseHz = 1.8 / Math.sqrt(Math.max(cluster.length, 4));
    const flicker = Math.sin(time * pulseHz + cx * 0.09) * 0.18 + 0.82;

    const rcx = Math.round(cx);
    const baseY = Math.round(cy) - 1;

    for (let step = 0; step < beaconH; step++) {
      const t = step / beaconH;
      // Falloff: pools at base, thins to wisp at apex
      const falloff = (1 - t) * (1 - t * 0.55);
      const a = Math.round(peakAlpha * falloff * flicker);
      if (a < 2) continue;

      // Width: full at base, single pixel near tip
      const halfW = Math.max(0, 2.0 - t * 2.6);

      // Color: mote identity at base, cool blue-white toward tip
      const skyT = t * t * 0.45;
      const pr = Math.min(255, Math.round(avgR * (1 - skyT) + 195 * skyT));
      const pg = Math.min(255, Math.round(avgG * (1 - skyT) + 215 * skyT));
      const pb = Math.min(255, Math.round(avgB * (1 - skyT) + 255 * skyT));

      for (let dx = -Math.ceil(halfW); dx <= Math.ceil(halfW); dx++) {
        const wFalloff = halfW > 0 ? Math.max(0, 1 - Math.abs(dx) / (halfW + 0.5)) : 1;
        const pixA = Math.round(a * wFalloff);
        if (pixA < 2) continue;
        setPixel(buf, rcx + dx, baseY - step, pr, pg, pb, pixA);
      }
    }
  }
}

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

/** Draw faint dotted arcs between nearby motes that are within bonding range.
 *  These "proto-bonds" make the social gravity visible — viewers see two motes
 *  noticing each other before the bond snaps into existence. */
export function renderProtoAttractions(
  buf: ImageData,
  motes: Mote[],
  moteColors: Map<Mote, [number, number, number]>,
  time: number,
  phaseIndex: number,
): void {
  // Only show social gravity in bonding-active phases (exploration through complexity)
  if (phaseIndex < 1 || phaseIndex > 3) return;
  // Reduce visibility in exploration (bonding just starting)
  const phaseScale = phaseIndex === 1 ? 0.45 : 1.0;

  const ATTRACT_DIST = 20; // same as BOND_DIST in mote.ts

  for (let i = 0; i < motes.length; i++) {
    const a = motes[i];
    if (a.bonds.length >= 3) continue; // fully bonded

    for (let j = i + 1; j < motes.length; j++) {
      const b = motes[j];
      if (b.bonds.length >= 3) continue;
      if (a.bonds.includes(b)) continue; // already bonded — draw as bond line instead

      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist2 = dx * dx + dy * dy;
      if (dist2 > ATTRACT_DIST * ATTRACT_DIST) continue;

      const dist = Math.sqrt(dist2);
      const proximity = 1 - dist / ATTRACT_DIST; // 0 at edge, 1 at contact

      // Only show arc if at least one mote is actively pursuing a bond
      const seeking = a.bondTimer > 0 || b.bondTimer > 0;
      if (!seeking) continue;

      // Stronger arc when close and when bondTimer is high (bond about to form)
      const seekStrength = Math.min(1, Math.max(a.bondTimer, b.bondTimer) / 0.5);
      const baseAlpha = proximity * proximity * 38 * seekStrength * phaseScale;
      if (baseAlpha < 4) continue;

      // Average mote colors, slightly desaturated (attraction is uncertain, not committed)
      const [ar, ag, ab_] = moteColors.get(a)!;
      const [br, bg, bb] = moteColors.get(b)!;
      const mr = Math.round((ar + br) * 0.44 + 40); // desaturate toward light gray
      const mg = Math.round((ag + bg) * 0.44 + 40);
      const mb = Math.round((ab_ + bb) * 0.44 + 40);

      // Animated dotted line — dashes flow from a toward b
      const dashPeriod = 6; // pixels per dash cycle
      const dashFlow = (time * 18) % dashPeriod; // 18px/sec flow speed

      for (let s = 1; s < dist - 1; s++) {
        const dashPos = (s + dashFlow) % dashPeriod;
        if (dashPos > dashPeriod * 0.45) continue; // skip gaps (dashed)

        const t = s / dist;
        const px = a.x + dx * t;
        const py = a.y + dy * t;

        // Fade at ends so arcs don't visually overlap with mote sprites
        const endFade = Math.min(t / 0.25, (1 - t) / 0.25, 1);
        const alpha = Math.round(baseAlpha * endFade);
        if (alpha > 2) setPixel(buf, px, py, mr, mg, mb, alpha);
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
      // Old bonds breathe slowly — new bonds pulse fast. The pace of a relationship ages with it.
      const bondPulseHz = bondAge < 10 ? 5.0 : bondAge < 40 ? 2.5 : bondAge < 70 ? 1.0 : 0.35;
      const bondPulse = Math.sin(time * bondPulseHz + m.x * 0.05 + bonded.x * 0.05) * 0.15 + 0.85;
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

        // BOND FORMATION BURST — an expanding starburst that marks the moment of connection.
        // 12 spokes radiate outward as the flash decays, growing from 0→12px over 0.33 seconds.
        // White hot core fades first; colored rays linger; the bond then shines bright.
        {
          const midX = (m.x + bonded.x) / 2;
          const midY = (m.y + bonded.y) / 2;

          // Center bloom: tight bright circle strongest at bond formation
          const coreA = Math.round(flash * flash * 240);
          if (coreA > 3) {
            setPixel(buf, midX,     midY,     255, 255, 255, coreA);
            setPixel(buf, midX - 1, midY,     255, 255, 255, Math.round(coreA * 0.75));
            setPixel(buf, midX + 1, midY,     255, 255, 255, Math.round(coreA * 0.75));
            setPixel(buf, midX,     midY - 1, 255, 255, 255, Math.round(coreA * 0.75));
            setPixel(buf, midX,     midY + 1, 255, 255, 255, Math.round(coreA * 0.75));
          }

          // Expanding rays: grow from 0 → 12px as flash decays from 1 → 0.
          // 12 spokes at 30° intervals — wider than the old 8-spoke cross.
          const rayMaxLen = 12;
          const rayLen = rayMaxLen * (1 - flash); // 0 at fresh bond, grows outward
          if (rayLen > 0.5) {
            for (let si = 0; si < 12; si++) {
              const angle = (si / 12) * Math.PI * 2;
              const dx = Math.cos(angle);
              const dy = Math.sin(angle);
              for (let step = 1; step <= Math.ceil(rayLen); step++) {
                const t = step / rayMaxLen;           // 0 near center, 1 at tip
                const stepFrac = step / rayLen;       // 1 at the tip of current ray
                if (stepFrac > 1) continue;           // only draw up to current ray tip
                // White at center fading to mote blend color at tip
                const rr = Math.round(255 * (1 - t) + avgR * t);
                const rg = Math.round(255 * (1 - t) + avgG * t);
                const rb = Math.round(255 * (1 - t) + avgB * t);
                // Alpha: strong near center, fades toward tip, and fades with flash
                const tipFade = (1 - stepFrac) * (1 - stepFrac); // soft tip
                const ra = Math.round(flash * tipFade * (1 - t * 0.6) * 210);
                if (ra > 3) setPixel(buf, midX + dx * step, midY + dy * step, rr, rg, rb, ra);
              }
            }
          }
        }
      }

      // NEW BOND ECHO RING — a soft expanding ring that lingers for 2 seconds after a bond forms.
      // Gives viewers time to see where a new connection was made even if they blinked during the flash.
      // Radius: 2→14px over 2s. Alpha: fades from soft to gone.
      if (bondAge < 2.0) {
        const midX = (m.x + bonded.x) / 2;
        const midY = (m.y + bonded.y) / 2;
        const echoT = bondAge / 2.0;           // 0 → 1 over 2 seconds
        const echoR = 2 + echoT * 12;          // ring radius expands outward
        const echoA = Math.round((1 - echoT) * (1 - echoT) * 55); // quadratic fade
        if (echoA > 3) {
          const dotCount = Math.round(8 + echoT * 12); // more dots as ring expands
          for (let i = 0; i < dotCount; i++) {
            const angle = (i / dotCount) * Math.PI * 2;
            const ex = midX + Math.cos(angle) * echoR;
            const ey = midY + Math.sin(angle) * echoR;
            // Inner ring: white near bond formation, blending to mote color as it expands
            const rr = Math.round(255 * (1 - echoT) + avgR * echoT);
            const rg = Math.round(255 * (1 - echoT) + avgG * echoT);
            const rb = Math.round(255 * (1 - echoT) + avgB * echoT);
            setPixel(buf, ex, ey, rr, rg, rb, echoA);
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

/** Cluster cascade burst — when a community reaches 8+ members for the first time,
 *  an expanding ring of colored light emanates from the whole cluster, celebrating
 *  the moment a group becomes a civilization. Multiple concentric rings, long duration. */
export function renderCascadeBursts(
  buf: ImageData,
  bursts: Array<{ cx: number; cy: number; r: number; g: number; b: number; age: number }>,
): void {
  for (const b of bursts) {
    const age = b.age;
    if (age > 2.5) continue;

    // Three concentric rings expanding at different speeds — an orchestrated wave
    for (let wave = 0; wave < 3; wave++) {
      const delay = wave * 0.28;
      if (age < delay) continue;
      const wAge = age - delay;
      if (wAge > 2.0) continue;

      // Ring expands outward, fades as it goes
      const radius = 6 + wAge * 32; // 6→70 px over 2s
      const alpha = Math.max(0, (1 - wAge / 2.0));
      const ringA = Math.round(alpha * alpha * (wave === 0 ? 220 : wave === 1 ? 150 : 90));
      if (ringA < 4) continue;

      // Color: inner ring bright center-color, outer rings cool toward white
      const coolT = wave * 0.35;
      const pr = Math.min(255, Math.round(b.r * (1 - coolT) + 230 * coolT));
      const pg = Math.min(255, Math.round(b.g * (1 - coolT) + 235 * coolT));
      const pb = Math.min(255, Math.round(b.b * (1 - coolT) + 255 * coolT));

      const dotCount = Math.round(radius * 2.2);
      for (let i = 0; i < dotCount; i++) {
        const angle = (i / dotCount) * Math.PI * 2;
        const rx = b.cx + Math.cos(angle) * radius;
        const ry = b.cy + Math.sin(angle) * radius;
        setPixel(buf, rx, ry, pr, pg, pb, ringA);
        // Slightly thicker ring on first wave
        if (wave === 0 && ringA > 40) {
          setPixel(buf, rx, ry - 1, pr, pg, pb, Math.round(ringA * 0.45));
        }
      }
    }

    // Central bloom at moment of trigger (first 0.4s)
    if (age < 0.4) {
      const bloomT = 1 - age / 0.4;
      const bloomR = Math.round(bloomT * 14);
      for (let dy = -bloomR; dy <= bloomR; dy++) {
        for (let dx = -bloomR; dx <= bloomR; dx++) {
          const d2 = dx * dx + dy * dy;
          if (d2 > bloomR * bloomR) continue;
          const falloff = 1 - Math.sqrt(d2) / bloomR;
          const fa = Math.round(bloomT * falloff * falloff * 110);
          if (fa < 3) continue;
          setPixel(buf, b.cx + dx, b.cy + dy, b.r, b.g, b.b, fa);
        }
      }
      // White core flash
      const coreA = Math.round(bloomT * bloomT * 255);
      setPixel(buf, b.cx, b.cy, 255, 255, 255, coreA);
      setPixel(buf, b.cx - 1, b.cy, 255, 255, 255, Math.round(coreA * 0.55));
      setPixel(buf, b.cx + 1, b.cy, 255, 255, 255, Math.round(coreA * 0.55));
      setPixel(buf, b.cx, b.cy - 1, 255, 255, 255, Math.round(coreA * 0.55));
      setPixel(buf, b.cx, b.cy + 1, 255, 255, 255, Math.round(coreA * 0.55));
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

/** Soul wisps — the lingering presence of the dead, drifting gently above the terrain.
 *  After the spirit orb fades (3s), each death leaves a soft colored wisp that rises
 *  slowly and persists for ~50 seconds. By dissolution, the sky fills with the souls
 *  of every mote that has walked this world — a haunting, beautiful memorial.
 *  Fades during silence so the constellation can take over. */
export function renderSoulWisps(
  buf: ImageData,
  allDeaths: Array<{ x: number; y: number; r: number; g: number; b: number; time: number }>,
  phaseName: string,
  time: number,
): void {
  // Graceful hand-off to silence constellation — wisps fade out in silence phase
  const silenceMod = phaseName === "silence" ? 0.0 : 1.0;
  if (silenceMod <= 0) return;

  // Find graveyard centers: clusters of 3+ deaths within 20px.
  // Wisps from the same community slowly drift toward their shared resting place —
  // forming visible ghost-clouds above tragedy sites during dissolution.
  interface GraveyardCenter { x: number; y: number; strength: number; r: number; g: number; b: number }
  const graveyardCenters: GraveyardCenter[] = [];
  const gUsed = new Uint8Array(allDeaths.length);
  for (let i = 0; i < allDeaths.length; i++) {
    if (gUsed[i]) continue;
    const members = [allDeaths[i]];
    gUsed[i] = 1;
    for (let j = i + 1; j < allDeaths.length; j++) {
      if (gUsed[j]) continue;
      const ddx = allDeaths[j].x - allDeaths[i].x;
      const ddy = allDeaths[j].y - allDeaths[i].y;
      if (ddx * ddx + ddy * ddy < 20 * 20) { members.push(allDeaths[j]); gUsed[j] = 1; }
    }
    if (members.length < 3) continue;
    let gx = 0, gy = 0, gr = 0, gg = 0, gb = 0;
    for (const m of members) { gx += m.x; gy += m.y; gr += m.r; gg += m.g; gb += m.b; }
    gx /= members.length; gy /= members.length;
    graveyardCenters.push({
      x: gx,
      y: gy - 18,  // hover ~18px above the ground graveyard site
      strength: Math.min(1, members.length / 6),
      r: Math.round(gr / members.length),
      g: Math.round(gg / members.length),
      b: Math.round(gb / members.length),
    });
  }

  for (const d of allDeaths) {
    const age = time - d.time;
    // Starts as spirit orb ends; fades toward silence hand-off
    if (age < 3.0 || age > 55.0) continue;

    // Fade envelope: materializes over 3s, fades over last 10s
    const fadeIn  = Math.min(1, (age - 3.0) / 3.0);
    const fadeOut = age > 45.0 ? 1.0 - (age - 45.0) / 10.0 : 1.0;
    const life = fadeIn * fadeOut * silenceMod;
    if (life < 0.01) continue;

    // Eased rise: climbs ~22px above death position, most movement in first 15s
    const rise = 22 * (1 - Math.exp(-(age - 3.0) / 14.0));
    // Gentle drift: slow sine sway unique to each soul
    const sway = Math.sin((age - 3.0) * 0.38 + d.x * 0.17) * 2.4;

    let wx = d.x + sway;
    let wy = d.y - rise - 1;

    // Graveyard pull — wisps feel the gravity of their community's resting place.
    // The pull strengthens as the wisp matures (they've had time to drift together).
    // Wisps converge into a visible ghost-cluster above where their kind fell.
    const pullMaturity = Math.min(1, (age - 3.0) / 16.0); // 0→1 over first 16s
    for (const gc of graveyardCenters) {
      const ddx = gc.x - wx;
      const ddy = gc.y - wy;
      const d2 = ddx * ddx + ddy * ddy;
      if (d2 < 38 * 38 && d2 > 1) {
        const dist = Math.sqrt(d2);
        const force = gc.strength * 3.0 * pullMaturity / (dist * 0.18 + 1);
        wx += (ddx / dist) * Math.min(force, 7);
        wy += (ddy / dist) * Math.min(force, 4);
      }
    }

    // Slow shimmer — each soul breathes at its own pace
    const shimmer = Math.sin(time * 0.72 + d.x * 0.19 + d.y * 0.11) * 0.25 + 0.75;

    // Spectral tint: shift mote color slightly toward cool blue-white (the other side)
    const tint = 0.28;
    let wr = Math.round(d.r * (1 - tint) + 148 * tint);
    let wg = Math.round(d.g * (1 - tint) + 168 * tint);
    let wb = Math.round(d.b * (1 - tint) + 220 * tint);

    // Color communion — wisps near a graveyard center subtly blend toward their community hue.
    // A ghost-cluster glows with the shared identity of those who fell together.
    for (const gc of graveyardCenters) {
      const ddx = gc.x - wx;
      const ddy = gc.y - wy;
      const d2 = ddx * ddx + ddy * ddy;
      if (d2 < 12 * 12) {
        const communion = 0.20 * (1 - Math.sqrt(d2) / 12) * pullMaturity;
        wr = Math.round(wr * (1 - communion) + gc.r * communion);
        wg = Math.round(wg * (1 - communion) + gc.g * communion);
        wb = Math.round(wb * (1 - communion) + gc.b * communion);
      }
    }

    const maxA = 60;
    const alpha = Math.round(maxA * life * shimmer);
    if (alpha < 2) continue;

    // Core pixel + soft cross halo — small enough to feel ethereal, feeds bloom pass
    setPixel(buf, wx,     wy,     wr, wg, wb, alpha);
    setPixel(buf, wx - 1, wy,     wr, wg, wb, Math.round(alpha * 0.60));
    setPixel(buf, wx + 1, wy,     wr, wg, wb, Math.round(alpha * 0.60));
    setPixel(buf, wx,     wy - 1, wr, wg, wb, Math.round(alpha * 0.48));
    setPixel(buf, wx,     wy + 1, wr, wg, wb, Math.round(alpha * 0.38));
    // Outer glow pixels: faint enough to stay ghostly, bright enough for bloom
    setPixel(buf, wx - 2, wy,     wr, wg, wb, Math.round(alpha * 0.24));
    setPixel(buf, wx + 2, wy,     wr, wg, wb, Math.round(alpha * 0.24));
    setPixel(buf, wx,     wy - 2, wr, wg, wb, Math.round(alpha * 0.20));
    setPixel(buf, wx,     wy + 2, wr, wg, wb, Math.round(alpha * 0.14));
    // Extended outer ring: just enough to create a soft luminous presence
    setPixel(buf, wx - 3, wy,     wr, wg, wb, Math.round(alpha * 0.10));
    setPixel(buf, wx + 3, wy,     wr, wg, wb, Math.round(alpha * 0.10));
    setPixel(buf, wx,     wy - 3, wr, wg, wb, Math.round(alpha * 0.08));
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

/** Silence graveyard rings — faint memorial circles at sites where communities fell together.
 *  When many motes died near the same location, a soft ring appears in silence marking
 *  the footprint of the cluster that once lived there. Ruins of civilization. */
export function renderSilenceGraveyards(
  buf: ImageData,
  allDeaths: Array<{ x: number; y: number; r: number; g: number; b: number }>,
  phaseName: string,
  motesCount: number,
  time: number,
  phaseProgress: number,
): void {
  if (phaseName !== "silence" || motesCount > 0 || allDeaths.length < 4) return;

  // Reveal with same smoothstep as constellation
  const revealRaw = Math.min(1, phaseProgress * 3.0);
  const revealFade = revealRaw * revealRaw * (3 - 2 * revealRaw);
  if (revealFade < 0.02) return;

  // Group nearby deaths with simple greedy sweep (O(n²) — n is small, ~20–60)
  const used = new Uint8Array(allDeaths.length);
  for (let i = 0; i < allDeaths.length; i++) {
    if (used[i]) continue;
    const group: typeof allDeaths = [allDeaths[i]];
    used[i] = 1;

    for (let j = i + 1; j < allDeaths.length; j++) {
      if (used[j]) continue;
      const dx = allDeaths[j].x - allDeaths[i].x;
      const dy = allDeaths[j].y - allDeaths[i].y;
      if (dx * dx + dy * dy < 20 * 20) {
        group.push(allDeaths[j]);
        used[j] = 1;
      }
    }

    if (group.length < 4) continue; // only communities of 4+ leave a ring

    // Centroid and averaged hue
    let gx = 0, gy = 0, gr = 0, gg = 0, gb = 0;
    for (const d of group) { gx += d.x; gy += d.y; gr += d.r; gg += d.g; gb += d.b; }
    gx /= group.length; gy /= group.length;
    gr = Math.round(gr / group.length);
    gg = Math.round(gg / group.length);
    gb = Math.round(gb / group.length);

    // Ring radius scales with group size
    const ringR = Math.min(22, 5 + group.length * 1.8);

    // Slow, mournful breath
    const breathe = Math.sin(time * 0.20 + gx * 0.11) * 0.20 + 0.80;
    const baseAlpha = Math.round(16 * breathe * revealFade);
    if (baseAlpha < 2) continue;

    // Ghost-tinted: group color faded toward cold pale
    const ghostR = Math.round(gr * 0.30 + 148 * 0.70);
    const ghostG = Math.round(gg * 0.30 + 140 * 0.70);
    const ghostB = Math.round(gb * 0.30 + 162 * 0.70);

    // Dashed ring — a broken circle, like a community that no longer holds
    const dotCount = Math.max(14, Math.round(ringR * 2.8));
    for (let k = 0; k < dotCount; k++) {
      if (k % 5 === 4) continue; // gap every 5th dot
      const angle = (k / dotCount) * Math.PI * 2;
      const rx = Math.round(gx + Math.cos(angle) * ringR);
      const ry = Math.round(gy + Math.sin(angle) * ringR);
      setPixel(buf, rx, ry - 1, ghostR, ghostG, ghostB, baseAlpha);
    }

    // Faint center cross — where the hearth was
    const cx = Math.round(gx);
    const cy = Math.round(gy) - 1;
    const ca = Math.round(baseAlpha * 0.45);
    if (ca > 2) {
      setPixel(buf, cx, cy, ghostR, ghostG, ghostB, ca);
      setPixel(buf, cx - 1, cy, ghostR, ghostG, ghostB, Math.round(ca * 0.55));
      setPixel(buf, cx + 1, cy, ghostR, ghostG, ghostB, Math.round(ca * 0.55));
    }
  }
}

/** Spirit ascension stars — each mote death sends a star rising to the sky.
 *  Visible from dissolution onward. The sky gradually fills with memorial lights
 *  as the world's population dies, then gently fades as silence deepens.
 *  Stars are positioned deterministically above their death site.
 *  During silence, nearby stars are connected with soft constellation lines. */
export function renderSpiritAscension(
  buf: ImageData,
  allDeaths: Array<{ x: number; y: number; r: number; g: number; b: number; time: number }>,
  phaseIndex: number,
  phaseProgress: number,
  time: number,
): void {
  if (phaseIndex < 4 || allDeaths.length === 0) return;

  // Dissolution: stars fade in as phaseProgress grows.
  // Silence: fully visible, then fade out at the very end.
  let globalAlpha: number;
  if (phaseIndex === 4) {
    // Dissolution: reveal over the whole phase
    globalAlpha = phaseProgress * phaseProgress; // ease in
  } else {
    // Silence: stay visible, fade out in last 20%
    const fadeOut = phaseProgress > 0.80 ? Math.max(0, 1 - (phaseProgress - 0.80) / 0.20) : 1.0;
    globalAlpha = fadeOut;
  }
  if (globalAlpha < 0.02) return;

  // Collect star positions for constellation line pass (silence only)
  type StarInfo = { x: number; y: number; r: number; g: number; b: number };
  const stars: StarInfo[] = phaseIndex === 5 ? [] : (null as unknown as StarInfo[]);

  for (let i = 0; i < allDeaths.length; i++) {
    const d = allDeaths[i];

    // Deterministic sky position from death location (no rng — must be stable frame-to-frame)
    // Hash X and Y to get a consistent sky Y position in range [4, 36]
    const hashVal = (((Math.round(d.x) * 2654435761) ^ (Math.round(d.y) * 1234567891)) >>> 0) & 255;
    const starY = 4 + (hashVal % 32);
    const starX = Math.round(d.x);

    // Stars stagger in: each death appears after a brief delay in dissolution
    // In silence, all stars are present from start
    let starVisibility = globalAlpha;
    if (phaseIndex === 4) {
      // Each star fades in individually: earlier deaths appear sooner
      const deathFrac = i / Math.max(1, allDeaths.length - 1);
      starVisibility = Math.max(0, globalAlpha - deathFrac * 0.3);
    }
    if (starVisibility < 0.02) continue;

    // Twinkle: unique rate per star
    const twinkleRate = 1.5 + (hashVal % 17) * 0.18;
    const twinkle = Math.sin(time * twinkleRate + i * 2.37 + d.x * 0.11) * 0.28 + 0.72;

    // Recent deaths shine brighter, older deaths dim to anonymous white
    // Boosted 3× vs before so stars are unmissable even against bright golden-hour sky
    const recency = i / Math.max(1, allDeaths.length - 1);
    const baseA = Math.round((60 + recency * 95) * starVisibility * twinkle);
    if (baseA < 3) continue;

    // Color: retain mote's identity color, fading toward pale silver for older deaths
    const colorHold = 0.20 + recency * 0.55;
    const silverR = 190, silverG = 188, silverB = 210;
    const sr = Math.round(d.r * colorHold + silverR * (1 - colorHold));
    const sg = Math.round(d.g * colorHold + silverG * (1 - colorHold));
    const sb = Math.round(d.b * colorHold + silverB * (1 - colorHold));

    // Star shape: bright center + cross arms + wider glow at peak brightness
    setPixel(buf, starX,     starY,     sr, sg, sb, baseA);
    setPixel(buf, starX - 1, starY,     sr, sg, sb, Math.round(baseA * 0.45));
    setPixel(buf, starX + 1, starY,     sr, sg, sb, Math.round(baseA * 0.45));
    setPixel(buf, starX,     starY - 1, sr, sg, sb, Math.round(baseA * 0.50));
    setPixel(buf, starX,     starY + 1, sr, sg, sb, Math.round(baseA * 0.35));
    // Diagonal soft glow for brighter stars
    if (baseA > 40) {
      const diagA = Math.round(baseA * 0.18);
      setPixel(buf, starX - 1, starY - 1, sr, sg, sb, diagA);
      setPixel(buf, starX + 1, starY - 1, sr, sg, sb, diagA);
      setPixel(buf, starX - 1, starY + 1, sr, sg, sb, diagA);
      setPixel(buf, starX + 1, starY + 1, sr, sg, sb, diagA);
    }

    // Elder deaths (recency top 30%) get a warm sparkle at peak twinkle
    if (recency > 0.70 && twinkle > 0.88) {
      const sparkA = Math.round(baseA * 1.4);
      if (sparkA > 8) setPixel(buf, starX, starY, 245, 240, 255, Math.min(220, sparkA));
    }

    // Collect for constellation pass
    if (stars) stars.push({ x: starX, y: starY, r: sr, g: sg, b: sb });
  }

  // ── Constellation lines ────────────────────────────────────────────────────
  // During silence, soft lines connect nearby spirit stars — the dead forming
  // patterns in the sky, a map of relationships that persisted beyond life.
  // Lines fade in after the first 20% of silence so stars appear first.
  if (stars && stars.length > 1) {
    const lineRevealRaw = Math.min(1, Math.max(0, (phaseProgress - 0.20) / 0.35));
    const lineReveal = lineRevealRaw * lineRevealRaw * (3 - 2 * lineRevealRaw); // smoothstep
    const constellBreath = Math.sin(time * 0.22) * 0.12 + 0.88;
    const lineAlphaBase = Math.round(lineReveal * 20 * globalAlpha * constellBreath);

    if (lineAlphaBase > 1) {
      const MAX_DIST = 28;
      const MAX_DIST_SQ = MAX_DIST * MAX_DIST;
      for (let i = 0; i < stars.length; i++) {
        for (let j = i + 1; j < stars.length; j++) {
          const dx = stars[j].x - stars[i].x;
          const dy = stars[j].y - stars[i].y;
          const dist2 = dx * dx + dy * dy;
          if (dist2 > MAX_DIST_SQ) continue;

          const strength = 1 - Math.sqrt(dist2) / MAX_DIST;
          const lineA = Math.round(lineAlphaBase * strength);
          if (lineA < 2) continue;

          // Line color: blend of both stars' identities, cooled toward pale cyan
          const lr = Math.round((stars[i].r + stars[j].r) * 0.32 + 175 * 0.36);
          const lg = Math.round((stars[i].g + stars[j].g) * 0.32 + 188 * 0.36);
          const lb = Math.round((stars[i].b + stars[j].b) * 0.32 + 225 * 0.36);

          drawLine(buf, stars[i].x, stars[i].y, stars[j].x, stars[j].y, lr, lg, lb, lineA);
        }
      }
    }
  }
}
