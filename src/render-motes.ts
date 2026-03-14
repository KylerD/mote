// render-motes.ts — Mote sprite drawing: body, eyes, elder crown, effects.

import type { Mote, BiomePalette } from "./types";
import { setPixel } from "./render";
import { hsl2rgb } from "./palette";

/** Each mote gets a unique hue from its temperament fingerprint.
 *  Energy drives luminosity, age shifts toward warm gold. */
export function computeMoteColor(m: Mote, _bp: BiomePalette): [number, number, number] {
  // Spread hue across full spectrum — wanderlust=warm, sociability=cool, hardiness=offset
  const hue = (
    m.temperament.wanderlust * 120 +
    m.temperament.sociability * 200 +
    m.temperament.hardiness * 80 + 30
  ) % 360;

  const sat = 0.65 + m.temperament.sociability * 0.30;
  const light = 0.50 + m.energy * 0.25;

  let [r, g, b] = hsl2rgb(hue, Math.min(1, sat), Math.min(0.78, light));

  // Age: elders shift toward warm gold
  const ageGold = Math.min(1, Math.max(0, (m.age - 8) / 22)) * 0.40;
  r += (220 - r) * ageGold;
  g += (165 - g) * ageGold;
  b += (40 - b) * ageGold;

  // Brightness floor — motes must never blend into dark terrain
  r = Math.max(125, r);
  g = Math.max(125, g);
  b = Math.max(125, b);

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
    // Trail lifetime mirrors mote.ts: elder wanderers remember longer (1.5s–6.0s)
    const trailAgeFactor = Math.min(1, m.age / 30);
    const trailMaxAge = 1.5 + m.temperament.wanderlust * (1.5 + trailAgeFactor * 3.0);
    const isWanderer = m.temperament.wanderlust > 0.6;

    // WANDERER FRENZY: dying wanderers leave hot red-orange trails — final frantic running
    const dp = (isWanderer && m.energy < 0.3 && m.energy > 0)
      ? Math.max(0, 1 - m.energy / 0.3)
      : 0;
    // Blend from mote color toward emergency red-orange as energy drains
    const ftr = dp > 0 ? Math.round(tr * (1 - dp * 0.55) + 245 * dp * 0.55) : tr;
    const ftg = dp > 0 ? Math.round(tg * (1 - dp * 0.80) + 50 * dp * 0.80) : tg;
    const ftb = dp > 0 ? Math.round(tb * (1 - dp * 0.90) + 15 * dp * 0.90) : tb;
    // Dying wanderers trail brighter — the last run is the most vivid
    const frenziedScale = dp > 0 ? trailScale * (1 + dp * 0.7) : trailScale;

    for (const pt of m.trail) {
      const ageFrac = pt.age / trailMaxAge;

      if (isWanderer && pt.age > 1.5) {
        // Ghost window: mote color bleeds into warm earth — trail sinking into the ground.
        // The landscape remembers where they walked.
        const ghostWindow = Math.max(0.1, trailMaxAge - 1.5);
        const ghostT = Math.min(1, (pt.age - 1.5) / ghostWindow);
        // Warm dusty earth tone (unchanged — ghost always bleeds into ground)
        const er = 115, eg = 98, eb = 72;
        const gr = Math.round(ftr * (1 - ghostT) + er * ghostT);
        const gg = Math.round(ftg * (1 - ghostT) + eg * ghostT);
        const gb = Math.round(ftb * (1 - ghostT) + eb * ghostT);
        const ta = Math.round((1 - ageFrac) * 22 * frenziedScale);
        if (ta > 1) setPixel(buf, pt.x, pt.y, gr, gg, gb, ta);
      } else {
        const ta = Math.round((1 - ageFrac) * 35 * frenziedScale);
        if (ta > 2) setPixel(buf, pt.x, pt.y, ftr, ftg, ftb, ta);
      }
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
  phaseIndex = 3,
  clusterHeartbeat: Map<Mote, number> = new Map(),
): void {
  // Night phases: 0=genesis (pre-dawn), 5=silence (post-dusk).
  // In darkness, motes emit a soft ambient halo — they look like tiny lanterns.
  // The glow feeds into the bloom pass, creating a warm colored aureole.
  const nightGlowMax = (phaseIndex === 0 || phaseIndex === 5) ? 28 : 0;

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
    // Breathe only affects aura/glow, not core body
    const breathe = Math.sin(m.age * 2.5 + m.temperament.wanderlust * 6.28) * 0.15 + 0.85;

    const ox = Math.round(m.x);
    const oy = Math.round(m.y);
    const dir = m.direction;

    // NIGHT LANTERN GLOW — in dark phases, each mote emits a soft colored halo.
    // Drawn before the body so the sprite renders on top, leaving a warm outer ring.
    // Scales with energy: dying motes flicker dimmer, full-energy motes burn brightest.
    if (nightGlowMax > 0) {
      const gPulse = Math.sin(m.age * 1.6 + m.x * 0.14) * 0.22 + 0.78;
      const gA = Math.round(nightGlowMax * gPulse * Math.max(0.45, m.energy));
      if (gA > 3) {
        for (let dgy = -7; dgy <= 7; dgy++) {
          for (let dgx = -7; dgx <= 7; dgx++) {
            const d2 = dgx * dgx + dgy * dgy;
            if (d2 > 49) continue; // radius 7
            const fall = 1 - Math.sqrt(d2) / 7;
            const ga = Math.round(gA * fall * fall);
            if (ga > 1) setPixel(buf, ox + dgx, oy - 1 + dgy, cr, cg, cb, ga);
          }
        }
      }
    }

    // WANDERER LEAN — high-wanderlust motes tilt head forward when moving fast
    // lean=±1 shifts head/neck pixels in movement direction; body/feet stay planted
    const lean = (m.temperament.wanderlust > 0.65 && Math.abs(m.vx) > 2.5)
      ? dir
      : 0;

    // Brighter core color
    const lr = Math.min(255, Math.round(cr * 1.55));
    const lg = Math.min(255, Math.round(cg * 1.55));
    const lb = Math.min(255, Math.round(cb * 1.55));

    // DARK OUTLINE — head area shifts with lean; body/feet anchored
    setPixel(buf, ox - 1 + lean, oy - 3, 4, 4, 8, 245);
    setPixel(buf, ox + lean,     oy - 3, 4, 4, 8, 245);
    setPixel(buf, ox + 1 + lean, oy - 3, 4, 4, 8, 245);
    setPixel(buf, ox - 2 + lean, oy - 2, 4, 4, 8, 245);
    setPixel(buf, ox + 2 + lean, oy - 2, 4, 4, 8, 245);
    setPixel(buf, ox - 3, oy - 1, 4, 4, 8, 230);
    setPixel(buf, ox + 3, oy - 1, 4, 4, 8, 230);
    setPixel(buf, ox - 3, oy, 4, 4, 8, 230);
    setPixel(buf, ox + 3, oy, 4, 4, 8, 230);
    setPixel(buf, ox - 2, oy + 1, 4, 4, 8, 220);
    setPixel(buf, ox, oy + 1, 4, 4, 8, 220);
    setPixel(buf, ox + 2, oy + 1, 4, 4, 8, 220);
    setPixel(buf, ox - 1, oy + 2, 4, 4, 8, 200);
    setPixel(buf, ox + 1, oy + 2, 4, 4, 8, 200);

    // HEAD — shifts with lean
    setPixel(buf, ox - 1 + lean, oy - 2, cr, cg, cb, 180);
    setPixel(buf, ox + lean,     oy - 2, lr, lg, lb, 240);
    setPixel(buf, ox + 1 + lean, oy - 2, cr, cg, cb, 180);

    // FACE — shifts with lean
    setPixel(buf, ox - 2, oy - 1, cr, cg, cb, 120);
    setPixel(buf, ox - 1 + lean, oy - 1, cr, cg, cb, 210);
    setPixel(buf, ox + lean,     oy - 1, lr, lg, lb, 245);
    setPixel(buf, ox + 1 + lean, oy - 1, cr, cg, cb, 210);
    setPixel(buf, ox + 2, oy - 1, cr, cg, cb, 120);

    // GLOWING EYES — follow the lean
    const blinkCycle = Math.sin(m.age * 0.8 + m.temperament.sociability * 10);
    const eyeOpen = blinkCycle > -0.92;
    if (eyeOpen) {
      const eyePulse = Math.sin(m.age * 3 + m.x * 0.1) * 0.15 + 0.85;
      const eyeBright = Math.round(250 * eyePulse);
      const eyeR = Math.min(255, Math.round(cr * 0.3 + 180));
      const eyeG = Math.min(255, Math.round(cg * 0.3 + 180));
      const eyeB = Math.min(255, Math.round(cb * 0.3 + 180));
      if (dir > 0) {
        setPixel(buf, ox + lean,     oy - 1, eyeR, eyeG, eyeB, eyeBright);
        setPixel(buf, ox + 1 + lean, oy - 1, eyeR, eyeG, eyeB, eyeBright);
      } else {
        setPixel(buf, ox - 1 + lean, oy - 1, eyeR, eyeG, eyeB, eyeBright);
        setPixel(buf, ox + lean,     oy - 1, eyeR, eyeG, eyeB, eyeBright);
      }
    }

    // TORSO — solid core
    setPixel(buf, ox - 2, oy, cr, cg, cb, 100);
    setPixel(buf, ox - 1, oy, cr, cg, cb, 200);
    setPixel(buf, ox, oy, lr, lg, lb, 240);
    setPixel(buf, ox + 1, oy, cr, cg, cb, 200);
    setPixel(buf, ox + 2, oy, cr, cg, cb, 100);

    // FEET — visible
    const walkBob = m.grounded && Math.abs(m.vx) > 2;
    const stepPhase = Math.sin(m.age * 12) > 0;
    if (walkBob) {
      const frontFoot = stepPhase ? -1 : 1;
      setPixel(buf, ox + frontFoot, oy + 1, cr, cg, cb, 160);
      setPixel(buf, ox - frontFoot, oy + 1, cr, cg, cb, 100);
    } else {
      setPixel(buf, ox - 1, oy + 1, cr, cg, cb, 150);
      setPixel(buf, ox + 1, oy + 1, cr, cg, cb, 150);
    }

    // INNER GLOW — cluster members beat in unison; solo motes breathe individually.
    // Synchronized heartbeat: larger clusters beat slower (biological scaling).
    const clusterBeat = clusterHeartbeat.get(m);
    const heartPulse = clusterBeat !== undefined
      ? clusterBeat * 0.55 + 0.45          // 0.45–1.0, synchronized with cluster
      : Math.sin(m.age * 4 + m.temperament.hardiness * 5) * 0.3 + 0.7; // solo
    const heartA = Math.round(200 * heartPulse * m.energy * breathe);
    setPixel(buf, ox + lean, oy - 1, lr, lg, lb, heartA);

    // CLUSTER HEARTBEAT CORONA — at the peak of the shared beat, a brief crown of light
    // radiates from each cluster member simultaneously. Makes the cluster feel like one organism.
    if (clusterBeat !== undefined && clusterBeat > 0.72) {
      const peak = (clusterBeat - 0.72) / 0.28; // 0→1 in top 28% of beat
      const coronaA = Math.round(peak * peak * 70 * m.energy);
      if (coronaA > 4) {
        setPixel(buf, ox,      oy - 4,     lr, lg, lb, coronaA);
        setPixel(buf, ox - 3,  oy - 2,     lr, lg, lb, Math.round(coronaA * 0.65));
        setPixel(buf, ox + 3,  oy - 2,     lr, lg, lb, Math.round(coronaA * 0.65));
        setPixel(buf, ox - 4,  oy,         lr, lg, lb, Math.round(coronaA * 0.40));
        setPixel(buf, ox + 4,  oy,         lr, lg, lb, Math.round(coronaA * 0.40));
      }
    }

    // HARDY WIDE SHOULDERS — angular, blocky silhouette for hardy temperament.
    // Fills the normally-empty upper corners, making hardy motes look squarer/sturdier.
    const isHardy = m.temperament.hardiness > 0.55;
    if (isHardy) {
      const hs = (m.temperament.hardiness - 0.55) / 0.45; // 0→1
      const shoulderA = Math.round(hs * 175);
      setPixel(buf, ox - 2, oy - 2, cr, cg, cb, shoulderA);
      setPixel(buf, ox + 2, oy - 2, cr, cg, cb, shoulderA);
      setPixel(buf, ox - 2, oy + 1, cr, cg, cb, Math.round(shoulderA * 0.55));
      setPixel(buf, ox + 2, oy + 1, cr, cg, cb, Math.round(shoulderA * 0.55));
    }

    // HARDY ELDER MASS — motes past age 30 with high hardiness grow wider outer shoulders.
    // Visual bulk accumulates with survival: elders earn their mass.
    if (isHardy && m.age > 30) {
      const hs = (m.temperament.hardiness - 0.55) / 0.45;
      const elderMass = Math.min(1, (m.age - 30) / 30); // 0→1 over ages 30→60
      const massA = Math.round(hs * elderMass * 155);
      if (massA > 3) {
        // Outer shoulders at ±3px — wider silhouette than the inner ±2 layer
        setPixel(buf, ox - 3, oy - 2, cr, cg, cb, massA);
        setPixel(buf, ox + 3, oy - 2, cr, cg, cb, massA);
        // Torso width extension
        setPixel(buf, ox - 3, oy,     cr, cg, cb, Math.round(massA * 0.75));
        setPixel(buf, ox + 3, oy,     cr, cg, cb, Math.round(massA * 0.75));
        // Bright highlight at mid-shoulder for definition
        setPixel(buf, ox - 3, oy - 1, lr, lg, lb, Math.round(massA * 0.35));
        setPixel(buf, ox + 3, oy - 1, lr, lg, lb, Math.round(massA * 0.35));
      }
    }

    // HARDY SHIELD FLASH — silvery-blue corner sparks when resisting hostile terrain
    if (m.hardinessFlash > 0) {
      const pulse = Math.sin(m.age * 14) * 0.3 + 0.7;
      const shieldA = Math.round(m.hardinessFlash * pulse * 200);
      if (shieldA > 3) {
        setPixel(buf, ox - 3, oy - 3, 160, 210, 255, shieldA);
        setPixel(buf, ox + 3, oy - 3, 160, 210, 255, shieldA);
        setPixel(buf, ox - 3, oy + 1, 160, 210, 255, Math.round(shieldA * 0.65));
        setPixel(buf, ox + 3, oy + 1, 160, 210, 255, Math.round(shieldA * 0.65));
      }
    }

    // ELDER CROWN — follows lean
    if (isElder) {
      const elderGlow = Math.sin(m.age * 1.5) * 0.15 + 0.85;
      const ga = Math.round(200 * elderGlow);
      setPixel(buf, ox + lean,     oy - 3, 210, 180, 60, ga);
      setPixel(buf, ox - 1 + lean, oy - 3, 210, 180, 60, Math.round(ga * 0.6));
      setPixel(buf, ox + 1 + lean, oy - 3, 210, 180, 60, Math.round(ga * 0.6));
    }

    // WALKING DUST
    if (m.grounded && Math.abs(m.vx) > 4 && m.age > 0.3) {
      const dustFlicker = Math.sin(m.age * 20 + m.x) > 0.3;
      if (dustFlicker) {
        setPixel(buf, ox - dir * 2, oy + 1, 160, 150, 130, 50);
      }
    }

    // LOW ENERGY — temperament-differentiated dying behavior
    if (m.energy < 0.35 && m.energy > 0) {
      const dp = 1 - m.energy / 0.35; // 0→1 as energy → 0
      const domW = m.temperament.wanderlust > m.temperament.sociability && m.temperament.wanderlust > m.temperament.hardiness;
      const domS = m.temperament.sociability > m.temperament.wanderlust && m.temperament.sociability > m.temperament.hardiness;
      const domH = m.temperament.hardiness > m.temperament.wanderlust && m.temperament.hardiness > m.temperament.sociability;

      if (domW) {
        // WANDERER FRENZY: rapid whole-body flicker + jitter ghost — short-circuiting light
        const flickerHz = 15 + dp * 20; // 15→35 Hz, faster as death nears
        const flick = Math.sin(m.age * flickerHz);
        const dimA = Math.round(dp * (flick > 0 ? 105 : 0));
        if (dimA > 0) {
          setPixel(buf, ox, oy - 1, 0, 0, 0, dimA);
          setPixel(buf, ox, oy, 0, 0, 0, Math.round(dimA * 0.7));
          setPixel(buf, ox - 1, oy - 1, 0, 0, 0, Math.round(dimA * 0.4));
          setPixel(buf, ox + 1, oy - 1, 0, 0, 0, Math.round(dimA * 0.4));
        }
        // Jitter ghost: a displaced copy that flickers out of phase
        if (dp > 0.25 && flick < -0.2) {
          const gx = Math.sin(m.age * 37) > 0 ? 1 : -1;
          const ghostA = Math.round(dp * 75 * (-flick));
          setPixel(buf, ox + gx, oy - 1, cr, cg, cb, ghostA);
          setPixel(buf, ox + gx, oy - 2, cr, cg, cb, Math.round(ghostA * 0.4));
        }
      } else if (domS) {
        // SOCIAL YEARNING: smooth fade + arms reaching outward — dying reaching for connection
        const fadeA = Math.round(dp * 115);
        setPixel(buf, ox, oy - 1, 0, 0, 0, Math.round(fadeA * 0.85));
        setPixel(buf, ox, oy, 0, 0, 0, Math.round(fadeA * 0.65));
        setPixel(buf, ox - 1, oy - 1, 0, 0, 0, Math.round(fadeA * 0.45));
        setPixel(buf, ox + 1, oy - 1, 0, 0, 0, Math.round(fadeA * 0.45));
        // Reaching arms: extend outward horizontally, growing as energy fades
        if (dp > 0.15) {
          const reachDist = 3 + Math.round(dp * 2); // 3→5 px
          const armA = Math.round(dp * 90);
          setPixel(buf, ox - reachDist, oy - 1, cr, cg, cb, armA);
          setPixel(buf, ox + reachDist, oy - 1, cr, cg, cb, armA);
          setPixel(buf, ox - reachDist - 1, oy - 1, cr, cg, cb, Math.round(armA * 0.35));
          setPixel(buf, ox + reachDist + 1, oy - 1, cr, cg, cb, Math.round(armA * 0.35));
          // Upward reach — toward the sky, toward others above
          if (dp > 0.4) {
            setPixel(buf, ox, oy - 4, cr, cg, cb, Math.round(armA * 0.5));
            setPixel(buf, ox, oy - 5, cr, cg, cb, Math.round(armA * 0.2));
          }
        }
      } else if (domH) {
        // HARDY STRAIN: stress fractures + body quake — refuses to go quietly
        const crackPulse = Math.sin(m.age * 11) * 0.5 + 0.5;
        const crackA = Math.round(dp * crackPulse * 170);
        if (crackA > 5) {
          // Diagonal stress fractures across the body
          setPixel(buf, ox - 1, oy - 2, 215, 235, 255, crackA);
          setPixel(buf, ox + 2, oy, 215, 235, 255, Math.round(crackA * 0.7));
          setPixel(buf, ox - 2, oy + 1, 215, 235, 255, Math.round(crackA * 0.6));
          if (dp > 0.45) {
            // More fractures as death approaches
            setPixel(buf, ox, oy - 3, 215, 235, 255, Math.round(crackA * 0.85));
            setPixel(buf, ox + 1, oy - 2, 215, 235, 255, Math.round(crackA * 0.55));
            setPixel(buf, ox - 1, oy + 1, 215, 235, 255, Math.round(crackA * 0.45));
          }
        }
        // Quake: whole body trembles at low energy — the mote shaking with effort
        if (dp > 0.55) {
          const quake = Math.sin(m.age * 28) > 0 ? 1 : -1;
          const qa = Math.round((dp - 0.55) / 0.45 * 95);
          setPixel(buf, ox + quake, oy - 1, cr, cg, cb, qa);
          setPixel(buf, ox + quake, oy, cr, cg, cb, Math.round(qa * 0.5));
        }
      } else {
        // NEUTRAL: simple flicker for mixed temperaments
        const flicker = Math.sin(m.age * 15) > 0 ? 0.4 : 1.0;
        if (flicker < 1) {
          setPixel(buf, ox, oy, 0, 0, 0, Math.round((1 - flicker) * 80));
          setPixel(buf, ox, oy - 1, 0, 0, 0, Math.round((1 - flicker) * 50));
        }
      }
    }

    // BOND-SEEKING GLOW — follows lean
    if (m.bondTimer > 0.3 && m.bondFlash === 0) {
      const seekPulse = Math.sin(m.age * 8) * 0.5 + 0.5;
      const sa = Math.round(seekPulse * 60 * breathe);
      setPixel(buf, ox + lean,     oy - 3, lr, lg, lb, sa);
      setPixel(buf, ox - 1 + lean, oy - 3, lr, lg, lb, Math.round(sa * 0.4));
      setPixel(buf, ox + 1 + lean, oy - 3, lr, lg, lb, Math.round(sa * 0.4));
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
      const fa = Math.round(fi * 240);
      const fa2 = Math.round(fi * 90);
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

    // ANCIENT BOND BREAK — an old relationship ends. Slow expanding amber ring, warmer
    // and longer than the sharp shard scatter. The ring grows as it fades — like a memory
    // widening until it dissolves. Two rings: inner bright amber, outer faint gold.
    if (m.ancientBondBreakFlash > 0) {
      const af = m.ancientBondBreakFlash;
      // Inner ring: expands from r=3 to r=14 as flash decays 1→0
      const innerR = Math.round(3 + (1 - af) * 11);
      const innerA = Math.round(af * 200);
      if (innerA > 4) {
        for (let i = 0; i < 24; i++) {
          const angle = (i / 24) * Math.PI * 2;
          setPixel(buf, ox + Math.cos(angle) * innerR, (oy - 1) + Math.sin(angle) * innerR,
            255, 185, 75, innerA);
        }
      }
      // Outer ring: lags behind, fainter deep gold
      if (af < 0.75) {
        const outerR = Math.round(innerR + 6);
        const outerA = Math.round(af * 90);
        if (outerA > 3) {
          for (let i = 0; i < 16; i++) {
            const angle = (i / 16) * Math.PI * 2;
            setPixel(buf, ox + Math.cos(angle) * outerR, (oy - 1) + Math.sin(angle) * outerR,
              230, 150, 50, outerA);
          }
        }
      }
    }

    // CLUSTER MOURNING — all surviving cluster members briefly carry the dead mote's color.
    // A stationary ring held close to the body (doesn't expand — grief holds, it doesn't radiate),
    // body tinge, and a rising wisp like a thought going up to where the spirit went.
    if (m.mourningFlash > 0) {
      const mf = m.mourningFlash;
      const mfC = mf * mf; // quadratic ease-out: bold at peak, graceful fade
      const ringA = Math.round(mfC * 200);
      const bodyA = Math.round(mfC * 130);
      // Stationary ring at fixed radius — held close, doesn't expand (unlike inheritance ring)
      if (ringA > 5) {
        const RING_R = 5;
        for (let i = 0; i < 16; i++) {
          if (i % 4 === 3) continue; // gap pattern: dashed, not solid
          const angle = (i / 16) * Math.PI * 2;
          setPixel(buf,
            ox + Math.cos(angle) * RING_R,
            (oy - 1) + Math.sin(angle) * RING_R,
            m.mourningR, m.mourningG, m.mourningB, ringA,
          );
        }
      }
      // Body tinge — mote briefly shows the lost one's color in its core
      if (bodyA > 5) {
        setPixel(buf, ox,     oy - 2, m.mourningR, m.mourningG, m.mourningB, Math.round(bodyA * 0.65));
        setPixel(buf, ox - 1, oy - 1, m.mourningR, m.mourningG, m.mourningB, Math.round(bodyA * 0.4));
        setPixel(buf, ox,     oy - 1, m.mourningR, m.mourningG, m.mourningB, bodyA);
        setPixel(buf, ox + 1, oy - 1, m.mourningR, m.mourningG, m.mourningB, Math.round(bodyA * 0.4));
        setPixel(buf, ox,     oy,     m.mourningR, m.mourningG, m.mourningB, Math.round(bodyA * 0.5));
        // Rising wisp — a brief upward tendril, like a thought going skyward
        if (mf > 0.5) {
          const wA = Math.round((mf - 0.5) / 0.5 * 85);
          setPixel(buf, ox, oy - 4, m.mourningR, m.mourningG, m.mourningB, wA);
          setPixel(buf, ox, oy - 5, m.mourningR, m.mourningG, m.mourningB, Math.round(wA * 0.4));
        }
      }
    }

    // DEATH INHERITANCE — nearest witness briefly carries the dead mote's color
    // An expanding ring of grief: the color of loss radiating outward from the survivor
    if (m.inheritFlash > 0) {
      const ef = m.inheritFlash;
      const expandT = 1 - ef;                      // 0→1 as ring grows
      const ringRadius = 3 + expandT * 7;           // 3→10 px expansion
      const ringA = Math.round(ef * 175);
      const dotCount = 14;
      for (let i = 0; i < dotCount; i++) {
        const angle = (i / dotCount) * Math.PI * 2;
        const rx = ox + Math.cos(angle) * ringRadius;
        const ry = (oy - 1) + Math.sin(angle) * ringRadius;
        setPixel(buf, rx, ry, m.inheritR, m.inheritG, m.inheritB, ringA);
      }
      // Second, tighter ring for depth
      const ring2R = ringRadius * 0.55;
      const ring2A = Math.round(ef * ef * 90);
      if (ring2A > 4) {
        for (let i = 0; i < 8; i++) {
          const angle = (i / 8) * Math.PI * 2;
          setPixel(buf, ox + Math.cos(angle) * ring2R, (oy - 1) + Math.sin(angle) * ring2R, m.inheritR, m.inheritG, m.inheritB, ring2A);
        }
      }
      // Brief core tinge: the first moment of grief, before the ring spreads
      if (ef > 0.65) {
        const coreA = Math.round((ef - 0.65) / 0.35 * 130);
        setPixel(buf, ox,     oy - 1, m.inheritR, m.inheritG, m.inheritB, coreA);
        setPixel(buf, ox - 1, oy - 1, m.inheritR, m.inheritG, m.inheritB, Math.round(coreA * 0.45));
        setPixel(buf, ox + 1, oy - 1, m.inheritR, m.inheritG, m.inheritB, Math.round(coreA * 0.45));
      }
    }

    // SPAWN MATERIALIZATION
    if (m.spawnFlash > 0) {
      const sf = m.spawnFlash * m.spawnFlash;
      const radius = Math.round(3 + (1 - sf) * 4);
      const sa = Math.round(sf * 150);
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
