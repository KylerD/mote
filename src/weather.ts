// weather.ts — Procedural weather system (data & state).
// Deterministic per cycle seed. Biome-weighted weather selection.
// Rendering is in weather-render.ts.

import { W, H } from "./config";
import type {
  Weather, WeatherType, WeatherParticle, CloudLayer,
  Lightning, CelestialBody, Biome,
} from "./types";
import { mulberry32 } from "./rng";

// Re-export for backward compatibility
export type { Weather, WeatherType };

// Also re-export render functions from weather-render.ts for existing importers
export {
  renderCelestial, renderClouds, renderParticles,
  renderLightning, renderFog, applyWeatherDarkening,
  applyTundraAurora, applyGodRays, renderShootingStars,
} from "./weather-render";

// Biome -> weather probability weights [clear, rain, storm, snow, overcast, fog]
const BIOME_WEATHER_WEIGHTS: Record<Biome, number[]> = {
  temperate: [0.30, 0.25, 0.08, 0.05, 0.22, 0.10],
  desert:    [0.55, 0.05, 0.05, 0.00, 0.15, 0.20],
  tundra:    [0.20, 0.05, 0.05, 0.40, 0.20, 0.10],
  volcanic:  [0.15, 0.10, 0.15, 0.00, 0.35, 0.25],
  lush:      [0.15, 0.35, 0.10, 0.00, 0.25, 0.15],
};

const WEATHER_TYPES: WeatherType[] = ["clear", "rain", "storm", "snow", "overcast", "fog"];

/** Create weather for a given cycle, deterministic from seed + biome */
export function createWeather(seed: number, biome: Biome): Weather {
  const rng = mulberry32(seed * 3137 + 9973);

  // Pick weather type from biome weights
  const weights = BIOME_WEATHER_WEIGHTS[biome];
  let roll = rng();
  let cumulative = 0;
  let type: WeatherType = "clear";
  for (let i = 0; i < weights.length; i++) {
    cumulative += weights[i];
    if (roll < cumulative) {
      type = WEATHER_TYPES[i];
      break;
    }
  }

  const intensity = type === "clear" ? 0 : 0.3 + rng() * 0.7;
  const windStrength = (rng() - 0.5) * 2 * (type === "storm" ? 1.0 : 0.4);

  // Generate particles
  const particles: WeatherParticle[] = [];
  const particleCount =
    type === "rain" ? Math.floor(20 + intensity * 30) :
    type === "storm" ? Math.floor(35 + intensity * 40) :
    type === "snow" ? Math.floor(12 + intensity * 18) : 0;

  for (let i = 0; i < particleCount; i++) {
    particles.push(createParticle(rng, type, windStrength));
  }

  // Generate clouds
  const clouds: CloudLayer[] = [];
  const cloudCount =
    type === "overcast" ? Math.floor(6 + intensity * 8) :
    type === "rain" || type === "storm" ? Math.floor(4 + intensity * 5) :
    type === "fog" ? Math.floor(3 + intensity * 4) :
    type === "snow" ? Math.floor(3 + intensity * 3) :
    Math.floor(rng() * 3);

  for (let i = 0; i < cloudCount; i++) {
    clouds.push({
      x: rng() * W,
      y: type === "fog" ? H * 0.3 + rng() * H * 0.5 : rng() * H * 0.35,
      width: 15 + rng() * 30,
      height: 3 + rng() * 6,
      density: type === "overcast" ? 0.3 + rng() * 0.3 :
               type === "fog" ? 0.15 + rng() * 0.2 : 0.1 + rng() * 0.2,
      speed: (0.5 + rng() * 1.5) * (windStrength > 0 ? 1 : -1),
    });
  }

  // Celestial body
  const celestial = pickCelestial(rng, type);

  // Lightning state
  const lightning: Lightning = {
    active: false,
    timer: type === "storm" ? 40 + rng() * 50 : 0,
    x: 0,
    brightness: 0,
  };

  // Fog density
  const fogDensity =
    type === "fog" ? 0.2 + intensity * 0.3 :
    type === "overcast" ? intensity * 0.08 : 0;

  // Scene darkening
  const ambientDarkening =
    type === "storm" ? 0.15 + intensity * 0.2 :
    type === "overcast" ? 0.05 + intensity * 0.1 :
    type === "rain" ? 0.05 + intensity * 0.1 :
    type === "fog" ? intensity * 0.05 : 0;

  return {
    type, intensity, particles, clouds, celestial,
    lightning, windStrength, fogDensity, ambientDarkening,
  };
}

function createParticle(rng: () => number, type: WeatherType, wind: number): WeatherParticle {
  const isSnow = type === "snow";
  return {
    x: rng() * W,
    y: rng() * H,
    speed: isSnow ? 6 + rng() * 8 : 20 + rng() * 25,
    drift: isSnow ? wind * 4 + (rng() - 0.5) * 2 : wind * 6 + (rng() - 0.5) * 2,
    size: rng() < 0.25 ? 1 : 0,
    alpha: isSnow ? 80 + rng() * 60 : 40 + rng() * 60,
  };
}

function pickCelestial(rng: () => number, type: WeatherType): CelestialBody {
  if (type === "storm" || type === "overcast" || type === "fog") {
    return { type: "none", x: 0, y: 0, phase: 0 };
  }

  const roll = rng();
  if (roll < 0.4) {
    return { type: "sun", x: 20 + rng() * (W - 40), y: 8 + rng() * 20, phase: 0 };
  } else if (roll < 0.7) {
    return { type: "moon", x: 20 + rng() * (W - 40), y: 8 + rng() * 20, phase: rng() };
  }
  return { type: "none", x: 0, y: 0, phase: 0 };
}

/** Update weather particles and state each frame */
export function updateWeather(weather: Weather, dt: number, _time: number, rng: () => number): void {
  for (const p of weather.particles) {
    p.y += p.speed * dt;
    p.x += p.drift * dt;
    if (p.y > H) { p.y = -2; p.x = rng() * W; }
    if (p.x < 0) p.x += W;
    if (p.x >= W) p.x -= W;
  }

  for (const c of weather.clouds) {
    c.x += c.speed * dt;
    if (c.x > W + c.width) c.x = -c.width;
    if (c.x < -c.width) c.x = W + c.width;
  }

  if (weather.type === "storm") {
    weather.lightning.timer -= dt;
    if (weather.lightning.active && weather.lightning.timer <= 0) {
      weather.lightning.active = false;
      weather.lightning.timer = 30 + rng() * 60;
    } else if (!weather.lightning.active && weather.lightning.timer <= 0) {
      weather.lightning.active = true;
      weather.lightning.timer = 0.05 + rng() * 0.07;
      weather.lightning.x = Math.floor(rng() * W);
      weather.lightning.brightness = 0.3 + rng() * 0.25;
    }
  }
}
