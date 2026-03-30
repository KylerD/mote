// weather-render.ts — Weather rendering: celestial bodies, clouds, particles, lightning, fog, darkening.

import { W, H } from "./config";
import type { Weather, Biome } from "./types";
import { setPixel } from "./render";
import { noise2 } from "./noise";

/**
 * Compute sun position from cycle progress — rises east, arcs to zenith, sets west.
 * Visible from early exploration through end of dissolution.
 */
function getSunArc(cycleProgress: number): { x: number; y: number; visible: boolean; horizonGlow: number } {
  // Arc spans 0.06 (pre-dawn) → 0.90 (sunset)
  const arcT = (cycleProgress - 0.06) / 0.84;
  if (arcT <= 0 || arcT >= 1) return { x: 0, y: 0, visible: false, horizonGlow: 0 };

  const x = Math.round(W * 0.04 + arcT * W * 0.92);
  // Parabolic arc — high noon at arcT=0.5
  const y = Math.round(H * 0.54 - Math.sin(Math.PI * arcT) * H * 0.46);

  // Fade out near horizon (low arcT/high arcT = sunrise/sunset color shift)
  const horizonGlow = Math.max(0, 1 - Math.abs(arcT - 0.5) * 2.8); // 0 at horizon, 1 at noon
  const visible = y < H * 0.88;

  return { x, y, visible, horizonGlow };
}

/**
 * Compute moon position from cycle progress — rises during dissolution, peaks in silence.
 * Uses the moon's seeded phase for the crescent shape.
 */
function getMoonArc(cycleProgress: number): { x: number; y: number; visible: boolean } {
  // Moon rises from ~75% of cycle (mid-dissolution) through silence
  const moonT = (cycleProgress - 0.72) / 0.30;
  if (moonT <= 0) return { x: 0, y: 0, visible: false };

  const t = Math.min(1, moonT);
  const x = Math.round(W * 0.08 + t * W * 0.50);
  // Gentle arc — doesn't have time to go high before cycle ends
  const y = Math.round(H * 0.48 - Math.sin(Math.PI * Math.min(t, 0.7)) * H * 0.32);
  return { x, y, visible: y < H * 0.85 };
}

/** Render a star field — fades in at genesis (pre-dawn) and at dissolution/dusk */
function renderStarField(buf: ImageData, time: number, cycleProgress: number, weatherType: string): void {
  // Morning stars: full at genesis, fade out through early exploration (dawn)
  const morningIntensity = cycleProgress < 0.06  ? 1.0
    : cycleProgress < 0.18 ? 1.0 - (cycleProgress - 0.06) / 0.12
    : 0;

  // Evening stars: fade in at late dissolution, full through silence
  const eveningIntensity = Math.max(0, Math.min(1, (cycleProgress - 0.78) / 0.10));

  const intensity = Math.max(morningIntensity, eveningIntensity);
  if (intensity <= 0) return;

  // Storm/overcast blocks most stars, fog dims them
  const weatherFactor =
    weatherType === "storm" || weatherType === "overcast" ? 0.08 :
    weatherType === "fog" ? 0.30 : 1.0;
  const baseAlpha = intensity * weatherFactor * 195;
  if (baseAlpha < 4) return;

  // 140 deterministic stars across the upper sky
  for (let i = 0; i < 140; i++) {
    const sx = Math.abs((i * 8191 + 23747) % W);
    const sy = Math.abs((i * 5381 + 11317) % Math.floor(H * 0.58));
    const twinkle = Math.sin(time * (1.0 + i * 0.23) + i * 1.9) * 0.32 + 0.68;
    const sa = Math.round(baseAlpha * twinkle);
    if (sa < 5) continue;

    // Stars vary: warm yellow-white giants, cool blue-white, faint common white
    const kind = i % 9;
    if (kind === 0) {
      // Bright warm giant — 2-pixel cross for prominence
      setPixel(buf, sx, sy, 255, 240, 180, sa);
      setPixel(buf, sx + 1, sy, 255, 240, 180, Math.round(sa * 0.5));
      setPixel(buf, sx - 1, sy, 255, 240, 180, Math.round(sa * 0.5));
    } else if (kind === 1) {
      setPixel(buf, sx, sy, 180, 205, 255, sa);  // blue-white
    } else if (kind === 2) {
      setPixel(buf, sx, sy, 255, 210, 150, Math.round(sa * 0.75)); // amber
    } else {
      setPixel(buf, sx, sy, 215, 220, 238, sa);  // common white
    }
  }

  // Milky Way: soft diagonal band of dense faint stars during clear nights
  if (intensity > 0.35 && weatherFactor >= 1.0) {
    for (let mx = 0; mx < W; mx++) {
      // Band runs diagonally: upper-left to lower-right across the night sky
      const bandCY = H * (0.13 + (mx / W) * 0.14);
      const bandwidth = 5;

      for (let dy = -bandwidth; dy <= bandwidth; dy++) {
        const my = Math.round(bandCY + dy);
        if (my < 0 || my >= Math.floor(H * 0.56)) continue;

        const bandFrac = 1 - Math.abs(dy) / (bandwidth + 1);
        const bandNoise = noise2(mx * 0.09 + 41.3, my * 0.14 + 88.7) * 0.5 + 0.5;
        const density = bandFrac * bandFrac * bandNoise * intensity;
        const sa = Math.round(density * 42);
        if (sa < 4) continue;

        setPixel(buf, mx, my, 178, 188, 218, sa);
      }
    }
  }
}

