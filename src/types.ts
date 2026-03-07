// types.ts — All cross-module interfaces in one place.
// An agent loads this once and has the full data model.

// ---- Palette ----

export type RGB = [number, number, number];

export type Biome = "temperate" | "desert" | "tundra" | "volcanic" | "lush";

export interface BiomePalette {
  sky: number;
  skyHorizon: number;
  deepWater: number;
  shallowWater: number;
  sand: number;
  ground: number;
  darkGround: number;
  cliff: number;
  treeTrunk: number;
  treeCanopy: number;
  moteGlow: number;
  moteMid: number;
  moteDim: number;
  text: number;
  subsoil: number;
  deepRock: number;
}

// ---- Render ----

export interface RenderContext {
  ctx: CanvasRenderingContext2D;
  buf: ImageData;
}

// ---- Terrain ----

export const enum Tile {
  Air = 0,
  DeepWater,
  ShallowWater,
  Sand,
  Ground,
  DarkGround,
  Cliff,
  TreeTrunk,
  TreeCanopy,
  Cave,
  Ruin,
  Settlement,
  Subsoil,
  DeepRock,
  CaveInterior,
}

export interface Terrain {
  tiles: Uint8Array;
  heights: Float32Array;
  waterLevel: number;
  biome: Biome;
  bp: BiomePalette;
  seed: number;
  archetype: string;
}

// ---- Mote ----

export interface Temperament {
  wanderlust: number;
  sociability: number;
  hardiness: number;
}

export interface TrailPoint {
  x: number;
  y: number;
  age: number;
}

export interface Mote {
  x: number;
  y: number;
  vx: number;
  vy: number;
  energy: number;
  age: number;
  temperament: Temperament;
  bonds: Mote[];
  bondTimer: number;
  bondFlash: number;
  grounded: boolean;
  direction: number;
  spawnFlash: number;
  trail: TrailPoint[];
  trailTimer: number;
  forceX: number;
  forceY: number;
  bondBreakFlash: number;
  hardinessFlash: number;
}

// ---- Physics ----

export interface SpatialGrid {
  cells: Map<number, Mote[]>;
  cols: number;
}

// ---- Events ----

export type EventType =
  | "flood" | "bloom" | "meteor" | "migration" | "eclipse"
  | "earthquake" | "plague" | "aurora" | "drought";

export interface ActiveEvent {
  type: EventType;
  message: string;
  startTime: number;
  duration: number;
  messageAlpha: number;
  data: Record<string, number>;
}

// ---- Weather ----

export type WeatherType = "clear" | "rain" | "storm" | "snow" | "overcast" | "fog";

export interface WeatherParticle {
  x: number;
  y: number;
  speed: number;
  drift: number;
  size: number;
  alpha: number;
}

export interface CloudLayer {
  x: number;
  y: number;
  width: number;
  height: number;
  density: number;
  speed: number;
}

export interface Lightning {
  active: boolean;
  timer: number;
  x: number;
  brightness: number;
}

export interface CelestialBody {
  type: "sun" | "moon" | "none";
  x: number;
  y: number;
  phase: number;
}

export interface Weather {
  type: WeatherType;
  intensity: number;
  particles: WeatherParticle[];
  clouds: CloudLayer[];
  celestial: CelestialBody;
  lightning: Lightning;
  windStrength: number;
  fogDensity: number;
  ambientDarkening: number;
}

// ---- Interaction ----

export interface Ripple {
  x: number;
  y: number;
  radius: number;
  alpha: number;
}

export interface Interaction {
  x: number;
  y: number;
  present: boolean;
  calm: boolean;
  speed: number;
  pulses: { x: number; y: number }[];
  ripples: Ripple[];
}

// ---- Sound ----

export interface SoundEngine {
  ctx: AudioContext;
  voices: never[]; // retained for interface compat — notes are now triggered on demand
  masterGain: GainNode;
  reverb: ConvolverNode;
  compressor: DynamicsCompressorNode;
  initialized: boolean;
  weatherAmbient: WeatherAmbient;
}

interface WeatherAmbient {
  rainSource: AudioBufferSourceNode | null;
  rainGain: GainNode | null;
  rainFilter: BiquadFilterNode | null;
  windSource: AudioBufferSourceNode | null;
  windGain: GainNode | null;
  windFilter: BiquadFilterNode | null;
  currentType: WeatherType | null;
  thunderCooldown: number;
}

// ---- World ----

export type PhaseName = "genesis" | "exploration" | "organization" | "complexity" | "dissolution" | "silence";

export interface DeathRecord {
  x: number;
  y: number;
  r: number; g: number; b: number;
  time: number;
}

export interface World {
  terrain: Terrain;
  motes: Mote[];
  grid: SpatialGrid;
  clusters: Mote[][];
  cycleProgress: number;
  cycleNumber: number;
  phaseIndex: number;
  phaseProgress: number;
  phaseName: PhaseName;
  params: PhaseParams;
  time: number;
  rng: () => number;
  spawnAccum: number;
  settlementTimer: number;
  event: ActiveEvent | null;
  eventTriggered: boolean;
  deaths: DeathRecord[];
  pendingEventSound: string | null;
  phaseFlash: number;
  weather: Weather;
}

interface PhaseParams {
  spawnRate: number;
  maxMotes: number;
  energyDecay: number;
  bondStrength: number;
}
