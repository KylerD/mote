// sound.ts — Generative audio engine. Note-trigger architecture with biome-aware sonic identity.
// Five biomes, five voices. Clusters trigger discrete envelope-driven notes. Motes chirp individually.

import type { Mote, SoundEngine, Weather, Biome } from "./types";
import { findClusters } from "./physics";
import { W, H } from "./config";

// Re-export for backward compatibility
export type { SoundEngine };

// ---- Biome Sound Profiles ----

interface BiomeSoundProfile {
  rootFreq: number;          // Tonal center (Hz) — defines the biome's home note
  reverbSecs: number;        // Impulse length — larger = more spacious/distant
  filterBase: number;        // Lowpass base frequency (Hz)
  filterMod: number;         // Energy modulation range on filter
  filterQ: number;           // Filter resonance
  waveSmall: OscillatorType; // Cluster size < 4
  waveMed: OscillatorType;   // Cluster size 4-7
  waveLarge: OscillatorType; // Cluster size >= 8
  masterMult: number;        // Volume multiplier
  detuneRange: number;       // X-position detune spread (cents)
  panStrength: number;       // Stereo pan depth 0-1
}

const BIOME_SOUND: Record<Biome, BiomeSoundProfile> = {
  temperate: {
    rootFreq: 130.81,   // C3 — warm, comfortable home
    reverbSecs: 1.8,
    filterBase: 700,
    filterMod: 1400,
    filterQ: 1.0,
    waveSmall: "sine",
    waveMed: "triangle",
    waveLarge: "triangle",
    masterMult: 1.0,
    detuneRange: 15,
    panStrength: 0.65,
  },
  desert: {
    rootFreq: 164.81,   // E3 — bright, warm, elevated
    reverbSecs: 3.5,    // Long: vast open sky, heat shimmer
    filterBase: 1400,
    filterMod: 600,
    filterQ: 0.6,       // Low Q = open, bell-like resonance
    waveSmall: "sine",
    waveMed: "sine",    // Bell-like throughout
    waveLarge: "sine",
    masterMult: 0.88,
    detuneRange: 6,     // Less detune = purer bell tones
    panStrength: 0.85,  // Wide stereo = sparse open landscape
  },
  tundra: {
    rootFreq: 110,      // A2 — cold, low, ancient
    reverbSecs: 4.5,    // Very long: frozen distances, ice
    filterBase: 320,
    filterMod: 500,
    filterQ: 2.0,       // Higher Q = crystalline resonance
    waveSmall: "sine",
    waveMed: "sine",    // Crystalline purity
    waveLarge: "triangle",
    masterMult: 0.78,
    detuneRange: 28,    // Wide detune = crystalline shimmer, chorus
    panStrength: 0.92,  // Maximum width = vast frozen expanse
  },
  volcanic: {
    rootFreq: 82.41,    // E2 — deep, threatening, subterranean
    reverbSecs: 0.7,    // Short: hard stone, no natural reverb
    filterBase: 160,
    filterMod: 350,
    filterQ: 1.5,
    waveSmall: "triangle",
    waveMed: "sawtooth",
    waveLarge: "sawtooth",
    masterMult: 1.12,
    detuneRange: 22,
    panStrength: 0.45,  // Narrow stereo = claustrophobic, enclosed
  },
  lush: {
    rootFreq: 98,       // G2 — rich, warm, verdant
    reverbSecs: 2.5,    // Dense canopy reverb
    filterBase: 900,
    filterMod: 1800,
    filterQ: 1.2,
    waveSmall: "sine",
    waveMed: "triangle",
    waveLarge: "triangle",
    masterMult: 1.05,
    detuneRange: 18,
    panStrength: 0.6,
  },
};

// ---- Per-biome, per-phase scales (semitones from root) ----

const BIOME_PHASE_SCALES: Record<Biome, number[][]> = {
  temperate: [
    [0, 3, 7, 10, 14],                        // genesis: minor pentatonic
    [0, 2, 4, 7, 9, 12, 14],                  // exploration: major pentatonic
    [0, 2, 4, 5, 7, 9, 11, 12],               // organization: ionian
    [0, 2, 4, 5, 7, 9, 11, 12, 14, 16],       // complexity: major extended
    [0, 3, 5, 7, 10, 12],                     // dissolution: minor penta + octave
    [0, 7, 12],                               // silence: root + fifth + octave
  ],
  desert: [
    [0, 2, 4, 7, 9],                          // genesis: major penta — sparse, open
    [0, 2, 5, 7, 10, 12],                     // exploration: suspended — heat shimmer
    [0, 2, 4, 6, 7, 9, 11],                   // organization: lydian
    [0, 2, 4, 6, 7, 9, 11, 12, 14, 16],       // complexity: lydian extended
    [0, 2, 7, 9, 12],                         // dissolution: open fifths emptying
    [0, 7],                                   // silence: bare fifth
  ],
  tundra: [
    [0, 2, 3, 7, 10],                         // genesis: dorian penta — cold
    [0, 2, 3, 5, 7, 9, 10, 12],               // exploration: dorian
    [0, 2, 3, 5, 7, 8, 10, 12],               // organization: natural minor
    [0, 1, 3, 5, 7, 8, 10, 12, 13, 15],       // complexity: phrygian
    [0, 3, 7, 10],                            // dissolution: minor penta
    [0, 3, 7],                                // silence: minor triad
  ],
  volcanic: [
    [0, 1, 6, 7],                             // genesis: semitone + tritone
    [0, 1, 3, 6, 7, 10],                      // exploration: diminished 7th arpeggio
    [0, 1, 4, 5, 7, 8, 10],                   // organization: phrygian dominant
    [0, 1, 3, 4, 6, 7, 9, 10, 12],            // complexity: octatonic
    [0, 3, 6, 9, 12],                         // dissolution: diminished arp
    [0, 6],                                   // silence: tritone alone
  ],
  lush: [
    [0, 2, 4, 7, 9],                          // genesis: major penta
    [0, 2, 4, 7, 9, 12, 14],                  // exploration: major penta wide
    [0, 2, 4, 5, 7, 9, 11, 12],               // organization: ionian
    [0, 2, 4, 5, 7, 9, 11, 12, 14, 16, 17, 19], // complexity: two lush octaves
    [0, 2, 4, 7, 9, 12],                      // dissolution: warmth fading
    [0, 4, 7],                                // silence: major triad
  ],
};

const MAX_VOICES = 8;

