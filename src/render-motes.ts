// render-motes.ts — Mote sprite drawing: body, eyes, elder crown, effects.

import type { Mote, BiomePalette } from "./types";
import { setPixel } from "./render";
import { hsl2rgb } from "./palette";

/** Each mote gets a unique hue from its temperament fingerprint.
 *  Energy drives luminosity, age shifts toward warm gold. */
export function computeMoteColor(m: Mote, _bp: BiomePalette): [number, number, number] {
  const hue = (
    m.temperament.wanderlust * 50 +
    m.temperament.sociability * 160 + 40 +
    m.temperament.hardiness * 60
  ) % 360;

  const sat = 0.45 + m.temperament.sociability * 0.35 + m.energy * 0.15;
  const hardyBoost = m.temperament.hardiness * 0.08 * (1 - m.energy);
  const light = 0.30 + (m.energy + hardyBoost) * 0.38;

  let [r, g, b] = hsl2rgb(hue, Math.min(1, sat), Math.min(0.72, light));

  // Age: elders shift toward warm gold
  const ageGold = Math.min(1, Math.max(0, (m.age - 8) / 22)) * 0.40;
  r += (220 - r) * ageGold;
  g += (165 - g) * ageGold;
  b += (40 - b) * ageGold;

  return [Math.round(r), Math.round(g), Math.round(b)];
}

/** Render trails for all motes */
export function renderMoteTrails(
  buf: ImageData,
  motes: Mote[],
  moteColors: Map<Mote, [number, number, number]>,
): void {
  for (const m of motes) {
    const [tr, tg, tb] = moteColors.get(m)!;
    // Wanderers leave vivid ghost trails; social/hardy motes leave faint smears
    const trailScale = 0.2 + m.temperament.wanderlust * 1.8;
    for (const pt of m.trail) {
      const ta = Math.round((1 - pt.age / 2.0) * 35 * trailScale);
      if (ta > 2) setPixel(buf, pt.x, pt.y, tr, tg, tb, ta);
    }
  }
}