/** Render celestial body (sun or moon) — call before terrain for background effect */
export function renderCelestial(buf: ImageData, weather: Weather, time: number, cycleProgress = 0.5): void {
  const { celestial } = weather;

  // Star field always rendered (fades in at dusk regardless of weather)
  renderStarField(buf, time, cycleProgress, weather.type);

  if (celestial.type === "none") return;

  if (celestial.type === "sun") {
    const { x: cx, y: cy, visible, horizonGlow } = getSunArc(cycleProgress);
    if (!visible) return;

    const pulse = Math.sin(time * 0.5) * 0.06 + 0.94;

    // Horizon glow: warm orange corona at sunrise/sunset, white at noon
    const coronaR = Math.round(255);
    const coronaG = Math.round(160 + horizonGlow * 60);  // more yellow at noon
    const coronaB = Math.round(40 + horizonGlow * 80);   // more white at noon

    // Corona glow (large, faint)
    for (let dy = -10; dy <= 10; dy++) {
      for (let dx = -10; dx <= 10; dx++) {
        const d2 = dx * dx + dy * dy;
        if (d2 > 100) continue;
        const falloff = 1 - Math.sqrt(d2) / 10;
        const a = Math.round(falloff * falloff * 50 * pulse);
        if (a > 1) setPixel(buf, cx + dx, cy + dy, coronaR, coronaG, coronaB, a);
      }
    }

    // Sun disc (3px radius) — redder near horizon
    const discR = 255;
    const discG = Math.round(140 + horizonGlow * 80);
    const discB = Math.round(20 + horizonGlow * 80);
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        const d2 = dx * dx + dy * dy;
        if (d2 > 9) continue;
        const falloff = 1 - Math.sqrt(d2) / 3;
        const bright = Math.round(200 + falloff * 55);
        const a = Math.round((180 + falloff * 75) * pulse);
        setPixel(buf, cx + dx, cy + dy,
          Math.min(255, Math.round(discR * bright / 200)),
          Math.min(255, Math.round(discG * bright / 200)),
          Math.min(255, Math.round(discB * bright / 200)), a);
      }
    }

    // Rays (only when sun is high enough — no rays at horizon)
    if (horizonGlow > 0.2) {
      const rayLen = 4 + Math.round(Math.sin(time * 0.8) * 2);
      const rays: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]];
      for (const [rdx, rdy] of rays) {
        for (let i = 4; i < 4 + rayLen; i++) {
          const ra = Math.round((1 - (i - 4) / rayLen) * 50 * pulse * horizonGlow);
          if (ra > 0) setPixel(buf, cx + rdx * i, cy + rdy * i, 255, coronaG, coronaB, ra);
        }
      }
    }
  } else if (celestial.type === "moon") {
    const { x: cx, y: cy, visible } = getMoonArc(cycleProgress);
    if (!visible) return;

    const phase = celestial.phase;
    // Moon alpha fades in with cycleProgress
    const moonFade = Math.min(1, Math.max(0, (cycleProgress - 0.72) / 0.10));

    // Moon glow
    for (let dy = -6; dy <= 6; dy++) {
      for (let dx = -6; dx <= 6; dx++) {
        const d2 = dx * dx + dy * dy;
        if (d2 > 36) continue;
        const falloff = 1 - Math.sqrt(d2) / 6;
        const a = Math.round(falloff * falloff * 30 * moonFade);
        if (a > 1) setPixel(buf, cx + dx, cy + dy, 170, 195, 235, a);
      }
    }

    // Moon disc (2px radius) with crescent shadow
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const d2 = dx * dx + dy * dy;
        if (d2 > 4) continue;
        const shadowOffset = (phase - 0.5) * 4;
        const inShadow = dx < shadowOffset;
        if (inShadow) {
          setPixel(buf, cx + dx, cy + dy, 30, 38, 58, Math.round(180 * moonFade));
        } else {
          setPixel(buf, cx + dx, cy + dy, 205, 218, 242, Math.round(220 * moonFade));
        }
      }
    }
  }
}

/** Render clouds — call after terrain for overlay effect */
export function renderClouds(buf: ImageData, weather: Weather, time: number, biome: Biome = "temperate"): void {
  for (const cloud of weather.clouds) {
    const cx = cloud.x;
    const cy = cloud.y;
    const hw = cloud.width / 2;
    const hh = cloud.height / 2;

    for (let dy = -Math.ceil(hh); dy <= Math.ceil(hh); dy++) {
      for (let dx = -Math.ceil(hw); dx <= Math.ceil(hw); dx++) {
        const px = Math.round(cx + dx);
        const py = Math.round(cy + dy);
        if (px < 0 || px >= W || py < 0 || py >= H) continue;

        // Elliptical falloff
        const nx = dx / hw;
        const ny = dy / hh;
        const d2 = nx * nx + ny * ny;
        if (d2 > 1) continue;

        // Noise-shaped edges
        const noiseVal = noise2(px * 0.15 + time * 0.3, py * 0.15 + cloud.speed * 0.01) * 0.5 + 0.5;
        const edgeFade = 1 - d2;
        const shape = edgeFade * noiseVal;
        if (shape < 0.2) continue;

        const a = Math.round(shape * cloud.density * 255);
        if (a < 3) continue;

        // Cloud color: vertical gradient — bright tops, darker bases for depth
        // vertT = 0 at top, 1 at bottom
        const vertT = (dy + Math.ceil(hh)) / Math.max(1, 2 * Math.ceil(hh));
        let cr: number, cg: number, cb: number;
        if (weather.type === "storm") {
          // Storm: very dark bottom (threatening), lighter grey top
          const v = Math.round(130 - vertT * 80);
          cr = v - 8; cg = v; cb = v + 12;
        } else if (weather.type === "overcast") {
          // Overcast: flat mid-grey with slight dark belly — slightly biome-tinted
          const v = Math.round(158 - vertT * 28);
          if (biome === "desert") {
            cr = v + 10; cg = v + 4; cb = v - 8;   // warm ochre haze
          } else if (biome === "volcanic") {
            cr = v - 5; cg = v - 6; cb = v - 4;    // darker ashen
          } else {
            cr = v; cg = v + 2; cb = v + 8;
          }
        } else {
          // Clear/fog/snow: biome-tinted clouds
          const blueBoost = Math.round((1 - vertT) * 18);
          if (biome === "desert") {
            // Dusty warm ochre — sun-bleached clouds
            cr = 212; cg = 203; cb = 184 + Math.round(blueBoost * 0.3);
          } else if (biome === "tundra") {
            // Icy pale blue — cold high-altitude
            cr = 185; cg = 198; cb = 222 + blueBoost;
          } else if (biome === "volcanic") {
            // Ashen grey — heavy with particulates
            cr = 172; cg = 168; cb = 166 + Math.round(blueBoost * 0.4);
          } else if (biome === "lush") {
            // Bright with faint green tint — humid tropical
            cr = 200; cg = 215; cb = 208 + Math.round(blueBoost * 0.5);
          } else {
            // Temperate: clean white
            cr = 205; cg = 210; cb = 218 + blueBoost;
          }
        }
        setPixel(buf, px, py, cr, cg, cb, a);
      }
    }
  }
}