// ---- Biome Ambient Texture Beds ----

interface AmbientBed {
  droneOsc: OscillatorNode | null;
  droneGain: GainNode | null;
  textureSource: AudioBufferSourceNode;
  textureFilter: BiquadFilterNode;
  textureGain: GainNode;
  lfoOsc: OscillatorNode | null;
  lfoGain: GainNode | null;
}

interface BiomeAmbientConfig {
  droneFreq: number;
  droneTargetGain: number;
  droneWave: OscillatorType;
  noiseFilterType: BiquadFilterType;
  noiseFreq: number;
  noiseQ: number;
  noiseTargetGain: number;
  lfoRate: number;   // Hz — LFO speed for filter breathing
  lfoDepth: number;  // Hz — how much the LFO sweeps the filter cutoff
}

const BIOME_AMBIENT: Record<Biome, BiomeAmbientConfig> = {
  temperate: {
    droneFreq: 130.81, droneTargetGain: 0.006, droneWave: "sine",
    noiseFilterType: "bandpass", noiseFreq: 900, noiseQ: 1.5, noiseTargetGain: 0.004,
    lfoRate: 0.12, lfoDepth: 180,  // slow organic breathing
  },
  desert: {
    droneFreq: 0, droneTargetGain: 0, droneWave: "sine",
    noiseFilterType: "highpass", noiseFreq: 3000, noiseQ: 0.8, noiseTargetGain: 0.004,
    lfoRate: 0.06, lfoDepth: 380,  // very slow heat shimmer — wide sweep
  },
  tundra: {
    droneFreq: 0, droneTargetGain: 0, droneWave: "sine",
    noiseFilterType: "highpass", noiseFreq: 2400, noiseQ: 1.5, noiseTargetGain: 0.006,
    lfoRate: 0.08, lfoDepth: 210,  // icy, measured pulse
  },
  volcanic: {
    droneFreq: 41.2, droneTargetGain: 0.008, droneWave: "sawtooth",
    noiseFilterType: "lowpass", noiseFreq: 70, noiseQ: 2.5, noiseTargetGain: 0.014,
    lfoRate: 0.18, lfoDepth: 18,   // faster but tiny range — can't let filter go below 0
  },
  lush: {
    droneFreq: 98, droneTargetGain: 0.005, droneWave: "sine",
    noiseFilterType: "bandpass", noiseFreq: 2200, noiseQ: 1.2, noiseTargetGain: 0.005,
    lfoRate: 0.10, lfoDepth: 240,  // lush organic sway
  },
};

function createAmbientBed(ctx: AudioContext, biome: Biome, destination: AudioNode): AmbientBed {
  const cfg = BIOME_AMBIENT[biome];
  const now = ctx.currentTime;

  const textureSource = createNoiseSource(ctx, 5);
  const textureFilter = ctx.createBiquadFilter();
  textureFilter.type = cfg.noiseFilterType;
  textureFilter.frequency.value = cfg.noiseFreq;
  textureFilter.Q.value = cfg.noiseQ;
  const textureGain = ctx.createGain();
  textureGain.gain.setValueAtTime(0.0001, now);
  textureGain.gain.linearRampToValueAtTime(cfg.noiseTargetGain, now + 3.0);
  textureSource.connect(textureFilter);
  textureFilter.connect(textureGain);
  textureGain.connect(destination);
  textureSource.start(now);

  // LFO: slowly modulates the texture filter cutoff for organic breathing
  const lfoOsc = ctx.createOscillator();
  const lfoGain = ctx.createGain();
  lfoOsc.type = "sine";
  lfoOsc.frequency.value = cfg.lfoRate;
  lfoGain.gain.value = cfg.lfoDepth;
  lfoOsc.connect(lfoGain);
  lfoGain.connect(textureFilter.frequency);
  lfoOsc.start(now);

  let droneOsc: OscillatorNode | null = null;
  let droneGain: GainNode | null = null;
  if (cfg.droneFreq > 0) {
    droneOsc = ctx.createOscillator();
    droneGain = ctx.createGain();
    droneOsc.type = cfg.droneWave;
    droneOsc.frequency.value = cfg.droneFreq;
    droneGain.gain.setValueAtTime(0.0001, now);
    droneGain.gain.linearRampToValueAtTime(cfg.droneTargetGain, now + 3.0);
    droneOsc.connect(droneGain);
    droneGain.connect(destination);
    droneOsc.start(now);
  }

  return { droneOsc, droneGain, textureSource, textureFilter, textureGain, lfoOsc, lfoGain };
}

function stopAmbientBed(bed: AmbientBed, now: number): void {
  const fadeTime = 2.5;
  bed.textureGain.gain.linearRampToValueAtTime(0, now + fadeTime);
  if (bed.droneGain) bed.droneGain.gain.linearRampToValueAtTime(0, now + fadeTime);
  try { bed.textureSource.stop(now + fadeTime + 0.1); } catch (_) { /* already stopped */ }
  if (bed.droneOsc) { try { bed.droneOsc.stop(now + fadeTime + 0.1); } catch (_) { /* already stopped */ } }
  if (bed.lfoOsc) { try { bed.lfoOsc.stop(now + fadeTime + 0.1); } catch (_) { /* already stopped */ } }
}

// ---- Module-level engine augmentation ----
// Extra state stored in WeakMaps keyed on the engine,
// without needing to modify the SoundEngine interface in types.ts.

const engineCurrentBiome = new WeakMap<SoundEngine, Biome | null>();
const engineAmbientBed = new WeakMap<SoundEngine, AmbientBed>();
const engineSpawnCooldown = new WeakMap<SoundEngine, number>();
const engineBondBreakCooldown = new WeakMap<SoundEngine, number>();
const engineVolcanicAccentTime = new WeakMap<SoundEngine, number>();
const engineLonelyDroneTime = new WeakMap<SoundEngine, number>();

// Phase multipliers for ambient bed gain — drives the sonic arc
const PHASE_AMBIENT_MULT = [0.30, 0.60, 0.85, 1.00, 0.65, 0.10];

// Per-voice note scheduling state
interface VoiceSlot {
  lastNoteTime: number;
  noteInterval: number;
}

const voiceSlots: VoiceSlot[] = [];
for (let i = 0; i < MAX_VOICES; i++) {
  voiceSlots.push({ lastNoteTime: 0, noteInterval: 2 });
}
let lastChirpTime = 0;

