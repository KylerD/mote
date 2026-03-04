// main.ts — Entry point. Orchestrates world, rendering, sound, interaction.

import { createRenderContext, present, setPixel, RenderContext, W, H } from "./render";
import { drawText, drawTextRight } from "./font";
import { renderTerrain } from "./terrain";
import { createWorld, updateWorld, World } from "./world";
import { cycleName } from "./names";
import { PAL, BiomePalette } from "./palette";
import { Mote } from "./mote";
import { findClusters } from "./physics";
import { createSoundEngine, initAudio, updateSound, SoundEngine, playDeath, playEventSound } from "./sound";
import { createInteraction, applyInteraction, Interaction } from "./interaction";
import { isEventActive, isEclipseActive, getMeteorPosition } from "./events";

let rc: RenderContext;
let world: World;
let sound: SoundEngine;
let input: Interaction;

// Meteor impact flash state
let meteorWasVisible = false;
let impactFlash = 0;
let impactX = 0;
let impactY = 0;

// DOM elements for cycle info (populated outside the canvas)
let elCycleName: HTMLElement | null;
let elPhase: HTMLElement | null;
let elNarrative: HTMLElement | null;

// Narrative text system — ambient story moments
interface NarrativeEvent {
  text: string;
  time: number;
  duration: number;
}
let narrativeQueue: NarrativeEvent[] = [];
let lastNarrativeTime = 0;
let lastBondCount = 0;
let lastMoteCount = 0;
let narratedFirstElder = false;
let narratedFirstLife = false;
let narratedDissolution = false;
let narratedSilence = false;

