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

  // Strength scales with sun height; strongest at mid-afternoon
  const baseStr = horizonGlow * 0.95;
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
      const a = Math.round(rFinal * falloff * 120);
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

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // Fog thicker at bottom, thinner at top — two overlapping noise layers for volume
      const yFactor = y / H;
      const n1 = noise2(x * 0.04 + time * 0.18, y * 0.05 + time * 0.04) * 0.5 + 0.5;
      const n2 = noise2(x * 0.09 - time * 0.07, y * 0.10 + time * 0.06) * 0.5 + 0.5;
      const noiseVal = n1 * 0.65 + n2 * 0.35;
      const fogHere = weather.fogDensity * yFactor * noiseVal;
      const a = Math.round(fogHere * 130);
      if (a > 2) {
        setPixel(buf, x, y, fr, fg, fb, a);
      }
    }
  }
}

/**
 * Render bird flocks — small pixel creatures flying across the sky.
 * Phase-reactive: absent at genesis and silence, peaks at complexity.
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
  // No birds in volcanic biome or during thunderstorms
  if (biome === "volcanic") return;
  if (weatherType === "storm") return;

  // Phase intensity — absent at genesis/silence, peaks at complexity
  const PHASE_STR = [0.0, 0.35, 0.75, 1.0, 0.55, 0.0];
  const phaseStr = PHASE_STR[Math.min(5, Math.max(0, phaseIndex))];
  if (phaseStr < 0.01) return;

  // Weather reduces bird activity
  const wMod =
    weatherType === "overcast" ? 0.30 :
    weatherType === "rain"     ? 0.18 :
    weatherType === "fog"      ? 0.35 :
    weatherType === "snow"     ? 0.45 : 1.0;
  const finalStr = phaseStr * wMod;
  if (finalStr < 0.01) return;

  // Silhouette color by biome
  const [cr, cg, cb]: [number, number, number] =
    biome === "tundra"  ? [215, 228, 248] :  // pale blue-white (snowy birds)
    biome === "desert"  ? [145, 120, 72]  :  // sandy brown hawks
    biome === "lush"    ? [28, 42, 28]    :  // very dark (tropical silhouette)
                          [34, 32, 42];       // dark blue-grey (temperate)

  const elapsed   = cycleProgress * 300;  // seconds into cycle
  const PADDED_W  = W + 60;               // includes off-screen buffer each side

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

    // Current X — wraps with padding so flocks enter/exit cleanly at screen edges
    const rawX  = startX + dir * ((elapsed + phaseShift) * speed);
    const currX = ((rawX % PADDED_W) + PADDED_W) % PADDED_W - 30;

    const baseAlpha = Math.round(finalStr * 175);

    for (let bi = 0; bi < birdCount; bi++) {
      // V-formation: birds spread symmetrically from flock center
      const formIdx = bi - Math.floor(birdCount / 2);
      const bx = Math.round(currX + formIdx * (dir > 0 ? 7 : -7));
      const by = Math.round(baseY + Math.abs(formIdx) * 2);

      if (bx < -3 || bx > W + 2 || by < 0 || by >= H) continue;

      // Wing flap — each bird slightly out of phase for organic flock motion
      const wingDy = Math.sin(time * 3.6 + bi * 0.85 + fi * 1.5) > 0 ? -1 : 1;

      // Body pixel
      setPixel(buf, bx, by, cr, cg, cb, baseAlpha);
      // Wing tip pixels
      setPixel(buf, bx - 1, by + wingDy, cr, cg, cb, Math.round(baseAlpha * 0.80));
      setPixel(buf, bx + 1, by + wingDy, cr, cg, cb, Math.round(baseAlpha * 0.80));
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
