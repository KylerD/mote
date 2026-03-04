// main.ts — Entry point. Orchestrates world, rendering, sound, interaction.

import { createRenderContext, present, setPixel, RenderContext, W, H } from "./render";
import { drawText, drawTextRight } from "./font";
import { renderTerrain } from "./terrain";
import { createWorld, updateWorld, World } from "./world";
import { cycleName } from "./names";
import { PAL, BiomePalette } from "./palette";
import { Mote } from "./mote";
import { findClusters } from "./physics";
import { createSoundEngine, initAudio, updateSound, SoundEngine } from "./sound";
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

function init(): void {
  const canvas = document.getElementById("world") as HTMLCanvasElement;
  rc = createRenderContext(canvas);
  world = createWorld();
  sound = createSoundEngine();
  input = createInteraction(canvas);

  // DOM info elements
  elCycleName = document.getElementById("cycle-name");
  elPhase = document.getElementById("cycle-phase");

  // Audio init on first interaction
  const startAudio = () => {
    initAudio(sound);
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

    // Render terrain + sky
    renderTerrain(rc.buf, world.terrain, world.time, world.cycleProgress);

    // Pre-compute mote colors (reused for both mote pixels and bond lines)
    const bp = world.terrain.bp;
    const moteColors = new Map<Mote, [number, number, number]>();
    for (const m of world.motes) {
      moteColors.set(m, computeMoteColor(m, bp));
    }

    // Render motes — multi-pixel so you can actually see them
    for (const m of world.motes) {
      const [cr, cg, cb] = moteColors.get(m)!;

      // Center pixel — always full brightness
      setPixel(rc.buf, m.x, m.y, cr, cg, cb);

      // Cross pixels — scale alpha with energy so dying motes shrink to 1px
      if (m.energy > 0.15) {
        const ea = Math.round(60 + m.energy * 160); // 60–220
        setPixel(rc.buf, m.x - 1, m.y, cr, cg, cb, ea);
        setPixel(rc.buf, m.x + 1, m.y, cr, cg, cb, ea);
        setPixel(rc.buf, m.x, m.y - 1, cr, cg, cb, ea);
        setPixel(rc.buf, m.x, m.y + 1, cr, cg, cb, ea);
      }

      // Bonded motes get corner pixels — reads as a 3x3 blob
      if (m.bonds.length > 0) {
        const ba = Math.round(30 + m.bonds.length * 30); // 60–120
        setPixel(rc.buf, m.x - 1, m.y - 1, cr, cg, cb, ba);
        setPixel(rc.buf, m.x + 1, m.y - 1, cr, cg, cb, ba);
        setPixel(rc.buf, m.x - 1, m.y + 1, cr, cg, cb, ba);
        setPixel(rc.buf, m.x + 1, m.y + 1, cr, cg, cb, ba);
      }

      // Bond formation flash — bright burst that fades
      if (m.bondFlash > 0) {
        const fa = Math.round(m.bondFlash * 200);
        setPixel(rc.buf, m.x - 2, m.y, 255, 255, 255, fa);
        setPixel(rc.buf, m.x + 2, m.y, 255, 255, 255, fa);
        setPixel(rc.buf, m.x, m.y - 2, 255, 255, 255, fa);
        setPixel(rc.buf, m.x, m.y + 2, 255, 255, 255, fa);
      }
    }

    // Draw bond lines — visible this time
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
        // Flash bright on formation, settle to steady visible alpha
        const flash = Math.max(m.bondFlash, bonded.bondFlash);
        const bondAlpha = Math.round(100 + flash * 155); // 100–255
        drawLine(rc.buf, m.x, m.y, bonded.x, bonded.y,
          Math.round((r1 + r2) / 2),
          Math.round((g1 + g2) / 2),
          Math.round((b1 + b2) / 2),
          bondAlpha);
      }
    }

    // Meteor visual — bright head + long trail
    const meteorPos = getMeteorPosition(world.event, world.time, world.cycleNumber);
    if (meteorPos) {
      const mx = Math.round(meteorPos.x);
      const my = Math.round(meteorPos.y);
      // Bright 3x3 head
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const dist = Math.abs(dx) + Math.abs(dy);
          const a = dist === 0 ? 255 : 200;
          setPixel(rc.buf, mx + dx, my + dy, 255, 220, 140, a);
        }
      }
      // Long trail
      for (let i = 1; i <= 10; i++) {
        const ta = Math.round(200 * (1 - i / 10));
        const tr = Math.round(255 - i * 10);
        const tg = Math.round(180 - i * 12);
        setPixel(rc.buf, mx + i, my - i, tr, tg, 80, ta);
        if (i < 7) {
          setPixel(rc.buf, mx + i, my - i + 1, tr, tg, 80, Math.round(ta * 0.5));
          setPixel(rc.buf, mx + i + 1, my - i, tr, tg, 80, Math.round(ta * 0.5));
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
      const flashRadius = Math.round((1 - impactFlash) * 18 + 4);
      for (let dy = -flashRadius; dy <= flashRadius; dy++) {
        for (let dx = -flashRadius; dx <= flashRadius; dx++) {
          const d2 = dx * dx + dy * dy;
          if (d2 <= flashRadius * flashRadius) {
            const falloff = 1 - Math.sqrt(d2) / flashRadius;
            const fa = Math.round(impactFlash * 220 * falloff);
            setPixel(rc.buf, impactX + dx, impactY + dy, 255, 240, 180, fa);
          }
        }
      }
      impactFlash = Math.max(0, impactFlash - dt * 2.5);
    }

    // Eclipse darkening
    if (isEclipseActive(world.event, world.time)) {
      const d = rc.buf.data;
      for (let i = 0; i < d.length; i += 4) {
        d[i] = d[i] * 0.4;
        d[i + 1] = d[i + 1] * 0.35;
        d[i + 2] = d[i + 2] * 0.5; // shift blue
      }
    }

    // Click ripples — expanding rings
    for (let i = input.ripples.length - 1; i >= 0; i--) {
      const rp = input.ripples[i];
      const r = Math.round(rp.radius);
      const ra = Math.round(rp.alpha * 180);
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

    // Cursor indicator — faint ring so you know where you're pointing
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
      // Use white (5) with manual alpha isn't possible in bitmap font, so use brightest color when visible
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
      const clusters = findClusters(world.motes);
      const info = `${world.phaseName.toUpperCase()} M:${world.motes.length} C:${clusters.length}`;
      drawText(rc.buf, 2, 2, info, 5);
      const fps = `${Math.round(1 / Math.max(dt, 0.001))} FPS`;
      drawTextRight(rc.buf, W - 2, 2, fps, 5);
    }

    present(rc.ctx, rc.buf);
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

/**
 * Compute a mote's display color from its temperament and energy.
 *
 * Wanderlust → warm tint (ember: restless, fire-touched).
 * Sociability → cool tint (sky: open, connective).
 * Hardiness → resists dimming at low energy (glows longer).
 *
 * Energy controls base brightness between the biome's dim and glow colors.
 * Temperament nudges hue so every creature reads as an individual.
 */
function computeMoteColor(m: Mote, bp: BiomePalette): [number, number, number] {
  const bright = PAL[bp.moteGlow];
  const dark = PAL[bp.moteDim];

  // Hardy motes resist fading — boost their apparent brightness when low on energy
  const hardyBoost = m.temperament.hardiness * 0.3 * (1 - m.energy);
  const t = Math.min(1, m.energy + hardyBoost);

  // Linear interpolate between dim and glow by effective brightness
  let r = dark[0] + (bright[0] - dark[0]) * t;
  let g = dark[1] + (bright[1] - dark[1]) * t;
  let b = dark[2] + (bright[2] - dark[2]) * t;

  // Wanderlust: shift toward warm ember (200, 80, 20)
  const wt = m.temperament.wanderlust * 0.35;
  r += (200 - r) * wt;
  g += (80 - g) * wt;
  b += (20 - b) * wt;

  // Sociability: shift toward cool sky (60, 160, 200)
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
