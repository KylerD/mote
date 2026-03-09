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

// Influence radius must match the constant in interaction.ts
const _FIELD_RADIUS = 30;

/** Render cursor indicator — warm glow disc with pulsing ring and force-field halo */
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

  // Pulsing inner ring
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

  // Force-field boundary ring — dotted circle at the influence radius.
  // Color shifts: cool-blue when attracting (calm), warm-red when scattering (fast swipe).
  const scatter = input.speed > 80;
  const fr = scatter ? 215 : 130;
  const fg = scatter ? 110 :  85;  // blue for calm, amber-red for scatter
  const fb = scatter ?  80 : 190;
  // 20 evenly-spaced dot positions, 10 rendered (every other = dashed)
  // Slow rotation: 0.18 rad/s attract, –0.28 rad/s repel
  const rotSpeed = scatter ? -0.28 : 0.18;
  const baseAngle = time * rotSpeed;
  const DOT_COUNT = 20;
  for (let d = 0; d < DOT_COUNT; d += 2) {
    const angle = baseAngle + (d / DOT_COUNT) * Math.PI * 2;
    const fx = Math.round(cx + Math.cos(angle) * _FIELD_RADIUS);
    const fy = Math.round(cy + Math.sin(angle) * _FIELD_RADIUS);
    // Gently pulse the alpha so the field feels alive
    const fieldPulse = Math.sin(time * 1.8 + d * 0.6) * 0.25 + 0.75;
    const baseAlpha = scatter ? 55 : input.calm ? 38 : 25;
    const fa = Math.round(baseAlpha * fieldPulse);
    setPixel(buf, fx, fy, fr, fg, fb, fa);
  }
}

// Per-event accent colors [r, g, b] — used for the under-glow and side gradient tint
const EVENT_ACCENTS: Record<string, [number, number, number]> = {
  flood:      [ 60, 130, 220],
  bloom:      [ 80, 200, 100],
  meteor:     [255, 140,  40],
  migration:  [ 80, 200, 200],
  eclipse:    [120,  60, 200],
  earthquake: [180, 120,  40],
  plague:     [130, 200,  60],
  aurora:     [ 60, 200, 230],
  drought:    [220, 160,  50],
};

/** Render event message — cinematic text card with gradient backing, accent glow, and letterbox bars */
export function renderEventMessage(
  buf: ImageData,
  event: ActiveEvent | null,
  time: number,
): void {
  if (!event || !isEventActive(event, time) || event.messageAlpha <= 0) return;
  const textW = measureText(event.message);
  const msgX = Math.floor((W - textW) / 2);
  const msgY = Math.floor(H * 0.3);
  const alpha = event.messageAlpha;
  const [ar, ag, ab] = EVENT_ACCENTS[event.type] ?? [220, 200, 160];

  // 0 — Letterbox bars: thin black bands at canvas top and bottom — cinematic crop effect.
  // Fade with the message so they arrive and leave gracefully.
  const barA = Math.round(alpha * 185);
  for (let bx = 0; bx < W; bx++) {
    setPixel(buf, bx,     0, 0, 0, 0, barA);
    setPixel(buf, bx,     1, 0, 0, 0, barA);
    setPixel(buf, bx, H - 1, 0, 0, 0, barA);
    setPixel(buf, bx, H - 2, 0, 0, 0, barA);
  }

  // 1 — Full-width dark gradient bar: opaque at center, fading to transparent at canvas edges
  const barY0 = msgY - 5;
  const barY1 = msgY + 11;
  const fadeW = Math.floor(W * 0.22);   // horizontal fade region on each side
  const centerAlpha = Math.round(alpha * 200);
  for (let by = barY0; by <= barY1; by++) {
    const yEdgeFalloff = by === barY0 || by === barY1 ? 0.35 : 1.0;
    for (let bx = 0; bx < W; bx++) {
      // Horizontal opacity: full in center band, fades out at edges
      let hFade = 1.0;
      if (bx < fadeW) hFade = bx / fadeW;
      else if (bx > W - fadeW) hFade = (W - bx) / fadeW;
      const ba = Math.round(centerAlpha * hFade * yEdgeFalloff);
      if (ba < 3) continue;
      // Tint: very subtly toward accent color at center, pure dark at edges
      const tint = hFade * 0.08;
      setPixel(buf, bx, by, Math.round(ar * tint), Math.round(ag * tint), Math.round(ab * tint), ba);
    }
  }

  // 2 — Accent glow line just below the text
  const glowY = msgY + 7;
  const glowW = Math.floor(textW * 0.7);
  const glowX0 = Math.floor((W - glowW) / 2);
  const glowAlpha = Math.round(alpha * 90);
  for (let gx = 0; gx < glowW; gx++) {
    const gFade = Math.sin((gx / glowW) * Math.PI);   // bell curve: bright at center
    const ga = Math.round(glowAlpha * gFade);
    if (ga < 3) continue;
    setPixel(buf, glowX0 + gx, glowY, ar, ag, ab, ga);
    // soft halo above and below the line
    setPixel(buf, glowX0 + gx, glowY - 1, ar, ag, ab, Math.round(ga * 0.4));
    setPixel(buf, glowX0 + gx, glowY + 1, ar, ag, ab, Math.round(ga * 0.25));
  }

  // 3 — Text — bright white during display, shifts toward accent on fade-out
  const colorIndex = alpha > 0.3 ? 5 : 4;
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