export function createSoundEngine(): SoundEngine {
  return {
    ctx: null!,
    voices: [],
    masterGain: null!,
    reverb: null!,
    compressor: null!,
    initialized: false,
    weatherAmbient: {
      rainSource: null, rainGain: null, rainFilter: null,
      windSource: null, windGain: null, windFilter: null,
      currentType: null, thunderCooldown: 0,
    },
  };
}

export function initAudio(engine: SoundEngine): void {
  if (engine.initialized) return;

  const ctx = new AudioContext();
  engine.ctx = ctx;

  engine.compressor = ctx.createDynamicsCompressor();
  engine.compressor.threshold.value = -18;
  engine.compressor.knee.value = 8;
  engine.compressor.ratio.value = 4;
  engine.compressor.attack.value = 0.003;
  engine.compressor.release.value = 0.25;

  engine.masterGain = ctx.createGain();
  engine.masterGain.gain.value = 0.20;

  // Initial reverb — temperate profile, rebuilt on first biome-aware updateSound
  engine.reverb = createReverb(ctx, 1.8);

  // Dry path: compressor → master
  engine.compressor.connect(engine.masterGain);
  // Wet path: compressor → reverb → master
  engine.compressor.connect(engine.reverb);
  engine.reverb.connect(engine.masterGain);
  engine.masterGain.connect(ctx.destination);

  // No permanent oscillators — notes are triggered on demand

  engineCurrentBiome.set(engine, null);

  // Start ambient bed at temperate default; swapped on first biome-aware updateSound
  const ambientBed = createAmbientBed(ctx, "temperate", engine.masterGain);
  engineAmbientBed.set(engine, ambientBed);

  engine.initialized = true;
}

function createReverb(ctx: AudioContext, seconds: number): ConvolverNode {
  const conv = ctx.createConvolver();
  const len = Math.floor(ctx.sampleRate * seconds);
  const impulse = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = impulse.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.0);
    }
  }
  conv.buffer = impulse;
  return conv;
}

/** Trigger a single envelope-driven note */
function triggerNote(
  engine: SoundEngine,
  freq: number,
  waveform: OscillatorType,
  gain: number,
  decay: number,
  filterFreq: number,
  detuneCents = 0,
  useReverb = false,
  pan = 0,
): void {
  const ctx = engine.ctx;
  const now = ctx.currentTime;

  const osc = ctx.createOscillator();
  const gainNode = ctx.createGain();
  const filter = ctx.createBiquadFilter();
  const panner = ctx.createStereoPanner();

  osc.type = waveform;
  osc.frequency.value = freq;
  osc.detune.value = detuneCents;

  filter.type = "lowpass";
  filter.frequency.value = filterFreq;
  filter.Q.value = 1.5;

  panner.pan.value = Math.max(-1, Math.min(1, pan));

  // ADSR: 20ms attack, sustain at peak, then decay
  const attack = 0.02;
  const sustainTime = Math.min(0.05, decay * 0.15);
  gainNode.gain.setValueAtTime(0.001, now);
  gainNode.gain.linearRampToValueAtTime(gain, now + attack);
  gainNode.gain.setValueAtTime(gain, now + attack + sustainTime);
  gainNode.gain.exponentialRampToValueAtTime(0.001, now + attack + sustainTime + decay);

  osc.connect(filter);
  filter.connect(gainNode);
  gainNode.connect(panner);
  panner.connect(useReverb ? engine.reverb : engine.compressor);
  osc.start(now);
  osc.stop(now + attack + sustainTime + decay + 0.05);
}

/** Phase-dependent parameters for note scheduling */
interface PhaseAudioParams {
  volume: number;
  noteIntervalScale: number;
  decay: number;
  filterFreq: number;
  chirpRate: number;
}

const PHASE_AUDIO: PhaseAudioParams[] = [
  { volume: 0.08, noteIntervalScale: 3.0, decay: 1.2, filterFreq: 600, chirpRate: 0.02 },
  { volume: 0.15, noteIntervalScale: 1.5, decay: 0.6, filterFreq: 1200, chirpRate: 0.06 },
  { volume: 0.20, noteIntervalScale: 1.0, decay: 0.4, filterFreq: 1600, chirpRate: 0.08 },
  { volume: 0.25, noteIntervalScale: 0.6, decay: 0.3, filterFreq: 2400, chirpRate: 0.12 },
  { volume: 0.14, noteIntervalScale: 2.0, decay: 0.8, filterFreq: 800, chirpRate: 0.04 },
  { volume: 0.04, noteIntervalScale: 8.0, decay: 2.0, filterFreq: 400, chirpRate: 0.01 },
];