function init(): void {
  const canvas = document.getElementById("world") as HTMLCanvasElement;
  rc = createRenderContext(canvas);
  world = createWorld();
  sound = createSoundEngine();
  input = createInteraction(canvas);

  // DOM info elements
  elCycleName = document.getElementById("cycle-name");
  elPhase = document.getElementById("cycle-phase");
  elNarrative = document.getElementById("narrative");

  // Audio init on first interaction — also dismiss the audio prompt
  const audioPrompt = document.getElementById("audio-prompt");
  const startAudio = () => {
    initAudio(sound);
    if (audioPrompt) {
      audioPrompt.classList.add("dismissed");
      setTimeout(() => { if (audioPrompt.parentNode) audioPrompt.style.display = "none"; }, 600);
    }
    document.removeEventListener("click", startAudio);
    document.removeEventListener("touchstart", startAudio);
    document.removeEventListener("keydown", startAudio);
  };
  document.addEventListener("click", startAudio);
  document.addEventListener("touchstart", startAudio);
  document.addEventListener("keydown", startAudio);

  // Sound update loop (~15fps, decoupled)
  setInterval(() => {
    updateSound(sound, world.motes, world.phaseIndex, world.phaseProgress);
  }, 67);

  // Idle cursor hide
  let idleTimer = 0;
  document.addEventListener("mousemove", () => {
    document.body.classList.remove("idle");
    clearTimeout(idleTimer);
    idleTimer = window.setTimeout(() => document.body.classList.add("idle"), 3000);
  });

  let lastTime = performance.now();
  const debugMode = new URLSearchParams(window.location.search).has("debug");

  function frame(now: number): void {
    const dt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;

    // Update world + interaction
    updateWorld(world, dt);
    applyInteraction(input, world.motes);

    // Event sound triggering
    if (world.pendingEventSound && sound.initialized) {
      playEventSound(sound, world.pendingEventSound);
      world.pendingEventSound = null;
    }

    // Death sounds
    for (const d of world.deaths) {
      if (world.time - d.time < 0.02) {
        if (sound.initialized) {
          playDeath(sound, 1 - d.y / H);
        }
        break;
      }
    }

    // Narrative events
    updateNarrative(world);

    // Render terrain + sky
    renderTerrain(rc.buf, world.terrain, world.time, world.cycleProgress);

    // Pre-compute mote colors
    const bp = world.terrain.bp;
    const moteColors = new Map<Mote, [number, number, number]>();
    for (const m of world.motes) {
      moteColors.set(m, computeMoteColor(m, bp));
    }

    // Check if plague is active
    const plagueActive = world.event && world.event.type === 'plague' && isEventActive(world.event, world.time);
    const plaguePulse = plagueActive ? Math.sin(world.time * 6) : 0;

    // Eclipse and aurora state
    const eclipseActive = isEclipseActive(world.event, world.time);
    const auroraActive = world.event && world.event.type === 'aurora' && isEventActive(world.event, world.time);

    // Draw aurora light curtains BEFORE motes (behind them in sky)
    if (auroraActive && world.event) {
      drawAuroraCurtains(rc.buf, world.time, world.event.startTime);
    }

    // Draw cluster glow auras BEFORE individual motes
    const clusters = findClusters(world.motes);
    for (const cluster of clusters) {
      if (cluster.length >= 3) {
        drawClusterGlow(rc.buf, cluster, moteColors, world.time);
      }
    }

    // Render motes — expressive multi-pixel creatures
    for (const m of world.motes) {
      let [cr, cg, cb] = moteColors.get(m)!;

      // Plague visual
      if (plagueActive && m.bonds.length > 0 && plaguePulse > 0.3) {
        const tint = (plaguePulse - 0.3) * 0.4;
        cr = Math.round(cr * (1 - tint));
        cg = Math.round(Math.min(255, cg + 40 * tint));
        cb = Math.round(cb * (1 - tint * 0.5));
      }

      const isElder = m.age > 20;
      const isMature = m.age > 8;

      // Breathing: motes pulse gently with life — deterministic from age
      const breathe = Math.sin(m.age * 2.5 + m.temperament.wanderlust * 6.28) * 0.15 + 0.85;
      const br = Math.round(cr * breathe);
      const bg = Math.round(cg * breathe);
      const bb = Math.round(cb * breathe);

      // Center pixel — elders get warm golden boost
      if (isElder) {
        setPixel(rc.buf, m.x, m.y,
          Math.min(255, br + 30), Math.min(255, bg + 20), Math.min(255, bb + 5));
      } else {
        setPixel(rc.buf, m.x, m.y, br, bg, bb);
      }

      // Cross pixels — scale alpha with energy so dying motes shrink to 1px
      if (m.energy > 0.15) {
        const ea = isElder ? 255 : isMature ? Math.round(100 + m.energy * 140) : Math.round(60 + m.energy * 160);
        const pulseAlpha = Math.round(ea * breathe);
        setPixel(rc.buf, m.x - 1, m.y, br, bg, bb, pulseAlpha);
        setPixel(rc.buf, m.x + 1, m.y, br, bg, bb, pulseAlpha);
        setPixel(rc.buf, m.x, m.y - 1, br, bg, bb, pulseAlpha);
        setPixel(rc.buf, m.x, m.y + 1, br, bg, bb, pulseAlpha);
      }

      // Elders: full 3x3 — glow with wisdom
      if (isElder) {
        const elderGlow = Math.sin(m.age * 1.5) * 0.1 + 0.9;
        const ea = Math.round(220 * elderGlow);
        setPixel(rc.buf, m.x - 1, m.y - 1, br, bg, bb, ea);
        setPixel(rc.buf, m.x + 1, m.y - 1, br, bg, bb, ea);
        setPixel(rc.buf, m.x - 1, m.y + 1, br, bg, bb, ea);
        setPixel(rc.buf, m.x + 1, m.y + 1, br, bg, bb, ea);
      } else if (m.bonds.length > 0) {
        // Bonded motes get corner pixels — more bonds = more substantial
        const ba = Math.round(50 + m.bonds.length * 40 + m.energy * 30);
        setPixel(rc.buf, m.x - 1, m.y - 1, br, bg, bb, ba);
        setPixel(rc.buf, m.x + 1, m.y - 1, br, bg, bb, ba);
        setPixel(rc.buf, m.x - 1, m.y + 1, br, bg, bb, ba);
        setPixel(rc.buf, m.x + 1, m.y + 1, br, bg, bb, ba);
      }

      // Bond formation flash — dramatic expanding burst with halo
      if (m.bondFlash > 0) {
        const fi = m.bondFlash * m.bondFlash; // quadratic for punchy attack
        const fa = Math.round(fi * 255);
        // Inner ring
        setPixel(rc.buf, m.x - 2, m.y, 255, 255, 255, fa);
        setPixel(rc.buf, m.x + 2, m.y, 255, 255, 255, fa);
        setPixel(rc.buf, m.x, m.y - 2, 255, 255, 255, fa);
        setPixel(rc.buf, m.x, m.y + 2, 255, 255, 255, fa);
        // Outer halo
        const fa2 = Math.round(fi * 120);
        setPixel(rc.buf, m.x - 3, m.y, 255, 240, 200, fa2);
        setPixel(rc.buf, m.x + 3, m.y, 255, 240, 200, fa2);
        setPixel(rc.buf, m.x, m.y - 3, 255, 240, 200, fa2);
        setPixel(rc.buf, m.x, m.y + 3, 255, 240, 200, fa2);
        setPixel(rc.buf, m.x - 2, m.y - 2, 255, 240, 200, fa2);
        setPixel(rc.buf, m.x + 2, m.y - 2, 255, 240, 200, fa2);
        setPixel(rc.buf, m.x - 2, m.y + 2, 255, 240, 200, fa2);
        setPixel(rc.buf, m.x + 2, m.y + 2, 255, 240, 200, fa2);
      }
    }

    // Draw bond lines — glowing, pulsing
    const drawn = new Set<string>();
    for (const m of world.motes) {
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
        // Synchronized breathing between bonded motes
        const bondPulse = Math.sin(world.time * 3 + m.x * 0.05 + bonded.x * 0.05) * 0.15 + 0.85;
        const bondAlpha = Math.round((120 + flash * 135) * bondPulse);
        drawLine(rc.buf, m.x, m.y, bonded.x, bonded.y, avgR, avgG, avgB, bondAlpha);
      }
    }

    // Death particles — expanding soul that rises
    for (const d of world.deaths) {
      const age = world.time - d.time;
      const life = 1 - age / 1.2;
      if (life <= 0) continue;
      const alpha = Math.round(life * 200);
      const spread = age * 20;
      const rise = age * 8;

      // Center flash
      setPixel(rc.buf, d.x, d.y, d.r, d.g, d.b, alpha);
      // Spirit particles — rise upward
      const pa = Math.round(alpha * 0.6);
      setPixel(rc.buf, d.x, d.y - spread - rise, 255, 255, 255, Math.round(pa * 0.8));
      setPixel(rc.buf, d.x - spread, d.y - rise, d.r, d.g, d.b, pa);
      setPixel(rc.buf, d.x + spread, d.y - rise, d.r, d.g, d.b, pa);
      setPixel(rc.buf, d.x, d.y - spread * 1.5 - rise, d.r, d.g, d.b, Math.round(pa * 0.4));
      setPixel(rc.buf, d.x - 1, d.y - spread * 0.7 - rise, d.r, d.g, d.b, Math.round(pa * 0.3));
      setPixel(rc.buf, d.x + 1, d.y - spread * 0.7 - rise, d.r, d.g, d.b, Math.round(pa * 0.3));
    }

    // Meteor visual — bright head + long fiery trail
    const meteorPos = getMeteorPosition(world.event, world.time, world.cycleNumber);
    if (meteorPos) {
      const mx = Math.round(meteorPos.x);
      const my = Math.round(meteorPos.y);
      // Bright 3x3 head with hot core
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const dist = Math.abs(dx) + Math.abs(dy);
          if (dist === 0) {
            setPixel(rc.buf, mx, my, 255, 255, 220, 255);
          } else {
            setPixel(rc.buf, mx + dx, my + dy, 255, 200, 100, 220);
          }
        }
      }
      // Long fiery trail with sparks
      for (let i = 1; i <= 15; i++) {
        const ta = Math.round(220 * (1 - i / 15));
        const tr = Math.round(255 - i * 6);
        const tg = Math.round(180 - i * 10);
        const tb = Math.max(0, Math.round(80 - i * 4));
        setPixel(rc.buf, mx + i, my - i, tr, tg, tb, ta);
        if (i < 10) {
          setPixel(rc.buf, mx + i, my - i + 1, tr, tg, tb, Math.round(ta * 0.5));
          setPixel(rc.buf, mx + i + 1, my - i, tr, tg, tb, Math.round(ta * 0.5));
        }
        if (i % 3 === 0 && i < 12) {
          const sparkY = my - i + (i % 2 === 0 ? 2 : -1);
          setPixel(rc.buf, mx + i + 1, sparkY, 255, 220, 100, Math.round(ta * 0.7));
        }
      }
      meteorWasVisible = true;
      impactX = mx;
      impactY = my;
    } else if (meteorWasVisible) {
      meteorWasVisible = false;
      impactFlash = 1.0;
    }

    // Impact flash — expanding bright circle
    if (impactFlash > 0) {
      const flashRadius = Math.round((1 - impactFlash) * 24 + 4);
      for (let dy = -flashRadius; dy <= flashRadius; dy++) {
        for (let dx = -flashRadius; dx <= flashRadius; dx++) {
          const d2 = dx * dx + dy * dy;
          if (d2 <= flashRadius * flashRadius) {
            const falloff = 1 - Math.sqrt(d2) / flashRadius;
            const fa = Math.round(impactFlash * 250 * falloff);
            const heat = falloff;
            setPixel(rc.buf, impactX + dx, impactY + dy,
              Math.round(255 * heat + 180 * (1 - heat)),
              Math.round(240 * heat + 100 * (1 - heat)),
              Math.round(200 * heat + 40 * (1 - heat)),
              fa);
          }
        }
      }
      impactFlash = Math.max(0, impactFlash - dt * 2.0);
    }

    // Eclipse — dramatic darkness with stars and glowing mote eyes
    if (eclipseActive && world.event) {
      const eclipseElapsed = world.time - world.event.startTime;
      const eclipseProgress = eclipseElapsed / world.event.duration;
      const darkness = eclipseProgress < 0.15
        ? eclipseProgress / 0.15
        : eclipseProgress > 0.85
          ? (1 - eclipseProgress) / 0.15
          : 1.0;
      const dimFactor = 0.12 + (1 - darkness) * 0.88;
      const d = rc.buf.data;
      for (let i = 0; i < d.length; i += 4) {
        d[i] = d[i] * dimFactor;
        d[i + 1] = d[i + 1] * dimFactor;
        d[i + 2] = Math.min(255, d[i + 2] * dimFactor * 1.3);
      }

      // Stars emerge
      if (darkness > 0.3) {
        const starAlpha = Math.round((darkness - 0.3) / 0.7 * 200);
        const starSeed = world.cycleNumber * 31337;
        for (let i = 0; i < 40; i++) {
          const sx = Math.abs((starSeed + i * 7919) % W);
          const sy = Math.abs((starSeed + i * 4793) % Math.floor(H * 0.5));
          const brightness = (starSeed + i * 2287) % 3;
          const twinkle = Math.sin(world.time * (2 + i * 0.3) + i) * 0.3 + 0.7;
          const sa = Math.round(starAlpha * twinkle);
          if (brightness === 0) {
            setPixel(rc.buf, sx, sy, 220, 230, 255, sa);
            setPixel(rc.buf, sx - 1, sy, 180, 190, 220, Math.round(sa * 0.4));
            setPixel(rc.buf, sx + 1, sy, 180, 190, 220, Math.round(sa * 0.4));
            setPixel(rc.buf, sx, sy - 1, 180, 190, 220, Math.round(sa * 0.4));
            setPixel(rc.buf, sx, sy + 1, 180, 190, 220, Math.round(sa * 0.4));
          } else {
            setPixel(rc.buf, sx, sy, 200, 210, 240, Math.round(sa * 0.6));
          }
        }
      }

      // Motes glow bright — points of light in darkness
      if (darkness > 0.2) {
        const glowIntensity = (darkness - 0.2) / 0.8;
        for (const m of world.motes) {
          const [mcr, mcg, mcb] = moteColors.get(m)!;
          const ga = Math.round(glowIntensity * 200 * m.energy);
          setPixel(rc.buf, m.x, m.y, 255, 255, 255, ga);
          const ha = Math.round(ga * 0.4);
          setPixel(rc.buf, m.x - 1, m.y, mcr, mcg, mcb, ha);
          setPixel(rc.buf, m.x + 1, m.y, mcr, mcg, mcb, ha);
          setPixel(rc.buf, m.x, m.y - 1, mcr, mcg, mcb, ha);
          setPixel(rc.buf, m.x, m.y + 1, mcr, mcg, mcb, ha);
        }
      }
    }

    // Aurora visual — luminous boost
    if (auroraActive) {
      const d = rc.buf.data;
      for (let i = 0; i < d.length; i += 4) {
        d[i] = Math.min(255, d[i] * 1.08);
        d[i + 1] = Math.min(255, d[i + 1] * 1.12);
        d[i + 2] = Math.min(255, d[i + 2] * 1.18);
      }
    }

    // Click ripples
    for (let i = input.ripples.length - 1; i >= 0; i--) {
      const rp = input.ripples[i];
      const r = Math.round(rp.radius);
      const ra = Math.round(rp.alpha * 200);
      const r2inner = (r - 1) * (r - 1);
      const r2outer = (r + 1) * (r + 1);
      for (let dy = -r - 1; dy <= r + 1; dy++) {
        for (let dx = -r - 1; dx <= r + 1; dx++) {
          const d2 = dx * dx + dy * dy;
          if (d2 >= r2inner && d2 <= r2outer) {
            setPixel(rc.buf, Math.round(rp.x) + dx, Math.round(rp.y) + dy, 220, 224, 228, ra);
          }
        }
      }
      rp.radius += dt * 30;
      rp.alpha -= dt * 2.2;
      if (rp.alpha <= 0) input.ripples.splice(i, 1);
    }

    // Cursor indicator
    if (input.present) {
      const cr = 5;
      const cx = Math.round(input.x);
      const cy = Math.round(input.y);
      const cr2inner = (cr - 1) * (cr - 1);
      const cr2outer = cr * cr;
      for (let dy = -cr; dy <= cr; dy++) {
        for (let dx = -cr; dx <= cr; dx++) {
          const d2 = dx * dx + dy * dy;
          if (d2 >= cr2inner && d2 <= cr2outer) {
            setPixel(rc.buf, cx + dx, cy + dy, 220, 224, 228, 40);
          }
        }
      }
    }

    // Vignette
    applyVignette(rc.buf);

    // Event message flash
    if (world.event && isEventActive(world.event, world.time) && world.event.messageAlpha > 0) {
      const msgX = Math.floor((W - world.event.message.length * 4) / 2);
      const msgY = Math.floor(H * 0.3);
      if (world.event.messageAlpha > 0.3) {
        drawText(rc.buf, msgX, msgY, world.event.message, 5);
      } else {
        drawText(rc.buf, msgX, msgY, world.event.message, 4);
      }
    }

    // Update DOM cycle info
    const name = cycleName(world.cycleNumber);
    if (elCycleName) elCycleName.textContent = name;
    if (elPhase) elPhase.textContent = world.phaseName;

    // Debug overlay
    if (debugMode) {
      const debugClusters = findClusters(world.motes);
      const info = `${world.phaseName.toUpperCase()} M:${world.motes.length} C:${debugClusters.length}`;
      drawText(rc.buf, 2, 2, info, 5);
      const fps = `${Math.round(1 / Math.max(dt, 0.001))} FPS`;
      drawTextRight(rc.buf, W - 2, 2, fps, 5);
    }

    present(rc.ctx, rc.buf);
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

