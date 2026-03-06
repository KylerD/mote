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

/** Render a star field — fades in during dissolution/silence */
function renderStarField(buf: ImageData, time: number, cycleProgress: number, weatherType: string): void {
  // Stars emerge from ~78% of cycle
  const intensity = Math.max(0, Math.min(1, (cycleProgress - 0.78) / 0.12));
  if (intensity <= 0) return;

  // Storm/overcast blocks most stars, fog dims them
  const weatherFactor =
    weatherType === "storm" || weatherType === "overcast" ? 0.08 :
    weatherType === "fog" ? 0.25 : 1.0;
  const baseAlpha = intensity * weatherFactor * 180;
  if (baseAlpha < 4) return;

  // 70 deterministic stars across the upper sky
  for (let i = 0; i < 70; i++) {
    const sx = Math.abs((i * 8191 + 23747) % W);
    const sy = Math.abs((i * 5381 + 11317) % Math.floor(H * 0.55));
    const twinkle = Math.sin(time * (1.0 + i * 0.23) + i * 1.9) * 0.35 + 0.65;
    const sa = Math.round(baseAlpha * twinkle);
    if (sa < 5) continue;

    // Stars vary: warm yellow-white, cool blue-white, faint red giants
    const kind = i % 7;
    if (kind === 0) {
      setPixel(buf, sx, sy, 255, 240, 190, sa);  // warm giant
    } else if (kind === 1) {
      setPixel(buf, sx, sy, 180, 200, 255, sa);  // blue-white
    } else {
      setPixel(buf, sx, sy, 215, 220, 235, sa);  // common white
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
export function renderClouds(buf: ImageData, weather: Weather, time: number): void {
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

        // Cloud color: light grey-white
        const bright = weather.type === "storm" ? 100 : weather.type === "overcast" ? 140 : 200;
        setPixel(buf, px, py, bright, bright + 5, bright + 10, a);
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

/** Render lightning flash — bright overlay across the whole scene */
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

  // Bolt: jagged vertical line from cloud to ground
  const bx = weather.lightning.x;
  let y = 5;
  let x = bx;
  const boltAlpha = Math.round(brightness * 255);
  while (y < H * 0.7) {
    setPixel(buf, x, y, 255, 255, 255, boltAlpha);
    setPixel(buf, x - 1, y, 200, 210, 255, Math.round(boltAlpha * 0.4));
    setPixel(buf, x + 1, y, 200, 210, 255, Math.round(boltAlpha * 0.4));
    y += 1;
    // Jagged steps
    x += (Math.floor(y * 3.7 + bx) % 3) - 1;
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
