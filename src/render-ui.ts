// render-ui.ts — Cursor, ripples, event message, debug overlay.

import { W, H } from "./config";
import type { Interaction } from "./types";
import { setPixel } from "./render";
import { drawText, drawTextRight, measureText } from "./font";
import { isEventActive } from "./events";
import type { ActiveEvent } from "./types";

/** Render click ripples — with warm energy burst on fresh clicks */
export function renderRipples(buf: ImageData, input: Interaction, dt: number): void {
  for (let i = input.ripples.length - 1; i >= 0; i--) {
    const rp = input.ripples[i];
    const cx = Math.round(rp.x);
    const cy = Math.round(rp.y);

    // Fresh ripple: warm energy burst at click center (bloomed → soft halo)
    if (rp.alpha > 0.82) {
      const burstT = (rp.alpha - 0.82) / 0.18;
      const burstR = 5;
      for (let dy = -burstR; dy <= burstR; dy++) {
        for (let dx = -burstR; dx <= burstR; dx++) {
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > burstR) continue;
          const falloff = 1 - dist / burstR;
          const ga = Math.round(burstT * falloff * falloff * 210);
          if (ga > 3) setPixel(buf, cx + dx, cy + dy, 255, 230, 170, ga);
        }
      }
    }

    // Expanding ring
    const r = Math.round(rp.radius);
    const ra = Math.round(rp.alpha * 180);
    const r2inner = (r - 1) * (r - 1);
    const r2outer = (r + 1) * (r + 1);
    for (let dy = -r - 1; dy <= r + 1; dy++) {
      for (let dx = -r - 1; dx <= r + 1; dx++) {
        const d2 = dx * dx + dy * dy;
        if (d2 >= r2inner && d2 <= r2outer) {
          setPixel(buf, cx + dx, cy + dy, 220, 224, 228, ra);
        }
      }
    }

    rp.radius += dt * 30;
    rp.alpha -= dt * 2.2;
    if (rp.alpha <= 0) input.ripples.splice(i, 1);
  }
}

/** Render cursor indicator — warm glow disc with pulsing ring */
export function renderCursor(buf: ImageData, input: Interaction, time: number): void {
  if (!input.present) return;
  const cx = Math.round(input.x);
  const cy = Math.round(input.y);

  // Soft warm glow beneath the cursor
  const glowR = 9;
  for (let dy = -glowR; dy <= glowR; dy++) {
    for (let dx = -glowR; dx <= glowR; dx++) {
      const d2 = dx * dx + dy * dy;
      if (d2 > glowR * glowR) continue;
      const falloff = 1 - Math.sqrt(d2) / glowR;
      const ga = Math.round(falloff * falloff * 28);
      if (ga > 1) setPixel(buf, cx + dx, cy + dy, 230, 210, 170, ga);
    }
  }

  // Pulsing outer ring
  const pulse = Math.sin(time * 2.5) * 0.15 + 0.85;
  const cr = 5;
  const cr2inner = (cr - 1) * (cr - 1);
  const cr2outer = cr * cr;
  const ringA = Math.round(55 * pulse);
  for (let dy = -cr; dy <= cr; dy++) {
    for (let dx = -cr; dx <= cr; dx++) {
      const d2 = dx * dx + dy * dy;
      if (d2 >= cr2inner && d2 <= cr2outer) {
        setPixel(buf, cx + dx, cy + dy, 225, 215, 195, ringA);
      }
    }
  }
}

/** Render event message flash — text with dark backing for readability */
export function renderEventMessage(
  buf: ImageData,
  event: ActiveEvent | null,
  time: number,
): void {
  if (!event || !isEventActive(event, time) || event.messageAlpha <= 0) return;
  const textW = measureText(event.message);
  const msgX = Math.floor((W - textW) / 2);
  const msgY = Math.floor(H * 0.3);
  // Dark semi-transparent backing rectangle
  const padX = 5;
  const padY = 3;
  const bgAlpha = Math.round(event.messageAlpha * 180);
  for (let by = msgY - padY; by <= msgY + 5 + padY; by++) {
    for (let bx = msgX - padX; bx <= msgX + textW + padX; bx++) {
      setPixel(buf, bx, by, 0, 0, 0, bgAlpha);
    }
  }
  const colorIndex = event.messageAlpha > 0.3 ? 5 : 4;
  drawText(buf, msgX, msgY, event.message, colorIndex);
}

/** Render debug overlay */
export function renderDebugOverlay(
  buf: ImageData,
  phaseName: string,
  moteCount: number,
  clusterCount: number,
  dt: number,
): void {
  const info = `${phaseName.toUpperCase()} M:${moteCount} C:${clusterCount}`;
  drawText(buf, 2, 2, info, 5);
  const fps = `${Math.round(1 / Math.max(dt, 0.001))} FPS`;
  drawTextRight(buf, W - 2, 2, fps, 5);
}