/**
 * Tundra ambient aurora — softly glowing curtains of light in the night sky.
 * Activates during dissolution/silence in tundra biome. Three ribbon bands:
 * dominant green, cyan-blue accent, violet fringe — each undulating independently.
 * Call after renderCelestial so aurora overlays the star field.
 */
export function applyTundraAurora(
  buf: ImageData,
  biome: Biome,
  time: number,
  cycleProgress: number,
  weatherType: string,
): void {
  if (biome !== "tundra") return;

  // Aurora fades in during dissolution, peaks at full silence
  const fadeIn = Math.max(0, Math.min(1, (cycleProgress - 0.70) / 0.12));
  if (fadeIn <= 0) return;

  // Heavy cloud cover kills the aurora; light rain/fog dims it
  if (weatherType === "storm" || weatherType === "overcast") return;
  const wf = weatherType === "rain" ? 0.30 : weatherType === "fog" ? 0.55 : 1.0;

  const d = buf.data;

  // Three aurora ribbons: [baseY, yAmplitude, xFrequency, xSpeed, bandWidth, r, g, b]
  // Positions are fractions of H; colors are peak additive RGB
  const ribbons: [number, number, number, number, number, number, number, number][] = [
    [H * 0.11, H * 0.036, 0.040,  0.30, H * 0.088, 28, 190, 105],  // green (dominant)
    [H * 0.17, H * 0.028, 0.058, -0.24, H * 0.055, 40, 122, 222],  // cyan-blue
    [H * 0.13, H * 0.022, 0.030,  0.38, H * 0.042, 158, 44, 215],  // violet accent
  ];

  for (let x = 0; x < W; x++) {
    // Curtain intensity varies along X — creates shimmering column structures
    const curtainX = noise2(x * 0.08 + time * 0.06, 47.3) * 0.5 + 0.5;
    const xStr = curtainX * curtainX; // sharpen variation

    for (const [yBase, yAmp, freq, spd, bw, rr, gg, bb] of ribbons) {
      // Dual-frequency undulation — primary wave + harmonic for organic feel
      const yc = yBase
        + Math.sin(x * freq + time * spd) * yAmp
        + Math.sin(x * freq * 0.52 + time * spd * 1.7 + 2.1) * yAmp * 0.35;

      const yMin = Math.max(0, Math.floor(yc - bw * 2.6));
      const yMax = Math.min(Math.floor(H * 0.50), Math.ceil(yc + bw * 2.6));

      for (let y = yMin; y <= yMax; y++) {
        const dy = Math.abs(y - yc);
        // Gaussian falloff from band center
        const falloff = Math.exp(-(dy * dy) / (bw * bw * 0.52));
        if (falloff < 0.04) continue;

        // Vertical curtain shimmer — makes it look like draped light
        const shimmer = noise2(x * 0.22 + time * 0.18, y * 0.14 + time * 0.10) * 0.5 + 0.5;
        const str = falloff * shimmer * xStr * fadeIn * wf;
        if (str < 0.04) continue;

        const pi = (y * W + x) * 4;
        d[pi]     = Math.min(255, d[pi]     + Math.round(rr * str * 0.70));
        d[pi + 1] = Math.min(255, d[pi + 1] + Math.round(gg * str * 0.70));
        d[pi + 2] = Math.min(255, d[pi + 2] + Math.round(bb * str * 0.70));
      }
    }
  }
}

/** Render rain/snow particles — biome-appropriate colors and shapes */
export function renderParticles(buf: ImageData, weather: Weather, biome: Biome = "temperate"): void {
  const isSnow = weather.type === "snow";

  for (const p of weather.particles) {
    const px = Math.round(p.x);
    const py = Math.round(p.y);
    const a = Math.round(p.alpha);

    if (isSnow) {
      // Tundra: denser blue-tinted blizzard. Others: normal snow.
      const sr = biome === "tundra" ? 210 : 230;
      const sg = biome === "tundra" ? 218 : 235;
      const sb = biome === "tundra" ? 240 : 245;
      setPixel(buf, px, py, sr, sg, sb, a);
      if (p.size > 0) {
        const halfA = Math.round(a * 0.5);
        setPixel(buf, px + 1, py, sr - 10, sg - 10, sb, halfA);
        setPixel(buf, px, py + 1, sr - 10, sg - 10, sb, halfA);
      }
    } else if (biome === "desert") {
      // Desert: sand/dust streaks — warm ochre, angled, faster falling
      setPixel(buf, px, py, 200, 155, 80, a);
      setPixel(buf, px - 1, py - 1, 180, 135, 60, Math.round(a * 0.6));
      if (p.size > 0) {
        setPixel(buf, px - 2, py - 2, 160, 115, 45, Math.round(a * 0.3));
      }
    } else if (biome === "volcanic") {
      // Volcanic: dark grey ash flakes — slow, large, irregular
      const ashR = 60 + Math.round(p.alpha * 0.1);
      const ashG = 55 + Math.round(p.alpha * 0.08);
      const ashB = 50;
      setPixel(buf, px, py, ashR, ashG, ashB, a);
      if (p.size > 0) {
        // Ash clumps slightly wider
        setPixel(buf, px + 1, py, ashR - 10, ashG - 10, ashB, Math.round(a * 0.6));
        setPixel(buf, px, py + 1, ashR - 8, ashG - 8, ashB, Math.round(a * 0.5));
      }
    } else {
      // Temperate / lush: blue-white rain streaks (2-3px tall for motion blur)
      const rainB = biome === "lush" ? 205 : 220;
      setPixel(buf, px, py, 155, 175, rainB, a);
      setPixel(buf, px, py - 1, 135, 158, rainB - 10, Math.round(a * 0.6));
      if (p.size > 0) {
        setPixel(buf, px, py - 2, 115, 142, rainB - 20, Math.round(a * 0.3));
      }
    }
  }
}