/** Render all mote sprites */
export function renderMotes(
  buf: ImageData,
  motes: Mote[],
  moteColors: Map<Mote, [number, number, number]>,
  plagueActive: boolean,
  plaguePulse: number,
  time: number,
): void {
  for (const m of motes) {
    let [cr, cg, cb] = moteColors.get(m)!;

    // Plague visual
    if (plagueActive && m.bonds.length > 0 && plaguePulse > 0.3) {
      const tint = (plaguePulse - 0.3) * 0.4;
      cr = Math.round(cr * (1 - tint));
      cg = Math.round(Math.min(255, cg + 40 * tint));
      cb = Math.round(cb * (1 - tint * 0.5));
    }

    const isElder = m.age > 20;
    const breathe = Math.sin(m.age * 2.5 + m.temperament.wanderlust * 6.28) * 0.15 + 0.85;

    const ox = Math.round(m.x);
    const oy = Math.round(m.y);
    const dir = m.direction;

    // Brighter core color
    const lr = Math.min(255, Math.round(cr * 1.4));
    const lg = Math.min(255, Math.round(cg * 1.4));
    const lb = Math.min(255, Math.round(cb * 1.4));

    // DARK OUTLINE
    setPixel(buf, ox - 1, oy - 3, 4, 4, 8, 200);
    setPixel(buf, ox, oy - 3, 4, 4, 8, 200);
    setPixel(buf, ox + 1, oy - 3, 4, 4, 8, 200);
    setPixel(buf, ox - 2, oy - 2, 4, 4, 8, 200);
    setPixel(buf, ox + 2, oy - 2, 4, 4, 8, 200);
    setPixel(buf, ox - 3, oy - 1, 4, 4, 8, 180);
    setPixel(buf, ox + 3, oy - 1, 4, 4, 8, 180);
    setPixel(buf, ox - 3, oy, 4, 4, 8, 180);
    setPixel(buf, ox + 3, oy, 4, 4, 8, 180);
    setPixel(buf, ox - 2, oy + 1, 4, 4, 8, 160);
    setPixel(buf, ox, oy + 1, 4, 4, 8, 160);
    setPixel(buf, ox + 2, oy + 1, 4, 4, 8, 160);
    setPixel(buf, ox - 1, oy + 2, 4, 4, 8, 140);
    setPixel(buf, ox + 1, oy + 2, 4, 4, 8, 140);

    // TRANSLUCENT BODY
    const headA = Math.round(140 * breathe);
    setPixel(buf, ox - 1, oy - 2, cr, cg, cb, Math.round(headA * 0.7));
    setPixel(buf, ox, oy - 2, lr, lg, lb, headA);
    setPixel(buf, ox + 1, oy - 2, cr, cg, cb, Math.round(headA * 0.7));

    const faceA = Math.round(160 * breathe);
    setPixel(buf, ox - 2, oy - 1, cr, cg, cb, Math.round(faceA * 0.45));
    setPixel(buf, ox - 1, oy - 1, cr, cg, cb, Math.round(faceA * 0.8));
    setPixel(buf, ox, oy - 1, lr, lg, lb, faceA);
    setPixel(buf, ox + 1, oy - 1, cr, cg, cb, Math.round(faceA * 0.8));
    setPixel(buf, ox + 2, oy - 1, cr, cg, cb, Math.round(faceA * 0.45));

    // GLOWING EYES
    const blinkCycle = Math.sin(m.age * 0.8 + m.temperament.sociability * 10);
    const eyeOpen = blinkCycle > -0.92;
    if (eyeOpen) {
      const eyePulse = Math.sin(m.age * 3 + m.x * 0.1) * 0.15 + 0.85;
      const eyeBright = Math.round(240 * eyePulse);
      const eyeR = Math.min(255, Math.round(cr * 0.3 + 180));
      const eyeG = Math.min(255, Math.round(cg * 0.3 + 180));
      const eyeB = Math.min(255, Math.round(cb * 0.3 + 180));
      if (dir > 0) {
        setPixel(buf, ox, oy - 1, eyeR, eyeG, eyeB, eyeBright);
        setPixel(buf, ox + 1, oy - 1, eyeR, eyeG, eyeB, eyeBright);
      } else {
        setPixel(buf, ox - 1, oy - 1, eyeR, eyeG, eyeB, eyeBright);
        setPixel(buf, ox, oy - 1, eyeR, eyeG, eyeB, eyeBright);
      }
    }

    // TORSO
    const bodyA = Math.round(100 * breathe);
    setPixel(buf, ox - 2, oy, cr, cg, cb, Math.round(bodyA * 0.3));
    setPixel(buf, ox - 1, oy, cr, cg, cb, Math.round(bodyA * 0.7));
    setPixel(buf, ox, oy, lr, lg, lb, bodyA);
    setPixel(buf, ox + 1, oy, cr, cg, cb, Math.round(bodyA * 0.7));
    setPixel(buf, ox + 2, oy, cr, cg, cb, Math.round(bodyA * 0.3));

    // FEET
    const walkBob = m.grounded && Math.abs(m.vx) > 2;
    const stepPhase = Math.sin(m.age * 12) > 0;
    const footA = Math.round(65 * breathe);
    if (walkBob) {
      const frontFoot = stepPhase ? -1 : 1;
      setPixel(buf, ox + frontFoot, oy + 1, cr, cg, cb, footA);
      setPixel(buf, ox - frontFoot, oy + 1, cr, cg, cb, Math.round(footA * 0.5));
    } else {
      setPixel(buf, ox - 1, oy + 1, cr, cg, cb, footA);
      setPixel(buf, ox + 1, oy + 1, cr, cg, cb, footA);
    }

    // INNER GLOW
    const heartPulse = Math.sin(m.age * 4 + m.temperament.hardiness * 5) * 0.3 + 0.7;
    const heartA = Math.round(180 * heartPulse * m.energy);
    setPixel(buf, ox, oy - 1, lr, lg, lb, heartA);

    // ELDER CROWN
    if (isElder) {
      const elderGlow = Math.sin(m.age * 1.5) * 0.15 + 0.85;
      const ga = Math.round(160 * elderGlow);
      setPixel(buf, ox, oy - 3, 210, 180, 60, ga);
      setPixel(buf, ox - 1, oy - 3, 210, 180, 60, Math.round(ga * 0.5));
      setPixel(buf, ox + 1, oy - 3, 210, 180, 60, Math.round(ga * 0.5));
    }

    // WALKING DUST
    if (m.grounded && Math.abs(m.vx) > 4 && m.age > 0.3) {
      const dustFlicker = Math.sin(m.age * 20 + m.x) > 0.3;
      if (dustFlicker) {
        setPixel(buf, ox - dir * 2, oy + 1, 160, 150, 130, 30);
      }
    }

    // LOW ENERGY
    if (m.energy < 0.2 && m.energy > 0) {
      const flicker = Math.sin(m.age * 15) > 0 ? 0.4 : 1.0;
      if (flicker < 1) {
        setPixel(buf, ox, oy, 0, 0, 0, Math.round((1 - flicker) * 60));
        setPixel(buf, ox, oy - 1, 0, 0, 0, Math.round((1 - flicker) * 40));
      }
    }

    // BOND-SEEKING GLOW
    if (m.bondTimer > 0.3 && m.bondFlash === 0) {
      const seekPulse = Math.sin(m.age * 8) * 0.5 + 0.5;
      const sa = Math.round(seekPulse * 45);
      setPixel(buf, ox, oy - 3, lr, lg, lb, sa);
      setPixel(buf, ox - 1, oy - 3, lr, lg, lb, Math.round(sa * 0.4));
      setPixel(buf, ox + 1, oy - 3, lr, lg, lb, Math.round(sa * 0.4));
    }

    // SOCIAL RESONANCE — bonded social motes pulse in sync with global time
    if (m.bonds.length > 0 && m.temperament.sociability > 0.45) {
      const resonance = (m.temperament.sociability - 0.45) / 0.55; // 0 → 1
      const syncPulse = Math.sin(time * 3.5) * 0.5 + 0.5;
      const ra = Math.round(syncPulse * resonance * 48);
      if (ra > 3) {
        setPixel(buf, ox + 4, oy - 1, cr, cg, cb, ra);
        setPixel(buf, ox - 4, oy - 1, cr, cg, cb, ra);
        setPixel(buf, ox,     oy - 5, cr, cg, cb, Math.round(ra * 0.8));
        setPixel(buf, ox + 3, oy + 2, cr, cg, cb, Math.round(ra * 0.5));
        setPixel(buf, ox - 3, oy + 2, cr, cg, cb, Math.round(ra * 0.5));
      }
    }

    // BOND FORMATION FLASH
    if (m.bondFlash > 0) {
      const fi = m.bondFlash * m.bondFlash;
      const fa = Math.round(fi * 220);
      const fa2 = Math.round(fi * 70);
      for (let dx = -3; dx <= 3; dx++) {
        for (let dy = -4; dy <= 3; dy++) {
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist >= 3 && dist <= 4) {
            setPixel(buf, ox + dx, oy - 1 + dy, lr, lg, lb, fa2);
          }
        }
      }
      setPixel(buf, ox - 1, oy - 1, 255, 255, 255, fa);
      setPixel(buf, ox + 1, oy - 1, 255, 255, 255, fa);
    }

    // BOND BREAK SCATTER — 6 colored shards flying outward + brief dark core flash
    if (m.bondBreakFlash > 0) {
      const bf = m.bondBreakFlash * m.bondBreakFlash; // ease out
      const shardA = Math.round(bf * 210);
      const shardA2 = Math.round(bf * 130);
      // Six shards in asymmetric star pattern — feels like a crack, not a perfect burst
      setPixel(buf, ox - 4, oy - 1, cr, cg, cb, shardA2);
      setPixel(buf, ox + 4, oy - 1, cr, cg, cb, shardA2);
      setPixel(buf, ox - 2, oy - 4, lr, lg, lb, shardA);
      setPixel(buf, ox + 2, oy - 4, lr, lg, lb, shardA);
      setPixel(buf, ox - 3, oy + 2, cr, cg, cb, shardA2);
      setPixel(buf, ox + 3, oy + 2, cr, cg, cb, shardA2);
      // Dim center: the bond hole left behind
      setPixel(buf, ox, oy - 1, 10, 10, 25, Math.round(m.bondBreakFlash * 140));
    }

    // SPAWN MATERIALIZATION
    if (m.spawnFlash > 0) {
      const sf = m.spawnFlash * m.spawnFlash;
      const radius = Math.round(3 + (1 - sf) * 4);
      const sa = Math.round(sf * 130);
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dy = -radius; dy <= radius; dy++) {
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist >= radius - 1 && dist <= radius) {
            setPixel(buf, ox + dx, oy - 1 + dy, lr, lg, lb, sa);
          }
        }
      }
    }
  }
}