export function updateSound(
  engine: SoundEngine,
  motes: Mote[],
  phaseIndex: number,
  phaseProgress: number,
  biome: Biome = "temperate",
): void {
  if (!engine.initialized) return;

  const profile = BIOME_SOUND[biome];
  const scale = BIOME_PHASE_SCALES[biome][phaseIndex];
  const now = engine.ctx.currentTime;
  const pa = PHASE_AUDIO[phaseIndex];
  const nextPa = PHASE_AUDIO[(phaseIndex + 1) % 6];

  // Rebuild reverb and swap ambient bed when biome changes
  const prevBiome = engineCurrentBiome.get(engine);
  if (prevBiome !== biome) {
    const oldReverb = engine.reverb;
    const newReverb = createReverb(engine.ctx, profile.reverbSecs);
    try {
      engine.compressor.disconnect(oldReverb);
      oldReverb.disconnect(engine.masterGain);
    } catch (_) { /* ignore if not connected */ }
    engine.compressor.connect(newReverb);
    newReverb.connect(engine.masterGain);
    engine.reverb = newReverb;

    // Swap ambient texture bed to match new biome
    const oldBed = engineAmbientBed.get(engine);
    if (oldBed) stopAmbientBed(oldBed, now);
    engineAmbientBed.set(engine, createAmbientBed(engine.ctx, biome, engine.masterGain));

    engineCurrentBiome.set(engine, biome);
  }

  // Phase-reactive ambient bed — drives the full sonic arc (quiet genesis → full complexity → silent silence)
  const ambBed = engineAmbientBed.get(engine);
  const ambCfg = BIOME_AMBIENT[biome];
  if (ambBed) {
    const phaseMult = PHASE_AMBIENT_MULT[phaseIndex];
    ambBed.textureGain.gain.linearRampToValueAtTime(ambCfg.noiseTargetGain * phaseMult, now + 2.5);
    if (ambBed.droneGain && ambCfg.droneTargetGain > 0) {
      ambBed.droneGain.gain.linearRampToValueAtTime(ambCfg.droneTargetGain * phaseMult, now + 2.5);
    }
  }

  // Interpolate phase volume with biome multiplier
  const targetVol = (pa.volume * (1 - phaseProgress) + nextPa.volume * phaseProgress) * profile.masterMult;
  engine.masterGain.gain.linearRampToValueAtTime(targetVol, now + 0.5);

  const decay = pa.decay * (1 - phaseProgress) + nextPa.decay * phaseProgress;
  const filterFreq = pa.filterFreq * (1 - phaseProgress) + nextPa.filterFreq * phaseProgress;

  // Clusters → triggered notes (no permanent oscillators, no drone)
  const clusters = findClusters(motes);
  clusters.sort((a, b) => b.length - a.length);
  const active = clusters.slice(0, MAX_VOICES);

  for (let i = 0; i < MAX_VOICES; i++) {
    const slot = voiceSlots[i];

    if (i < active.length) {
      const cluster = active[i];
      let cx = 0, cy = 0, totalEnergy = 0;
      for (const m of cluster) { cx += m.x; cy += m.y; totalEnergy += m.energy; }
      cx /= cluster.length;
      cy /= cluster.length;
      totalEnergy /= cluster.length;

      // Note interval based on cluster size and phase
      const baseInterval = cluster.length < 4 ? 2.0 : cluster.length < 7 ? 0.8 : 0.3;
      slot.noteInterval = baseInterval * pa.noteIntervalScale;

      if (now - slot.lastNoteTime >= slot.noteInterval) {
        slot.lastNoteTime = now;

        // Y position → scale degree → biome-rooted frequency
        // Offset each voice by its index so concurrent clusters form chords
        const yNorm = 1 - cy / H;
        const baseIdx = Math.floor(yNorm * scale.length) % scale.length;
        const idx = (baseIdx + i) % scale.length;
        const freq = profile.rootFreq * Math.pow(2, scale[idx] / 12);

        const sz = cluster.length;
        const waveform = sz < 4 ? profile.waveSmall : sz < 8 ? profile.waveMed : profile.waveLarge;
        const noteGain = Math.log2(cluster.length + 1) / Math.log2(MAX_VOICES + 1) * totalEnergy * 0.15;
        const detune = (cx / W - 0.5) * profile.detuneRange * 0.5; // halved: panning now carries the spatial load
        const pan = (cx / W * 2 - 1) * profile.panStrength;

        triggerNote(engine, freq, waveform, noteGain, decay, filterFreq, detune, false, pan);
        // Harmonic enrichment: clusters of 6+ gain a quiet 5th partial → ensemble depth
        if (sz >= 6 && Math.random() < 0.42) {
          triggerNote(engine, freq * Math.pow(2, 7 / 12), "sine",
            noteGain * 0.28, decay * 1.5, filterFreq * 0.55, 0, true, pan * 0.65);
        }
      }
    } else {
      slot.lastNoteTime = 0;
    }
  }

  // Individual mote chirps — temperament-varied
  const chirpRate = pa.chirpRate * (1 - phaseProgress) + nextPa.chirpRate * phaseProgress;
  if (now - lastChirpTime > 0.15 && motes.length > 0 && Math.random() < chirpRate) {
    const m = motes[Math.floor(Math.random() * motes.length)];
    playChirp(engine, m, scale, profile);
    lastChirpTime = now;
  }

  // Lone mote pings — sparse presence using audio clock
  const loners = motes.filter((m) => m.bonds.length === 0);
  if (loners.length > 0) {
    const t = now % 8;
    if (t < 0.068) {
      const m = loners[Math.floor((t * 1000 + loners.length) % loners.length)];
      ping(engine, m.x / W, 1 - m.y / H, m.energy, scale, profile);
    }
  }

  // Bond formation sounds
  for (const m of motes) {
    if (m.bondFlash > 0.9) {
      playBondForm(engine, 1 - m.y / H, scale, profile);
      break;
    }
  }

  // Bond break sounds — two tones falling apart (inverse of bond formation)
  const bondBreakCooldown = engineBondBreakCooldown.get(engine) ?? 0;
  if (now - bondBreakCooldown > 0.20) {
    for (const m of motes) {
      if (m.bondBreakFlash > 0.9) {
        playBondBreak(engine, 1 - m.y / H, scale, profile);
        engineBondBreakCooldown.set(engine, now);
        break;
      }
    }
  }

  // Spawn sounds — gentle arrival ping for freshly born motes
  const spawnCooldown = engineSpawnCooldown.get(engine) ?? 0;
  if (now - spawnCooldown > 0.18) {
    const freshMote = motes.find((m) => m.spawnFlash > 0.75);
    if (freshMote) {
      playSpawnPing(engine, freshMote.x / W, 1 - freshMote.y / H, scale, profile);
      engineSpawnCooldown.set(engine, now);
    }
  }

  // Volcanic lava pops — periodic low-frequency transients, like bubbles of magma surfacing
  if (biome === "volcanic") {
    const lastAccent = engineVolcanicAccentTime.get(engine) ?? 0;
    if (now - lastAccent > 2.2 + Math.random() * 4.5) {
      engineVolcanicAccentTime.set(engine, now);
      const aCtx = engine.ctx;
      const popLen = Math.floor(aCtx.sampleRate * 0.11);
      const popBuf = aCtx.createBuffer(1, popLen, aCtx.sampleRate);
      const popData = popBuf.getChannelData(0);
      for (let i = 0; i < popLen; i++) popData[i] = (Math.random() * 2 - 1) * Math.exp(-i / (popLen * 0.22));
      const popSrc = aCtx.createBufferSource();
      popSrc.buffer = popBuf;
      const popFilter = aCtx.createBiquadFilter();
      popFilter.type = "bandpass";
      popFilter.frequency.value = 150 + Math.random() * 160;
      popFilter.Q.value = 3.2;
      const popGain = aCtx.createGain();
      const popVol = (0.007 + Math.random() * 0.011) * profile.masterMult;
      popGain.gain.setValueAtTime(popVol, now);
      popGain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
      popSrc.connect(popFilter);
      popFilter.connect(popGain);
      popGain.connect(engine.compressor);
      popSrc.start(now);
    }
  }

  // Silence loner: when the last 1–2 motes remain in dissolution or silence,
  // a quiet sustained tone holds the space — loneliness made audible
  if (phaseIndex >= 4 && motes.length >= 1 && motes.length <= 2) {
    const lastLonely = engineLonelyDroneTime.get(engine) ?? 0;
    if (now - lastLonely > 22.0) {
      engineLonelyDroneTime.set(engine, now);
      const lCtx = engine.ctx;
      const m = motes[0];
      const lonelyFreq = profile.rootFreq * (1.0 + (1 - m.y / H) * 0.4);
      const lOsc = lCtx.createOscillator();
      const lGain = lCtx.createGain();
      lOsc.type = "sine";
      lOsc.frequency.value = lonelyFreq;
      lGain.gain.setValueAtTime(0.0, now);
      lGain.gain.linearRampToValueAtTime(0.016 * profile.masterMult, now + 3.0);
      lGain.gain.setValueAtTime(0.016 * profile.masterMult, now + 10.0);
      lGain.gain.exponentialRampToValueAtTime(0.001, now + 22.0);
      lOsc.connect(lGain);
      lGain.connect(engine.reverb);
      lOsc.start(now);
      lOsc.stop(now + 23.0);
    }
  }
}