/** Render lightning flash — bright overlay across the whole scene, with a forking secondary branch */
export function renderLightning(buf: ImageData, weather: Weather): void {
  if (!weather.lightning.active) return;

  const brightness = weather.lightning.brightness;
  const d = buf.data;

  // Full-screen flash
  const flashA = Math.round(brightness * 80);
  for (let i = 0; i < d.length; i += 4) {
    d[i]     = Math.min(255, d[i] + flashA);
    d[i + 1] = Math.min(255, d[i + 1] + flashA);
    d[i + 2] = Math.min(255, d[i + 2] + Math.round(flashA * 1.2));
  }

  // Main bolt: jagged vertical line from cloud to ground
  const bx = weather.lightning.x;
  const boltAlpha = Math.round(brightness * 255);
  const forkY = Math.floor(H * 0.35); // fork branches off ~35% down
  let y = 5, x = bx;
  let forkX = bx; // x position at the fork point — recorded mid-traversal

  while (y < H * 0.7) {
    setPixel(buf, x, y, 255, 255, 255, boltAlpha);
    setPixel(buf, x - 1, y, 200, 210, 255, Math.round(boltAlpha * 0.4));
    setPixel(buf, x + 1, y, 200, 210, 255, Math.round(boltAlpha * 0.4));
    if (y === forkY) forkX = x;
    y += 1;
    x += (Math.floor(y * 3.7 + bx) % 3) - 1;
  }

  // Fork branch — dimmer, shorter, diverges from the main bolt via a different phase offset
  // Uses a different zigzag phase (+5.7) so it naturally separates from the main trajectory
  const forkAlpha = Math.round(boltAlpha * 0.46);
  const forkEnd = Math.min(Math.floor(H * 0.78), forkY + Math.floor(H * 0.26));
  let fy = forkY, fx = forkX;
  while (fy < forkEnd) {
    setPixel(buf, fx, fy, 210, 225, 255, forkAlpha);
    setPixel(buf, fx - 1, fy, 160, 180, 255, Math.round(forkAlpha * 0.35));
    fy += 1;
    fx += (Math.floor(fy * 3.7 + bx + 5.7) % 3) - 1;
  }
}

/** Simple integer hash for deterministic random from a seed value */
function seedHash(n: number): number {
  let x = (n ^ 0x9e3779b9) >>> 0;
  x = ((x ^ (x >>> 16)) * 0x45d9f3b) >>> 0;
  x = ((x ^ (x >>> 16)) * 0x45d9f3b) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  return x / 0xffffffff;
}

/**
 * God rays — crepuscular light shafts radiating from the sun downward through the sky.
 * Strongest when the sun is high (exploration through complexity phases).
 * Blocked by storm, overcast, and fog. Dimmed by rain and snow.
 * Each biome's sun has its own quality of light — volcanic rays burn amber-red through ash,
 * tundra rays arrive cold and blue-white, desert rays bleach, lush rays carry warmth and green.
 * Call after renderCelestial, before renderClouds.
 */
export function applyGodRays(
  buf: ImageData,
  weather: Weather,
  time: number,
  cycleProgress: number,
  biome: Biome = "temperate",
): void {
  if (weather.type === "storm" || weather.type === "overcast" || weather.type === "fog") return;

  const { x: cx, y: cy, visible, horizonGlow } = getSunArc(cycleProgress);
  // Only when sun is reasonably high — low-sun rays intersect terrain
  if (!visible || horizonGlow < 0.15) return;

  // Strength scales with sun height; softened so rays enhance the sky without dominating it
  const baseStr = horizonGlow * 0.42;
  const weatherMod = (weather.type === "rain" || weather.type === "snow") ? 0.28 : 1.0;
  const rayStr = baseStr * weatherMod;
  if (rayStr < 0.04) return;

  // Biome-tuned ray tint: each world's sun has its own character
  let rayR: number, rayG: number, rayB: number;
  switch (biome) {
    case "volcanic":
      // Amber-red filtered through ash and particulates — the sun bleeds through smoke
      rayR = 1.38; rayG = 0.52; rayB = 0.16; break;
    case "tundra":
      // Cold blue-white — thin atmosphere, no warmth in these rays
      rayR = 0.68; rayG = 0.94; rayB = 1.44; break;
    case "desert":
      // Bleached golden-white — intense overhead sun, almost no color left
      rayR = 1.24; rayG = 1.02; rayB = 0.50; break;
    case "lush":
      // Green-gold — filtered through humidity and canopy scatter
      rayR = 0.90; rayG = 1.14; rayB = 0.42; break;
    default:
      // Temperate: warm golden afternoon light
      rayR = 1.10; rayG = 0.82; rayB = 0.30; break;
  }

  const d = buf.data;
  // Clamp ray pixels to sky area — don't bleed into terrain
  const RAY_MAX_Y = Math.floor(H * 0.70);
  const RAY_LEN = 68;

  // 12 ray directions fanning below the sun, degrees from straight down (screen-space)
  const ANGLES = [-56, -44, -32, -21, -11, -3, 3, 11, 21, 32, 44, 56];

  for (const angleDeg of ANGLES) {
    const rad = angleDeg * Math.PI / 180;
    const stepX = Math.sin(rad);
    const stepY = Math.cos(rad); // +y = downward in screen coords

    // Slow shimmer per ray for living atmospheric feel
    const shimmer = Math.sin(time * 0.55 + angleDeg * 0.21) * 0.18 + 0.82;
    // Per-ray variance: each shaft has its own persistent brightness (cloud-gap simulation)
    const rayVariance = 0.55 + seedHash(Math.abs(angleDeg) * 13 + 7) * 0.45;
    const rFinal = rayStr * shimmer * rayVariance;

    for (let step = 2; step < RAY_LEN; step++) {
      const rx = cx + Math.round(stepX * step);
      const ry = cy + Math.round(stepY * step);
      if (rx < 0 || rx >= W || ry < 0 || ry > RAY_MAX_Y) continue;

      const falloff = (1 - step / RAY_LEN) * (1 - step / RAY_LEN);
      const a = Math.round(rFinal * falloff * 70);
      if (a < 2) continue;

      const pi = (ry * W + rx) * 4;
      d[pi]     = Math.min(255, d[pi]     + Math.round(a * rayR));
      d[pi + 1] = Math.min(255, d[pi + 1] + Math.round(a * rayG));
      d[pi + 2] = Math.min(255, d[pi + 2] + Math.round(a * rayB));

      // Soft glow beside each ray for feathered edge
      const a2 = Math.round(a * 0.40);
      if (rx - 1 >= 0) {
        const pi3 = (ry * W + rx - 1) * 4;
        d[pi3]     = Math.min(255, d[pi3]     + Math.round(a2 * rayR));
        d[pi3 + 1] = Math.min(255, d[pi3 + 1] + Math.round(a2 * rayG));
        d[pi3 + 2] = Math.min(255, d[pi3 + 2] + Math.round(a2 * rayB));
      }
      if (rx + 1 < W) {
        const pi2 = (ry * W + rx + 1) * 4;
        d[pi2]     = Math.min(255, d[pi2]     + Math.round(a2 * rayR));
        d[pi2 + 1] = Math.min(255, d[pi2 + 1] + Math.round(a2 * rayG));
        d[pi2 + 2] = Math.min(255, d[pi2 + 2] + Math.round(a2 * rayB));
      }
    }
  }
}