/** Draw aurora light curtains in the sky */
function drawAuroraCurtains(buf: ImageData, time: number, eventStart: number): void {
  const elapsed = time - eventStart;
  const intensity = Math.min(1, elapsed / 3);

  for (let x = 0; x < W; x++) {
    const curtain1 = Math.sin(x * 0.08 + time * 0.5) * 0.5 + 0.5;
    const curtain2 = Math.sin(x * 0.05 - time * 0.3 + 2) * 0.3 + 0.5;
    const curtain3 = Math.sin(x * 0.12 + time * 0.7 + 4) * 0.2 + 0.5;
    const curtainStrength = (curtain1 + curtain2 + curtain3) / 3;

    const maxY = Math.floor(H * 0.5);
    for (let y = 0; y < maxY; y++) {
      const yFade = 1 - y / maxY;
      const alpha = Math.round(curtainStrength * yFade * intensity * 35);
      if (alpha < 3) continue;

      const colorT = (Math.sin(x * 0.04 + time * 0.2) + 1) / 2;
      const ar = Math.round(40 + colorT * 80);
      const ag = Math.round(180 - colorT * 40);
      const ab = Math.round(100 + colorT * 80);
      setPixel(buf, x, y, ar, ag, ab, alpha);
    }
  }
}

/** Draw soft glow around bonded clusters */
function drawClusterGlow(
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
}