/** Individual mote chirp — varies by temperament */
function playChirp(engine: SoundEngine, m: Mote, scale: number[], profile: BiomeSoundProfile): void {
  const ctx = engine.ctx;
  const now = ctx.currentTime;
  const yNorm = 1 - m.y / H;
  const idx = Math.floor(yNorm * scale.length) % scale.length;
  const baseFreq = profile.rootFreq * Math.pow(2, scale[idx] / 12) * 2;

  const waveform: OscillatorType =
    m.temperament.wanderlust > 0.6 ? "triangle" :
    m.temperament.hardiness > 0.6 ? "square" : "sine";

  if (m.temperament.wanderlust > 0.5) {
    // Ascending two-note chirp (bird-like)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = waveform;
    osc1.frequency.value = baseFreq;
    gain1.gain.setValueAtTime(0.001, now);
    gain1.gain.linearRampToValueAtTime(m.energy * 0.10, now + 0.01);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    osc1.connect(gain1);
    gain1.connect(engine.compressor);
    osc1.start(now);
    osc1.stop(now + 0.15);

    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = waveform;
    osc2.frequency.value = baseFreq * 1.25;
    gain2.gain.setValueAtTime(0.001, now + 0.06);
    gain2.gain.linearRampToValueAtTime(m.energy * 0.10, now + 0.07);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    osc2.connect(gain2);
    gain2.connect(engine.compressor);
    osc2.start(now + 0.06);
    osc2.stop(now + 0.22);
  } else if (m.temperament.hardiness > 0.5) {
    // Short percussive click
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.value = baseFreq * 0.5;
    gain.gain.setValueAtTime(m.energy * 0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
    osc.connect(gain);
    gain.connect(engine.compressor);
    osc.start(now);
    osc.stop(now + 0.08);
  } else {
    // Warm mid-range blip
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = baseFreq;
    osc.detune.value = (m.x / W - 0.5) * 30;
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(m.energy * 0.09, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    osc.connect(gain);
    gain.connect(engine.compressor);
    osc.start(now);
    osc.stop(now + 0.3);
  }
}

/** Gentle arrival ping — a mote enters the world */
function playSpawnPing(
  engine: SoundEngine,
  xNorm: number,
  yNorm: number,
  scale: number[],
  profile: BiomeSoundProfile,
): void {
  const ctx = engine.ctx;
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const panner = ctx.createStereoPanner();

  osc.type = "sine";
  const idx = Math.floor(yNorm * scale.length) % scale.length;
  osc.frequency.value = profile.rootFreq * Math.pow(2, scale[idx] / 12) * 2;

  panner.pan.value = (xNorm * 2 - 1) * profile.panStrength * 0.6;

  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.013, now + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.38);

  osc.connect(gain);
  gain.connect(panner);
  panner.connect(engine.reverb);
  osc.start(now);
  osc.stop(now + 0.42);
}

/** Two-note ascending chime on bond formation — a perfect fifth finding harmony */
export function playBondForm(
  engine: SoundEngine,
  yNorm: number,
  scale: number[],
  profile?: BiomeSoundProfile,
): void {
  const p = profile ?? BIOME_SOUND.temperate;
  const ctx = engine.ctx;
  const now = ctx.currentTime;

  const idx = Math.floor(yNorm * scale.length) % scale.length;
  const freq1 = p.rootFreq * Math.pow(2, scale[idx] / 12) * 2;
  const freq2 = freq1 * Math.pow(2, 7 / 12); // perfect fifth above

  const osc1 = ctx.createOscillator();
  const gain1 = ctx.createGain();
  osc1.type = "sine";
  osc1.frequency.value = freq1;
  gain1.gain.setValueAtTime(0.001, now);
  gain1.gain.linearRampToValueAtTime(0.032, now + 0.02);
  gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
  osc1.connect(gain1);
  gain1.connect(engine.reverb);
  osc1.start(now);
  osc1.stop(now + 0.6);

  const osc2 = ctx.createOscillator();
  const gain2 = ctx.createGain();
  osc2.type = "sine";
  osc2.frequency.value = freq2;
  gain2.gain.setValueAtTime(0.001, now + 0.065);
  gain2.gain.linearRampToValueAtTime(0.025, now + 0.085);
  gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.65);
  osc2.connect(gain2);
  gain2.connect(engine.reverb);
  osc2.start(now + 0.065);
  osc2.stop(now + 0.7);
}