/**
 * Shooting stars during genesis (pre-dawn) and silence — brief bright diagonal streaks
 * across the night sky. Deterministic from cycleNumber so all viewers see the same events.
 * Up to 2 shooting stars per window, each appearing in its respective 24-second night phase.
 * Call after renderCelestial, before renderClouds.
 */
export function renderShootingStars(
  buf: ImageData,
  cycleProgress: number,
  cycleNumber: number,
  weatherType: string,
): void {
  if (weatherType === "storm" || weatherType === "overcast") return;

  const inGenesis = cycleProgress >= 0.01 && cycleProgress < 0.09;
  const inSilence = cycleProgress >= 0.92;
  if (!inGenesis && !inSilence) return;

  const wMod = weatherType === "fog" ? 0.30 : 1.0;

  // Shared star renderer: draws one shooting star given its seed base and local time 0→1
  const renderStar = (tInWindow: number, base: number): void => {
    const startT = seedHash(base + 1) * 0.58;
    const durT   = 0.07 + seedHash(base + 2) * 0.18;
    const localT = (tInWindow - startT) / durT;
    if (localT < 0 || localT > 1) return;

    const sx = Math.round(W * (0.06 + seedHash(base + 3) * 0.60));
    const sy = Math.round(H * (0.03 + seedHash(base + 4) * 0.25));
    const ex = Math.round(sx + (22 + seedHash(base + 5) * 38) * (seedHash(base + 8) > 0.35 ? 1 : -1));
    const ey = Math.round(sy + 10 + seedHash(base + 6) * 22);

    const px = Math.round(sx + (ex - sx) * localT);
    const py = Math.round(sy + (ey - sy) * localT);

    // Head: bright white-gold, fades toward end of streak
    const headA = Math.round((1 - localT * 0.65) * 235 * wMod);
    if (headA > 3) setPixel(buf, px, py, 255, 252, 228, headA);

    // Trail: 5 segments stepping back along the trajectory
    for (let t = 1; t <= 5; t++) {
      const tp = Math.max(0, localT - t * 0.09);
      const tx = Math.round(sx + (ex - sx) * tp);
      const ty = Math.round(sy + (ey - sy) * tp);
      const ta = Math.round((1 - localT * 0.5) * (185 - t * 38) * wMod);
      if (ta < 4) break;
      setPixel(buf, tx, ty, 218, 214, 198, ta);
    }
  };

  // Genesis pre-dawn: up to 2 shooting stars in the dark before sunrise
  // Use a distinct seed offset so genesis and silence stars are always different
  if (inGenesis) {
    const tInGenesis = (cycleProgress - 0.01) / 0.08;
    for (let i = 0; i < 2; i++) {
      renderStar(tInGenesis, cycleNumber * 2713 + i * 491 + 131);
    }
  }

  // Silence: up to 2 shooting stars (original behavior, preserved exactly)
  if (inSilence) {
    const tInSilence = (cycleProgress - 0.92) / 0.08;
    for (let i = 0; i < 2; i++) {
      renderStar(tInSilence, cycleNumber * 1777 + i * 317);
    }
  }
}

/** Apply fog overlay — biome-tinted semi-transparent layer */
export function renderFog(buf: ImageData, weather: Weather, time: number, biome: Biome = "temperate"): void {
  if (weather.fogDensity <= 0) return;

  // Fog color by biome: desert=warm ochre, volcanic=dark ash, tundra=icy blue, others=neutral
  const [fr, fg, fb] =
    biome === "desert"   ? [210, 175, 115] :  // sun-bleached sand haze
    biome === "volcanic" ? [80, 72, 65]    :  // dark suffocating ash
    biome === "tundra"   ? [185, 195, 215] :  // icy pale blue
    biome === "lush"     ? [160, 185, 170] :  // green-tinted canopy mist
                           [175, 180, 192];   // temperate grey-white

  // Fog type gets 3× density boost so it actually feels like fog.
  // Other weather types that have incidental fogDensity stay subtle.
  const densityBoost = weather.type === "fog" ? 3.2 : 1.0;
  const effectiveDensity = weather.fogDensity * densityBoost;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // Fog thicker at bottom, thinner at top — two overlapping noise layers for volume
      const yFactor = y / H;
      const n1 = noise2(x * 0.04 + time * 0.18, y * 0.05 + time * 0.04) * 0.5 + 0.5;
      const n2 = noise2(x * 0.09 - time * 0.07, y * 0.10 + time * 0.06) * 0.5 + 0.5;
      // Third noise layer for fog type — adds wispy tendrils and depth
      const n3 = weather.type === "fog"
        ? noise2(x * 0.025 + time * 0.06, y * 0.035 - time * 0.03) * 0.5 + 0.5
        : 0.5;
      const noiseVal = weather.type === "fog"
        ? n1 * 0.45 + n2 * 0.30 + n3 * 0.25
        : n1 * 0.65 + n2 * 0.35;
      const fogHere = effectiveDensity * yFactor * noiseVal;
      // Fog type: alpha 0-210 (genuinely foggy). Others: 0-130 (subtle atmospheric haze).
      const maxAlpha = weather.type === "fog" ? 210 : 130;
      const a = Math.round(Math.min(fogHere, 1.0) * maxAlpha);
      if (a > 2) {
        setPixel(buf, x, y, fr, fg, fb, a);
      }
    }
  }
}

