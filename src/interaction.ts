// interaction.ts — Cursor as gentle force in the tiny world.

import { W, H } from "./config";
import type { Mote, Interaction, Ripple } from "./types";
import {
  PULSE_INITIAL_RADIUS, RIPPLE_INITIAL_ALPHA,
  PULSE_FORCE_H, PULSE_FORCE_V, GRAVITY_VERTICAL_REDUCTION,
} from "./constants";

// Re-export for backward compatibility
export type { Interaction, Ripple };

const INFLUENCE_RADIUS = 30;
const GRAVITY_STRENGTH = 12;
const SCATTER_THRESHOLD = 80;
const SCATTER_FORCE = 20;
const CALM_DAMPING = 0.93;
const CALM_SECONDS = 1.0;
const PULSE_RADIUS = 36;
const PULSE_ENERGY = 0.12;

export function createInteraction(canvas: HTMLCanvasElement): Interaction {
  const ix: Interaction = {
    x: -1, y: -1, present: false, calm: false, speed: 0, pulses: [], ripples: [],
  };

  let lastX = 0, lastY = 0, lastMove = 0, calmTimer = 0;

  function toWorld(clientX: number, clientY: number): [number, number] {
    const rect = canvas.getBoundingClientRect();
    return [
      ((clientX - rect.left) / rect.width) * W,
      ((clientY - rect.top) / rect.height) * H,
    ];
  }

  canvas.addEventListener("mousemove", (e) => {
    const [wx, wy] = toWorld(e.clientX, e.clientY);
    const now = performance.now() / 1000;
    const dt = now - lastMove;
    if (dt > 0) {
      const dx = wx - lastX, dy = wy - lastY;
      ix.speed = Math.sqrt(dx * dx + dy * dy) / dt;
    }
    ix.x = wx; ix.y = wy; ix.present = true;
    lastX = wx; lastY = wy; lastMove = now;
    calmTimer = 0; ix.calm = false;
  });

  canvas.addEventListener("mouseleave", () => { ix.present = false; ix.speed = 0; });
  canvas.addEventListener("mouseenter", () => { ix.present = true; });

  canvas.addEventListener("click", (e) => {
    const [wx, wy] = toWorld(e.clientX, e.clientY);
    ix.pulses.push({ x: wx, y: wy });
    ix.ripples.push({ x: wx, y: wy, radius: PULSE_INITIAL_RADIUS, alpha: RIPPLE_INITIAL_ALPHA });
  });

  // Touch
  canvas.addEventListener("touchmove", (e) => {
    e.preventDefault();
    const t = e.touches[0];
    const [wx, wy] = toWorld(t.clientX, t.clientY);
    ix.x = wx; ix.y = wy; ix.present = true;
  }, { passive: false });

  canvas.addEventListener("touchstart", (e) => {
    const t = e.touches[0];
    const [wx, wy] = toWorld(t.clientX, t.clientY);
    ix.x = wx; ix.y = wy; ix.present = true;
    ix.pulses.push({ x: wx, y: wy });
    ix.ripples.push({ x: wx, y: wy, radius: PULSE_INITIAL_RADIUS, alpha: RIPPLE_INITIAL_ALPHA });
  });

  canvas.addEventListener("touchend", () => { ix.present = false; });

  setInterval(() => {
    if (ix.present) {
      calmTimer += 0.1;
      if (calmTimer >= CALM_SECONDS) ix.calm = true;
    }
  }, 100);

  return ix;
}

export function applyInteraction(ix: Interaction, motes: Mote[]): void {
  if (!ix.present) return;

  for (const m of motes) {
    const dx = ix.x - m.x;
    const dy = ix.y - m.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > INFLUENCE_RADIUS || dist < 0.5) continue;

    const nx = dx / dist;
    const ny = dy / dist;
    const falloff = 1 - dist / INFLUENCE_RADIUS;

    if (ix.calm) {
      m.vx *= CALM_DAMPING;
    }

    if (ix.speed > SCATTER_THRESHOLD) {
      m.forceX = -nx * SCATTER_FORCE * falloff;
      m.forceY = -ny * SCATTER_FORCE * falloff;
    } else {
      m.forceX = nx * GRAVITY_STRENGTH * falloff;
      m.forceY = ny * GRAVITY_STRENGTH * falloff * GRAVITY_VERTICAL_REDUCTION; // less vertical pull
    }
  }

  // Pulses
  for (const p of ix.pulses) {
    for (const m of motes) {
      const dx = m.x - p.x;
      const dy = m.y - p.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > PULSE_RADIUS) continue;
      const falloff = 1 - dist / PULSE_RADIUS;
      m.energy = Math.min(1, m.energy + PULSE_ENERGY * falloff);
      if (dist > 0.5) {
        m.forceX += (dx / dist) * PULSE_FORCE_H * falloff;
        m.forceY += (dy / dist) * PULSE_FORCE_V * falloff;
      }
    }
  }
  ix.pulses = [];
}