/** Narrative system — generates ambient story text below the canvas */
function updateNarrative(w: World): void {
  if (!elNarrative) return;

  // Reset on new cycle
  if (w.time < 1) {
    narratedFirstElder = false;
    narratedFirstLife = false;
    narratedDissolution = false;
    narratedSilence = false;
    lastBondCount = 0;
    lastMoteCount = 0;
    narrativeQueue = [];
    elNarrative.textContent = "";
    elNarrative.style.opacity = "0";
  }

  const now = w.time;
  if (now - lastNarrativeTime < 6) return;

  let bondCount = 0;
  for (const m of w.motes) bondCount += m.bonds.length;
  bondCount = Math.floor(bondCount / 2);

  // First motes appear
  if (!narratedFirstLife && w.motes.length > 5 && w.motes.length > lastMoteCount + 3) {
    pushNarrative("life stirs", now);
    narratedFirstLife = true;
  }

  // First bonds
  if (bondCount > 0 && lastBondCount === 0 && narratedFirstLife) {
    pushNarrative("the first bond forms", now);
  }

  // First elder
  if (!narratedFirstElder) {
    for (const m of w.motes) {
      if (m.age > 20) {
        narratedFirstElder = true;
        pushNarrative("an elder endures", now);
        break;
      }
    }
  }

  // Large cluster
  const largeClusters = findClusters(w.motes).filter(c => c.length >= 5);
  if (largeClusters.length > 0 && bondCount > lastBondCount + 4) {
    pushNarrative("a community takes shape", now);
  }

  // Dissolution
  if (w.phaseName === "dissolution" && !narratedDissolution) {
    narratedDissolution = true;
    pushNarrative("the light begins to fade", now);
  }

  // Silence
  if (w.phaseName === "silence" && !narratedSilence) {
    narratedSilence = true;
    pushNarrative("silence falls", now);
  }

  // Event narration
  if (w.event && w.eventTriggered && isEventActive(w.event, w.time)) {
    const elapsed = w.time - w.event.startTime;
    if (elapsed > 0 && elapsed < 0.5) {
      const eventTexts: Record<string, string> = {
        flood: "the waters rise",
        bloom: "life erupts",
        meteor: "something falls from above",
        migration: "they move as one",
        eclipse: "darkness descends",
        earthquake: "the ground trembles",
        plague: "a sickness spreads",
        aurora: "the sky comes alive",
        drought: "the land grows parched",
      };
      const text = eventTexts[w.event.type];
      if (text) pushNarrative(text, now);
    }
  }

  lastBondCount = bondCount;
  lastMoteCount = w.motes.length;

  // Display current narrative
  if (narrativeQueue.length > 0) {
    const current = narrativeQueue[0];
    const age = now - current.time;
    if (age > current.duration) {
      narrativeQueue.shift();
      elNarrative.style.opacity = "0";
    } else if (age < 0.8) {
      elNarrative.textContent = current.text;
      elNarrative.style.opacity = String(Math.min(1, age / 0.8));
    } else if (age > current.duration - 1) {
      elNarrative.style.opacity = String(Math.max(0, (current.duration - age)));
    } else {
      elNarrative.style.opacity = "1";
    }
  }
}