/**
 * Render bird flocks — small pixel creatures flying across the sky.
 * Phase-reactive: absent at genesis, peaks at complexity, scatters in dissolution, lone survivor in silence.
 * Biome-aware: no birds in volcanic (too hostile), silhouette color per biome.
 * Position deterministic from cycleNumber + cycleProgress; wing flap from real time.
 * Call after renderClouds so birds appear in front of cloud layer.
 */
export function renderBirds(
  buf: ImageData,
  cycleNumber: number,
  cycleProgress: number,
  phaseIndex: number,
  weatherType: string,
  biome: Biome,
  time: number,
): void {
  // Silence: one lone survivor bird glides across the empty sky
  if (cycleProgress >= 0.93) {
    renderSilenceBird(buf, cycleNumber, cycleProgress, biome, time);
    return;
  }

  // Dissolution scatter: birds panic as the wind tears through (overrides storm restriction)
  const isDissolving = cycleProgress >= 0.80 && cycleProgress < 0.93;
  const scatterT = isDissolving ? Math.min(1, (cycleProgress - 0.80) / 0.10) : 0;

  // No birds in volcanic biome — too hostile (except the silence survivor above)
  if (biome === "volcanic") return;
  // Storms prevent birds during normal phases; dissolution panic overrides this
  if (weatherType === "storm" && !isDissolving) return;

  // Phase intensity — absent at genesis, peaks at complexity
  const PHASE_STR = [0.0, 0.35, 0.75, 1.0, 0.55, 0.0];
  const phaseStr = isDissolving ? 0.72 : PHASE_STR[Math.min(5, Math.max(0, phaseIndex))];
  if (phaseStr < 0.01) return;

  // Weather reduces bird activity — but dissolution panic ignores rain (they fly regardless)
  const wMod = isDissolving ? 1.0 :
    weatherType === "overcast" ? 0.30 :
    weatherType === "rain"     ? 0.18 :
    weatherType === "fog"      ? 0.35 :
    weatherType === "snow"     ? 0.45 : 1.0;
  const finalStr = phaseStr * wMod;
  if (finalStr < 0.01) return;

  // Wind direction (same seed as renderDissolutionWind for coherence)
  const windDir: 1 | -1 = ((cycleNumber * 2731 + 3413) & 1) ? 1 : -1;

  // Silhouette color by biome
  const [cr, cg, cb]: [number, number, number] =
    biome === "tundra"  ? [215, 228, 248] :  // pale blue-white (snowy birds)
    biome === "desert"  ? [145, 120, 72]  :  // sandy brown hawks
    biome === "lush"    ? [28, 42, 28]    :  // very dark (tropical silhouette)
                          [34, 32, 42];       // dark blue-grey (temperate)

  const elapsed  = cycleProgress * 300;  // seconds into cycle
  const PADDED_W = W + 60;               // includes off-screen buffer each side

  for (let fi = 0; fi < 5; fi++) {
    const h1 = seedHash(cycleNumber * 5003 + fi * 619 + 1);
    const h2 = seedHash(cycleNumber * 5003 + fi * 619 + 2);
    const h3 = seedHash(cycleNumber * 5003 + fi * 619 + 3);
    const h4 = seedHash(cycleNumber * 5003 + fi * 619 + 4);
    const h5 = seedHash(cycleNumber * 5003 + fi * 619 + 5);
    const h6 = seedHash(cycleNumber * 5003 + fi * 619 + 6);

    const birdCount = 3 + Math.floor(h1 * 5);   // 3–7 birds per flock
    const speed     = 20 + h2 * 34;             // 20–54 px/s
    const dir       = h3 > 0.5 ? 1 : -1;        // left→right or right→left
    const startX    = h4 * W;                    // x position at cycle start
    const baseY     = Math.round(H * (0.04 + h5 * 0.36)); // upper 4–40% of sky
    const phaseShift = h6 * 300;                 // time offset for natural spread across cycle

    // Current flock-center X — wraps with padding so flocks enter/exit cleanly
    const rawX  = startX + dir * ((elapsed + phaseShift) * speed);
    const currX = ((rawX % PADDED_W) + PADDED_W) % PADDED_W - 30;

    const baseAlpha = Math.round(finalStr * (isDissolving ? 185 : 175));

    for (let bi = 0; bi < birdCount; bi++) {
      const formIdx = bi - Math.floor(birdCount / 2);

      let bx: number, by: number;

      if (isDissolving && scatterT > 0) {
        // Panic scatter: each bird gets a unique divergent offset seeded by its identity
        const sRad = seedHash(cycleNumber * 3997 + fi * 431 + bi * 71) * Math.PI * 2;
        const sAmt = scatterT * scatterT * (16 + seedHash(cycleNumber * 3997 + fi * 431 + bi * 71 + 3) * 26);

        // Formation gradually dissolves — birds spread then break apart
        const formFrac = Math.max(0, 1 - scatterT * 1.15);
        const formSpacing = dir > 0 ? 7 : -7;

        // Scatter offset: random angle + strong wind push
        const scatterDx = Math.cos(sRad) * sAmt + windDir * scatterT * scatterT * 48;
        const scatterDy = Math.sin(sRad) * sAmt * 0.65;

        bx = Math.round(currX + formIdx * formSpacing * formFrac + scatterDx);
        by = Math.round(baseY + Math.abs(formIdx) * 2 * formFrac + scatterDy);
      } else {
        // V-formation: birds spread symmetrically from flock center
        bx = Math.round(currX + formIdx * (dir > 0 ? 7 : -7));
        by = Math.round(baseY + Math.abs(formIdx) * 2);
      }

      if (bx < -3 || bx > W + 2 || by < 0 || by >= H) continue;

      // Panic flap during dissolution — faster, more erratic
      const flapSpeed = isDissolving ? 5.5 + scatterT * 3.5 : 3.6;
      const wingDy = Math.sin(time * flapSpeed + bi * 0.85 + fi * 1.5) > 0 ? -1 : 1;

      // Birds fade slightly as they scatter off into chaos
      const bAlpha = isDissolving ? Math.round(baseAlpha * (1 - scatterT * 0.25)) : baseAlpha;

      // Body pixel
      setPixel(buf, bx, by, cr, cg, cb, bAlpha);
      // Wing tip pixels
      setPixel(buf, bx - 1, by + wingDy, cr, cg, cb, Math.round(bAlpha * 0.80));
      setPixel(buf, bx + 1, by + wingDy, cr, cg, cb, Math.round(bAlpha * 0.80));
    }
  }
}