/** Two tones falling apart on bond break — inverse of playBondForm */
function playBondBreak(
  engine: SoundEngine,
  yNorm: number,
  scale: number[],
  profile: BiomeSoundProfile,
): void {
  const ctx = engine.ctx;
  const now = ctx.currentTime;

  const idx = Math.floor(yNorm * scale.length) % scale.length;
  const freq = profile.rootFreq * Math.pow(2, scale[idx] / 12) * 2;

  // First tone: slides a minor third downward — the lower voice breaking away
  const osc1 = ctx.createOscillator();
  const gain1 = ctx.createGain();
  osc1.type = "triangle";
  osc1.frequency.setValueAtTime(freq, now);
  osc1.frequency.exponentialRampToValueAtTime(freq * Math.pow(2, -3 / 12), now + 0.30);
  gain1.gain.setValueAtTime(0.001, now);
  gain1.gain.linearRampToValueAtTime(0.020, now + 0.015);
  gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
  osc1.connect(gain1);
  gain1.connect(engine.reverb);
  osc1.start(now);
  osc1.stop(now + 0.40);

  // Second tone: starts at a fifth, drops below the root — the two voices diverging
  const osc2 = ctx.createOscillator();
  const gain2 = ctx.createGain();
  osc2.type = "sine";
  osc2.frequency.setValueAtTime(freq * Math.pow(2, 7 / 12), now + 0.03);
  osc2.frequency.exponentialRampToValueAtTime(freq * Math.pow(2, -2 / 12), now + 0.26);
  gain2.gain.setValueAtTime(0.001, now + 0.03);
  gain2.gain.linearRampToValueAtTime(0.014, now + 0.055);
  gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.30);
  osc2.connect(gain2);
  gain2.connect(engine.reverb);
  osc2.start(now + 0.03);
  osc2.stop(now + 0.35);
}

/** Death sound — distinct per biome, loss made audible in each world's own voice */
export function playDeath(engine: SoundEngine, yNorm: number): void {
  if (!engine.initialized) return;
  const biome = engineCurrentBiome.get(engine) ?? "temperate";
  const p = BIOME_SOUND[biome];
  const ctx = engine.ctx;
  const now = ctx.currentTime;

  switch (biome) {
    case "volcanic": {
      // Crack + low thud: a mote shatters like cooling lava
      const bufLen = Math.floor(ctx.sampleRate * 0.14);
      const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < bufLen; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufLen * 0.18));
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const filt = ctx.createBiquadFilter();
      filt.type = "lowpass";
      filt.frequency.value = 280;
      const gn = ctx.createGain();
      gn.gain.setValueAtTime(0.040, now);
      gn.gain.exponentialRampToValueAtTime(0.001, now + 0.50);
      src.connect(filt);
      filt.connect(gn);
      gn.connect(engine.compressor);
      src.start(now);
      // Sub-bass thud follows crack
      const thud = ctx.createOscillator();
      const thudGain = ctx.createGain();
      thud.type = "sine";
      thud.frequency.setValueAtTime(70, now + 0.02);
      thud.frequency.exponentialRampToValueAtTime(26, now + 0.38);
      thudGain.gain.setValueAtTime(0.038, now + 0.02);
      thudGain.gain.exponentialRampToValueAtTime(0.001, now + 0.42);
      thud.connect(thudGain);
      thudGain.connect(engine.compressor);
      thud.start(now + 0.02);
      thud.stop(now + 0.45);
      break;
    }

    case "desert": {
      // Bell toll: long, reverberant, no glide — a note struck once in vast silence
      const freq = p.rootFreq * (2.0 + yNorm * 0.5);
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.030, now);
      gain.gain.setValueAtTime(0.030, now + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 3.2);
      osc.connect(gain);
      gain.connect(engine.reverb);
      osc.start(now);
      osc.stop(now + 3.4);
      // Faint 3rd harmonic — bell shimmer
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = "sine";
      osc2.frequency.value = freq * 3.0;
      gain2.gain.setValueAtTime(0.008, now);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 1.4);
      osc2.connect(gain2);
      gain2.connect(engine.reverb);
      osc2.start(now);
      osc2.stop(now + 1.6);
      break;
    }

    case "tundra": {
      // Ice crystal: brief high ping + crystalline reverb tail — cold and precise
      const freq = p.rootFreq * 4.0 * (1 + yNorm * 0.25);
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.028, now);
      gain.gain.exponentialRampToValueAtTime(0.003, now + 0.05);
      gain.gain.linearRampToValueAtTime(0.003, now + 0.25);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 2.2);
      osc.connect(gain);
      gain.connect(engine.reverb);
      osc.start(now);
      osc.stop(now + 2.4);
      // Second crystalline partial — very faint upper tone
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = "sine";
      osc2.frequency.value = freq * Math.pow(2, 5 / 12);
      gain2.gain.setValueAtTime(0.010, now);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 1.5);
      osc2.connect(gain2);
      gain2.connect(engine.reverb);
      osc2.start(now);
      osc2.stop(now + 1.7);
      break;
    }

    case "lush": {
      // Warm chord dissolve: root + 5th + octave softly collapsing — organic, bittersweet
      const baseFreq = p.rootFreq * (1.0 + yNorm * 0.55);
      for (const [semitones, vol, dur] of [[0, 0.022, 1.9], [7, 0.016, 1.6], [12, 0.011, 1.3]] as [number, number, number][]) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = baseFreq * Math.pow(2, semitones / 12);
        gain.gain.setValueAtTime(vol, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + dur);
        osc.connect(gain);
        gain.connect(engine.reverb);
        osc.start(now);
        osc.stop(now + dur + 0.1);
      }
      break;
    }

    default: { // temperate — descending sigh: two voices falling together, then gone
      const startFreq = p.rootFreq * (1 + yNorm * 0.6);
      const endFreq = startFreq * 0.63;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(startFreq, now);
      osc.frequency.exponentialRampToValueAtTime(endFreq, now + 0.9);
      gain.gain.setValueAtTime(0.022, now);
      gain.gain.setValueAtTime(0.022, now + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 1.0);
      osc.connect(gain);
      gain.connect(engine.reverb);
      osc.start(now);
      osc.stop(now + 1.1);
      // Soft 5th following the descent — two voices parting
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = "sine";
      osc2.frequency.setValueAtTime(startFreq * Math.pow(2, 7 / 12), now);
      osc2.frequency.exponentialRampToValueAtTime(endFreq * Math.pow(2, 7 / 12), now + 0.7);
      gain2.gain.setValueAtTime(0.009, now);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.75);
      osc2.connect(gain2);
      gain2.connect(engine.reverb);
      osc2.start(now);
      osc2.stop(now + 0.80);
      break;
    }
  }
}