function pushNarrative(text: string, now: number): void {
  if (narrativeQueue.length > 0 && narrativeQueue[narrativeQueue.length - 1].text === text) return;
  if (now - lastNarrativeTime < 6) return;
  narrativeQueue.push({ text, time: now, duration: 5 });
  lastNarrativeTime = now;
}

/** Compute a mote's display color from its temperament and energy */
function computeMoteColor(m: Mote, bp: BiomePalette): [number, number, number] {
  const bright = PAL[bp.moteGlow];
  const dark = PAL[bp.moteDim];
  const mid = PAL[bp.moteMid];

  const hardyBoost = m.temperament.hardiness * 0.3 * (1 - m.energy);
  const t = Math.min(1, m.energy + hardyBoost);

  let r, g, b;
  if (t < 0.5) {
    const st = t * 2;
    r = dark[0] + (mid[0] - dark[0]) * st;
    g = dark[1] + (mid[1] - dark[1]) * st;
    b = dark[2] + (mid[2] - dark[2]) * st;
  } else {
    const st = (t - 0.5) * 2;
    r = mid[0] + (bright[0] - mid[0]) * st;
    g = mid[1] + (bright[1] - mid[1]) * st;
    b = mid[2] + (bright[2] - mid[2]) * st;
  }

  const wt = m.temperament.wanderlust * 0.35;
  r += (200 - r) * wt;
  g += (80 - g) * wt;
  b += (20 - b) * wt;

  const st = m.temperament.sociability * 0.30;
  r += (60 - r) * st;
  g += (160 - g) * st;
  b += (200 - b) * st;

  return [Math.round(r), Math.round(g), Math.round(b)];
}

function applyVignette(buf: ImageData): void {
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
      const f = Math.max(0.55, fade);
      const i = (y * W + x) * 4;
      d[i] = d[i] * f;
      d[i + 1] = d[i + 1] * f;
      d[i + 2] = d[i + 2] * f;
    }
  }
}

function drawLine(
  buf: ImageData,
  x0: number, y0: number,
  x1: number, y1: number,
  r: number, g: number, b: number, a: number,
): void {
  let ix0 = Math.round(x0);
  let iy0 = Math.round(y0);
  const ix1 = Math.round(x1);
  const iy1 = Math.round(y1);

  const dx = Math.abs(ix1 - ix0);
  const dy = Math.abs(iy1 - iy0);
  const sx = ix0 < ix1 ? 1 : -1;
  const sy = iy0 < iy1 ? 1 : -1;
  let err = dx - dy;

  for (let i = 0; i < 30; i++) {
    setPixel(buf, ix0, iy0, r, g, b, a);
    if (ix0 === ix1 && iy0 === iy1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; ix0 += sx; }
    if (e2 < dx) { err += dx; iy0 += sy; }
  }
}

init();