/**
 * The silence survivor — one lone bird glides slowly across an empty sky.
 * After the storm and the scatter, this single creature drifts through the quiet.
 * Larger than flock birds, slow-gliding wings (not panicked flapping), warm amber tone.
 * All viewers see the same bird at the same position (deterministic from cycleNumber).
 */
function renderSilenceBird(
  buf: ImageData,
  cycleNumber: number,
  cycleProgress: number,
  biome: Biome,
  time: number,
): void {
  const h1 = seedHash(cycleNumber * 6173 + 8831);
  const h2 = seedHash(cycleNumber * 6173 + 4421);
  const h3 = seedHash(cycleNumber * 6173 + 2237);

  const dir: 1 | -1 = h3 > 0.5 ? 1 : -1;
  const speed = 8 + h2 * 11;  // 8–19 px/s — slow, contemplative

  const elapsed       = cycleProgress * 300;
  const silenceElapsed = elapsed - 0.93 * 300;  // seconds since silence began

  const startX = h1 * W;
  const PADDED = W + 24;
  const rawX   = startX + dir * silenceElapsed * speed;
  const bx     = Math.round(((rawX % PADDED) + PADDED) % PADDED - 12);
  if (bx < -8 || bx > W + 8) return;

  // Position low in the sky — below the stars, above the motes
  const by = Math.round(H * (0.30 + h2 * 0.26));

  // Biome-colored silhouette: each world's last bird has its own character
  const [cr, cg, cb]: [number, number, number] =
    biome === "tundra"   ? [208, 224, 250] : // pale crane
    biome === "desert"   ? [158, 118, 60]  : // amber hawk
    biome === "lush"     ? [52, 76, 48]    : // dark tropical silhouette
    biome === "volcanic" ? [175, 88, 32]   : // ember-lit shape against the dying sky
                           [88, 72, 58];      // warm dark silhouette

  const alpha = 198;

  // Slow gliding wings — a gentle dip, not a frantic flap
  const glide = Math.sin(time * 0.55);
  const wingDy = glide > 0.25 ? -1 : glide < -0.25 ? 1 : 0;

  // 7-pixel wingspan — clearly larger and more legible than flock birds
  setPixel(buf, bx,     by,           cr, cg, cb, alpha);
  setPixel(buf, bx - 1, by + wingDy,  cr, cg, cb, Math.round(alpha * 0.95));
  setPixel(buf, bx + 1, by + wingDy,  cr, cg, cb, Math.round(alpha * 0.95));
  setPixel(buf, bx - 2, by + wingDy,  cr, cg, cb, Math.round(alpha * 0.82));
  setPixel(buf, bx + 2, by + wingDy,  cr, cg, cb, Math.round(alpha * 0.82));
  setPixel(buf, bx - 3, by + wingDy + 1, cr, cg, cb, Math.round(alpha * 0.52));
  setPixel(buf, bx + 3, by + wingDy + 1, cr, cg, cb, Math.round(alpha * 0.52));
}

/**
 * Dissolution wind — horizontal streaks sweep the sky and terrain as the cycle ends.
 * Builds during the dissolution phase (0.80–0.92), making it unmistakably different
 * from the calm golden complexity phase that precedes it.
 * Biome-tinted: volcanic=glowing embers, tundra=icy crystals, desert=sand gusts, others=grey mist.
 * Sky also progressively darkens from above — storm pressure closing in.
 */
export function renderDissolutionWind(
  buf: ImageData,
  cycleProgress: number,
  time: number,
  biome: Biome,
  cycleNumber: number,
): void {
  if (cycleProgress < 0.80 || cycleProgress >= 0.93) return;

  const localP = (cycleProgress - 0.80) / 0.13; // 0→1 across dissolution
  const fadeIn  = Math.min(1.0, localP * 5.5);   // full strength by ~18% in (~5s)
  const fadeOut = localP > 0.80 ? (1.0 - (localP - 0.80) / 0.20) : 1.0;
  const str = fadeIn * fadeOut;
  if (str < 0.02) return;

  // Wind direction: consistent for entire cycle (all viewers agree)
  const windDir: 1 | -1 = ((cycleNumber * 2731 + 3413) & 1) ? 1 : -1;
  const windSpeed = 58 + (((cycleNumber * 5381) >>> 0) % 42); // 58–100 px/s

  // Biome-appropriate wind particle color
  let wr: number, wg: number, wb: number;
  switch (biome) {
    case "volcanic": wr = 188; wg = 72; wb = 16; break;   // glowing ash embers
    case "tundra":   wr = 152; wg = 180; wb = 222; break; // icy drift crystals
    case "desert":   wr = 208; wg = 160; wb = 75; break;  // sand gusts
    case "lush":     wr = 120; wg = 138; wb = 98; break;  // dark humid mist
    default:         wr = 165; wg = 170; wb = 188; break; // grey-white mist
  }

  const d = buf.data;

  // Sky darkening — upper sky gets a pressure from above as the storm gathers
  // Deepens the dissolution mood without killing the sunset gradient at the horizon
  const skyDarkStr = str * 0.40;
  const darkH = Math.floor(H * 0.58);
  for (let y = 0; y < darkH; y++) {
    const yf = 1.0 - y / darkH;   // 1 at zenith, 0 near horizon
    const dk = skyDarkStr * yf * yf;
    if (dk < 0.008) continue;
    const dR = Math.round(dk * 52);
    const dG = Math.round(dk * 44);
    const dB = Math.round(dk * 18);
    for (let x = 0; x < W; x++) {
      const pi = (y * W + x) << 2;
      d[pi]     = Math.max(0, d[pi]     - dR);
      d[pi + 1] = Math.max(0, d[pi + 1] - dG);
      d[pi + 2] = Math.max(0, d[pi + 2] - dB);
    }
  }

  // Horizontal wind streaks — 55 deterministic streaks blowing across the full frame
  const STREAK_N = 55;
  for (let i = 0; i < STREAK_N; i++) {
    const h1 = seedHash(cycleNumber * 7013 + i * 211 + 97);  // Y position
    const h2 = seedHash(cycleNumber * 7013 + i * 211 + 53);  // streak length
    const h3 = seedHash(cycleNumber * 7013 + i * 211 + 29);  // alpha + speed var
    const h4 = seedHash(cycleNumber * 7013 + i * 211 + 7);   // X start offset

    // Y distribution: denser in upper 2/3 (sky + upper terrain)
    const sy = Math.round(H * (h1 < 0.68 ? h1 * 0.64 : 0.64 + (h1 - 0.68) / 0.32 * 0.36));

    const len       = 10 + Math.round(h2 * 32);  // 10–42 px streak length
    const baseAlpha = 20 + Math.round(h3 * 34);   // 20–54 alpha
    const speedVar  = 0.60 + h3 * 0.80;           // 0.60→1.40x speed multiplier

    // Animate horizontally — each streak wraps continuously
    const scrollDist = time * windSpeed * speedVar;
    const startX = windDir > 0
      ? (Math.round(h4 * (W + len)) + Math.round(scrollDist)) % (W + len) - len
      : W - (Math.round(h4 * (W + len)) + Math.round(scrollDist)) % (W + len);

    const alpha = Math.round(str * baseAlpha);
    if (alpha < 2) continue;

    // Draw the streak — very slight downward angle (3°) for realism
    const angleY = windDir > 0 ? 0.055 : -0.055;
    for (let t = 0; t < len; t++) {
      const px = Math.round(startX + t * windDir);
      const py = sy + Math.round(t * angleY);
      if (px < 0 || px >= W || py < 0 || py >= H) continue;
      // Fade at streak ends for soft appearance
      const endFade = t < 4 ? t / 4 : t > len - 5 ? (len - t) / 5 : 1.0;
      const a = Math.round(alpha * endFade);
      if (a < 2) continue;
      setPixel(buf, px, py, wr, wg, wb, a);
    }
  }
}