/** Different sound per event type */
export function playEventSound(engine: SoundEngine, eventType: string): void {
  const ctx = engine.ctx;
  const now = ctx.currentTime;

  switch (eventType) {
    case "meteor": {
      // High noise burst sweeping down to bass impact
      const bufLen = Math.floor(ctx.sampleRate * 0.9);
      const buf = ctx.createBuffer(2, bufLen, ctx.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        for (let i = 0; i < bufLen; i++) d[i] = Math.random() * 2 - 1;
      }
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(4000, now);
      filter.frequency.exponentialRampToValueAtTime(70, now + 0.7);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.14, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.9);
      src.connect(filter);
      filter.connect(gain);
      gain.connect(engine.compressor);
      src.start(now);
      src.stop(now + 0.9);
      break;
    }

    case "flood": {
      // Rising wash of filtered noise
      const src = createNoiseSource(ctx, 2.5);
      const filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.setValueAtTime(2800, now);
      filter.frequency.exponentialRampToValueAtTime(180, now + 2.2);
      filter.Q.value = 0.4;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0, now);
      gain.gain.linearRampToValueAtTime(0.065, now + 0.4);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 2.2);
      src.connect(filter);
      filter.connect(gain);
      gain.connect(engine.compressor);
      src.start(now);
      src.stop(now + 2.3);
      break;
    }

    case "bloom": {
      // Bright major chord burst — 4 notes in quick succession
      const root = 261.63; // C4
      const bloomFreqs = [root, root * Math.pow(2, 4 / 12), root * Math.pow(2, 7 / 12), root * 2];
      bloomFreqs.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        const t = now + i * 0.09;
        gain.gain.setValueAtTime(0.001, t);
        gain.gain.linearRampToValueAtTime(0.052, t + 0.12);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 1.6);
        osc.connect(gain);
        gain.connect(engine.reverb);
        osc.start(t);
        osc.stop(t + 1.7);
      });
      break;
    }

    case "earthquake": {
      // Sub-bass descending sawtooth with falling pitch
      const osc = ctx.createOscillator();
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(40, now);
      osc.frequency.linearRampToValueAtTime(28, now + 1.0);
      filter.type = "lowpass";
      filter.frequency.value = 95;
      gain.gain.setValueAtTime(0.0, now);
      gain.gain.linearRampToValueAtTime(0.09, now + 0.08);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 1.1);
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(engine.compressor);
      osc.start(now);
      osc.stop(now + 1.2);
      break;
    }

    case "plague": {
      // 3 detuned sines — unsettling cluster of dissonance
      const freqs = [194, 200, 215];
      for (const freq of freqs) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0, now);
        gain.gain.linearRampToValueAtTime(0.024, now + 0.08);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.65);
        osc.connect(gain);
        gain.connect(engine.compressor);
        osc.start(now);
        osc.stop(now + 0.75);
      }
      break;
    }

    case "aurora": {
      // Harmonic series spread across stereo — shimmering overtone cloud
      const auroraRoot = 130.81;
      const ratios = [1, 1.5, 2, 2.5, 3, 4];
      ratios.forEach((ratio, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const panner = ctx.createStereoPanner();
        osc.type = "sine";
        osc.frequency.value = auroraRoot * ratio;
        osc.detune.value = (i - 2.5) * 6;
        panner.pan.value = (i / (ratios.length - 1)) * 2 - 1;
        const vol = 0.038 / (i * 0.6 + 1);
        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(vol, now + 1.8);
        gain.gain.setValueAtTime(vol, now + 3.0);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 6.0);
        osc.connect(panner);
        panner.connect(gain);
        gain.connect(engine.reverb);
        osc.start(now);
        osc.stop(now + 6.2);
      });
      break;
    }

    case "drought": {
      // Sudden hush — the world goes dry
      const currentVol = engine.masterGain.gain.value;
      engine.masterGain.gain.setValueAtTime(currentVol, now);
      engine.masterGain.gain.linearRampToValueAtTime(currentVol * 0.4, now + 0.25);
      engine.masterGain.gain.linearRampToValueAtTime(currentVol, now + 2.8);
      break;
    }

    case "migration": {
      // Ascending arpeggio — hopeful, departing
      const migScale = BIOME_PHASE_SCALES.temperate[1];
      const steps = [0, 2, 4, 6];
      for (let i = 0; i < steps.length; i++) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        const idx = Math.min(steps[i], migScale.length - 1);
        osc.frequency.value = 130.81 * Math.pow(2, migScale[idx] / 12);
        const t = now + i * 0.13;
        gain.gain.setValueAtTime(0.001, t);
        gain.gain.linearRampToValueAtTime(0.042, t + 0.04);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
        osc.connect(gain);
        gain.connect(engine.reverb);
        osc.start(t);
        osc.stop(t + 0.5);
      }
      break;
    }

    case "eclipse": {
      // Two-layer drone: deep bass + eerie 7th harmonic partial
      const eclipseRoot = 65.41; // C2

      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = "sine";
      osc1.frequency.value = eclipseRoot;
      gain1.gain.setValueAtTime(0.001, now);
      gain1.gain.linearRampToValueAtTime(0.055, now + 1.8);
      gain1.gain.setValueAtTime(0.055, now + 4.0);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 6.0);
      osc1.connect(gain1);
      gain1.connect(engine.compressor);
      osc1.start(now);
      osc1.stop(now + 6.2);

      // 7th harmonic — eerie overtone
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = "sine";
      osc2.frequency.value = eclipseRoot * 7;
      gain2.gain.setValueAtTime(0.001, now);
      gain2.gain.linearRampToValueAtTime(0.014, now + 2.5);
      gain2.gain.setValueAtTime(0.014, now + 4.0);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 6.0);
      osc2.connect(gain2);
      gain2.connect(engine.reverb);
      osc2.start(now);
      osc2.stop(now + 6.2);
      break;
    }
  }
}

/** Lone mote ping — sparse presence */
function ping(
  engine: SoundEngine,
  xNorm: number, yNorm: number,
  energy: number, scale: number[],
  profile: BiomeSoundProfile,
): void {
  const ctx = engine.ctx;
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const panner = ctx.createStereoPanner();

  osc.type = "sine";
  const idx = Math.floor(yNorm * scale.length) % scale.length;
  osc.frequency.value = profile.rootFreq * Math.pow(2, scale[idx] / 12) * 2;

  panner.pan.value = (xNorm * 2 - 1) * profile.panStrength;

  gain.gain.setValueAtTime(energy * 0.038, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.75);

  osc.connect(gain);
  gain.connect(panner);
  panner.connect(engine.reverb);
  osc.start(now);
  osc.stop(now + 0.85);
}

/** Create a looping stereo noise buffer source */
function createNoiseSource(ctx: AudioContext, duration: number): AudioBufferSourceNode {
  const len = Math.floor(ctx.sampleRate * duration);
  const buffer = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buffer.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      d[i] = Math.random() * 2 - 1;
    }
  }
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = true;
  return src;
}