/**
 * Dissolution rain — light diagonal drizzle that falls during the dissolution phase.
 * The world mourns its own ending: gentle streaks fill the sky as motes die and bonds break.
 * Distinct from flood rain (that is heavy, event-driven); this is quiet, inevitable, mournful.
 * Matches the wind direction already established by renderDissolutionWind.
 * Not rendered in desert or volcanic — those biomes have their own dissolution particles.
 * Call after renderDissolutionWind so rain layers over wind streaks.
 */
export function renderDissolutionRain(
  buf: ImageData,
  cycleProgress: number,
  time: number,
  biome: Biome,
  cycleNumber: number,
): void {
  // Desert and volcanic have ash gusts / sand — no rain
  if (biome === "volcanic" || biome === "desert") return;
  // Active from 0.83 to 0.93
  if (cycleProgress < 0.83 || cycleProgress >= 0.93) return;

  const localP = (cycleProgress - 0.83) / 0.10;
  const fadeIn  = Math.min(1.0, localP * 5.0);   // full by ~20%
  const fadeOut = localP > 0.78 ? (1.0 - (localP - 0.78) / 0.22) : 1.0;
  const str = fadeIn * fadeOut;
  if (str < 0.02) return;

  // Rain leans with the dissolution wind direction (same seed formula)
  const windDir: 1 | -1 = ((cycleNumber * 2731 + 3413) & 1) ? 1 : -1;
  const fallSpeed = 42 + (((cycleNumber * 4127) >>> 0) % 28); // 42–70 px/s fall

  // Biome rain color — each world's rain has a different character
  let rr: number, rg: number, rb: number;
  switch (biome) {
    case "tundra":   rr = 188; rg = 208; rb = 238; break;  // icy sleet, pale blue-white
    case "lush":     rr = 105; rg = 148; rb = 185; break;  // heavy tropical, deep blue-green
    default:         rr = 138; rg = 162; rb = 202; break;  // temperate blue-grey
  }

  const RAIN_N = 45;
  for (let i = 0; i < RAIN_N; i++) {
    const h1 = seedHash(cycleNumber * 9311 + i * 293 + 173);  // base Y
    const h2 = seedHash(cycleNumber * 9311 + i * 293 + 89);   // streak length
    const h3 = seedHash(cycleNumber * 9311 + i * 293 + 41);   // alpha + speed
    const h4 = seedHash(cycleNumber * 9311 + i * 293 + 17);   // base X

    const len       = 3 + Math.round(h2 * 5);           // 3–8 px streak
    const speedVar  = 0.55 + h3 * 0.90;                 // individual fall speed variation
    const baseAlpha = 22 + Math.round(h3 * 32);         // 22–54 per-streak alpha

    // Scroll vertically (fall) and slightly horizontally (lean with wind)
    const scrollY = Math.round(time * fallSpeed * speedVar);
    const scrollX = Math.round(time * 22 * windDir);    // gentle lean, not as fast as wind

    const PADDED_H = H + len + 4;
    const startY = ((Math.round(h1 * PADDED_H) + scrollY) % PADDED_H + PADDED_H) % PADDED_H - len - 2;
    const startX = ((Math.round(h4 * W) + scrollX) % W + W) % W;

    const alpha = Math.round(str * baseAlpha);
    if (alpha < 3) continue;

    // Draw diagonal rain streak — mostly vertical, leans slightly with wind
    for (let t = 0; t < len; t++) {
      const px = Math.round(startX + t * windDir * 0.38); // ~21° lean
      const py = startY + t;
      if (px < 0 || px >= W || py < 0 || py >= H) continue;
      // Fade at head and tail
      const fade = t === 0 ? 0.45 : t === len - 1 ? 0.55 : 1.0;
      const a = Math.round(alpha * fade);
      if (a < 2) continue;
      setPixel(buf, px, py, rr, rg, rb, a);
    }
  }
}

/** Apply ambient darkening for overcast/storm weather */
export function applyWeatherDarkening(buf: ImageData, weather: Weather): void {
  if (weather.ambientDarkening <= 0) return;

  const factor = 1 - weather.ambientDarkening;
  const d = buf.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i]     = Math.round(d[i] * factor);
    d[i + 1] = Math.round(d[i + 1] * factor);
    d[i + 2] = Math.round(d[i + 2] * factor);
  }
}