/** Update ambient weather sounds — audible rain, wind, thunder */
export function updateWeatherSound(engine: SoundEngine, weather: Weather): void {
  if (!engine.initialized) return;

  const ctx = engine.ctx;
  const now = ctx.currentTime;
  const amb = engine.weatherAmbient;
  const needsRain = weather.type === "rain" || weather.type === "storm";
  const needsWind = weather.type === "storm" || weather.type === "snow" || weather.type === "overcast";

  if (amb.currentType !== weather.type) {
    if (amb.rainGain) amb.rainGain.gain.linearRampToValueAtTime(0, now + 1);
    if (amb.windGain) amb.windGain.gain.linearRampToValueAtTime(0, now + 1);
    if (amb.rainSource) { try { amb.rainSource.stop(now + 1.1); } catch (_) { /* ignore */ } }
    if (amb.windSource) { try { amb.windSource.stop(now + 1.1); } catch (_) { /* ignore */ } }
    amb.rainSource = null; amb.rainGain = null; amb.rainFilter = null;
    amb.windSource = null; amb.windGain = null; amb.windFilter = null;

    if (needsRain) {
      const src = createNoiseSource(ctx, 2);
      const filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = weather.type === "storm" ? 1000 : 3000;
      filter.Q.value = 0.8;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, now);
      const targetVol = weather.type === "storm"
        ? 0.10 + weather.intensity * 0.12
        : 0.06 + weather.intensity * 0.08;
      gain.gain.linearRampToValueAtTime(targetVol, now + 2);
      src.connect(filter);
      filter.connect(gain);
      gain.connect(engine.masterGain);
      src.start(now);
      amb.rainSource = src;
      amb.rainGain = gain;
      amb.rainFilter = filter;
    }

    if (needsWind) {
      const src = createNoiseSource(ctx, 3);
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 400;
      filter.Q.value = 0.5;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, now);
      const targetVol = weather.type === "storm"
        ? 0.08 + weather.intensity * 0.08
        : 0.04 + weather.intensity * 0.04;
      gain.gain.linearRampToValueAtTime(targetVol, now + 2);
      src.connect(filter);
      filter.connect(gain);
      gain.connect(engine.masterGain);
      src.start(now);
      amb.windSource = src;
      amb.windGain = gain;
      amb.windFilter = filter;
    }

    amb.currentType = weather.type;
  }

  if (amb.rainFilter && needsRain) {
    const sweep = Math.sin(now * 0.3) * 800 + (weather.type === "storm" ? 1500 : 3000);
    amb.rainFilter.frequency.linearRampToValueAtTime(sweep, now + 0.1);
  }

  if (amb.windGain && needsWind) {
    const gustBase = weather.type === "storm" ? 0.10 : 0.05;
    const gustSwing = weather.type === "storm" ? 0.06 : 0.03;
    const gust = gustBase + Math.sin(now * 0.6) * gustSwing + Math.sin(now * 1.7) * gustSwing * 0.5;
    amb.windGain.gain.linearRampToValueAtTime(Math.max(0, gust), now + 0.1);
  }

  if (weather.type === "storm" && weather.lightning.active) {
    amb.thunderCooldown -= 0.067;
    if (amb.thunderCooldown <= 0) {
      playThunder(engine, weather.lightning.brightness);
      amb.thunderCooldown = 15 + Math.random() * 25;
    }
  }
}

/**
 * Phase transition musical moment — a distinct chord or melodic figure at each boundary.
 */
export function playPhaseTransition(engine: SoundEngine, phaseIndex: number, biome: Biome = "temperate"): void {
  if (!engine.initialized) return;
  const p = BIOME_SOUND[biome];
  const ctx = engine.ctx;
  const now = ctx.currentTime;

  const note = (semitones: number, octaveMult: number, delay: number, duration: number, maxGain: number) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = p.rootFreq * Math.pow(2, semitones / 12) * octaveMult;
    gain.gain.setValueAtTime(0.001, now + delay);
    gain.gain.linearRampToValueAtTime(maxGain, now + delay + 0.07);
    gain.gain.exponentialRampToValueAtTime(0.001, now + delay + duration);
    osc.connect(gain);
    gain.connect(engine.reverb);
    osc.start(now + delay);
    osc.stop(now + delay + duration + 0.05);
  };

  switch (phaseIndex) {
    case 0: // genesis — a slow-dawning fifth
      note(0,  1, 0.0, 4.2, 0.016);
      note(7,  1, 0.4, 3.8, 0.012);
      break;

    case 1: // exploration — ascending major arpeggio
      note(0,  2, 0.00, 1.1, 0.019);
      note(4,  2, 0.09, 1.0, 0.017);
      note(7,  2, 0.18, 1.0, 0.016);
      note(12, 2, 0.27, 1.3, 0.021);
      break;

    case 2: // organization — warm major triad landing
      note(0, 1, 0.00, 2.8, 0.023);
      note(4, 1, 0.05, 2.7, 0.021);
      note(7, 1, 0.10, 2.7, 0.020);
      break;

    case 3: // complexity — full major 7th chord, peak of life
      note(0,  1, 0.00, 3.0, 0.025);
      note(4,  1, 0.00, 3.0, 0.023);
      note(7,  1, 0.00, 3.0, 0.023);
      note(11, 1, 0.06, 2.6, 0.019);
      note(0,  2, 0.12, 2.3, 0.017);
      break;

    case 4: // dissolution — minor triad then a drop
      note(0,  2, 0.00, 1.3, 0.019);
      note(3,  2, 0.00, 1.3, 0.017);
      note(7,  2, 0.00, 1.3, 0.017);
      note(0,  1, 0.35, 3.8, 0.021);
      break;

    case 5: // silence — single root tone fading into nothing
      note(-12, 1, 0.0, 6.0, 0.018);
      break;
  }
}

/** Low rumbling thunder */
function playThunder(engine: SoundEngine, intensity: number): void {
  const ctx = engine.ctx;
  const now = ctx.currentTime;

  const len = Math.floor(ctx.sampleRate * 1.5);
  const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < len; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 150;
  const gain = ctx.createGain();
  const vol = 0.15 + intensity * 0.10;
  gain.gain.setValueAtTime(0.001, now);
  gain.gain.linearRampToValueAtTime(vol, now + 0.03);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 1.4);
  src.connect(filter);
  filter.connect(gain);
  gain.connect(engine.compressor);
  src.start(now);
  src.stop(now + 1.5);
}
