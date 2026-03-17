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
const engineDesertShimmerTime = new WeakMap<SoundEngine, number>();
const engineMilestone4Time = new WeakMap<SoundEngine, number>();
const engineMilestone8Time = new WeakMap<SoundEngine, number>();
const engineTundraWindTime = new WeakMap<SoundEngine, number>();
const engineVolcanicRumbleTime = new WeakMap<SoundEngine, number>();
const engineClusterMergeCooldown = new WeakMap<SoundEngine, number>();
const engineMourningTime = new WeakMap<SoundEngine, number>();
const enginePrevMoteCount = new WeakMap<SoundEngine, number>();
const engineLushBloomTime = new WeakMap<SoundEngine, number>();
const engineAncientBondBreakTime = new WeakMap<SoundEngine, number>();
const engineLushFireflyTime = new WeakMap<SoundEngine, number>();
const engineTundraCrystalTime = new WeakMap<SoundEngine, number>();
const engineCascadeArrivalTime = new WeakMap<SoundEngine, number>();

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
    let phaseMult = PHASE_AMBIENT_MULT[phaseIndex];
    // Tundra: drop ambient bed much faster in dissolution/silence so the
    // tundra wind tone (phaseIndex 5) arrives into genuine quiet rather than
    // competing with the noise texture.
    if (biome === "tundra" && phaseIndex === 4) phaseMult = 0.12;
    if (biome === "tundra" && phaseIndex === 5) phaseMult = 0.02;
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

  // Mote-count-aware mixing: gently reduce gain as population peaks to prevent saturation
  const densityScale = Math.max(0.55, 1.1 - motes.length * 0.009);

  // Phase-based reverb routing: dissolution & silence send notes through reverb → ghostly distance
  // Starts crossfading in mid-dissolution, fully wet in silence
  const reverbProb = phaseIndex >= 5 ? 1.0 : phaseIndex === 4 ? 0.35 + phaseProgress * 0.65 : 0;

  // Cluster growth milestones — fire a special sound when a cluster first reaches size 4 or 8
  for (const cluster of active) {
    const sz = cluster.length;
    if (sz === 4) {
      const last4 = engineMilestone4Time.get(engine) ?? -999;
      if (now - last4 > 25.0) {
        engineMilestone4Time.set(engine, now);
        playClusterMilestone(engine, scale, profile, 4);
      }
    } else if (sz >= 8) {
      const last8 = engineMilestone8Time.get(engine) ?? -999;
      if (now - last8 > 50.0) {
        engineMilestone8Time.set(engine, now);
        playClusterMilestone(engine, scale, profile, 8);
      }
    }
  }

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

        // Energy-mapped brightness: high-energy clusters → brighter filter, shorter decay
        // Low-energy clusters → darker, slower-decaying notes
        const energyFilterBoost = 0.65 + totalEnergy * 0.70;
        const energyDecayMod  = 1.25 - totalEnergy * 0.45;
        const effectiveFilter = filterFreq * energyFilterBoost;
        const effectiveDecay  = decay * energyDecayMod;

        const noteGain = Math.log2(sz + 1) / Math.log2(MAX_VOICES + 1) * totalEnergy * 0.15 * densityScale;
        const detune = (cx / W - 0.5) * profile.detuneRange * 0.5; // halved: panning now carries the spatial load
        const pan = (cx / W * 2 - 1) * profile.panStrength;

        const useRev = Math.random() < reverbProb;
        triggerNote(engine, freq, waveform, noteGain, effectiveDecay, effectiveFilter, detune, useRev, pan);
        // Harmonic enrichment: clusters of 6+ gain a quiet 5th partial → ensemble depth
        if (sz >= 6 && Math.random() < 0.42) {
          triggerNote(engine, freq * Math.pow(2, 7 / 12), "sine",
            noteGain * 0.28, effectiveDecay * 1.5, effectiveFilter * 0.55, 0, true, pan * 0.65);
        }
      }
    } else {
      slot.lastNoteTime = 0;
    }
  }

  // Desert shimmer — occasional very-high harmonic sparkle: heat haze made audible
  if (biome === "desert") {
    const lastShimmer = engineDesertShimmerTime.get(engine) ?? 0;
    if (now - lastShimmer > 0.9 && Math.random() < 0.028) {
      engineDesertShimmerTime.set(engine, now);
      playDesertShimmer(engine, profile, scale);
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

  // Ancient bond break — deep sorrowful chord when a long relationship ends (70s+ bonds)
  const ancientBreakTime = engineAncientBondBreakTime.get(engine) ?? 0;
  if (now - ancientBreakTime > 3.0) {
    for (const m of motes) {
      if (m.ancientBondBreakFlash > 0.9) {
        playAncientBondBreak(engine, 1 - m.y / H, profile, biome);
        engineAncientBondBreakTime.set(engine, now);
        break;
      }
    }
  }

  // Cluster merge sounds — two communities finding each other's resonance
  const clusterMergeCooldown = engineClusterMergeCooldown.get(engine) ?? 0;
  if (now - clusterMergeCooldown > 1.5) {
    for (const m of motes) {
      if (m.clusterMergeFlash > 0.9) {
        playClusterMerge(engine, profile, biome);
        engineClusterMergeCooldown.set(engine, now);
        break;
      }
    }
  }

  // Mourning chorus — when 2+ motes grieve together, a quiet communal chord
  const mourningTime = engineMourningTime.get(engine) ?? 0;
  if (now - mourningTime > 7.0) {
    let mourningCount = 0;
    for (const m of motes) { if (m.mourningFlash > 0.6) mourningCount++; }
    if (mourningCount >= 2) {
      playMourningChorus(engine, profile, biome);
      engineMourningTime.set(engine, now);
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

  // Tundra silence: two detuned sines that rise and fall like a cold wind breathing —
  // the frozen world's last exhale. Long arc (26s), fully wet in reverb.
  if (biome === "tundra" && phaseIndex === 5) {
    const lastWind = engineTundraWindTime.get(engine) ?? 0;
    if (now - lastWind > 28.0) {
      engineTundraWindTime.set(engine, now);
      const wCtx = engine.ctx;
      for (const [detune, pan, vol] of [[-9, -0.45, 0.012], [9, 0.45, 0.010]] as [number, number, number][]) {
        const wOsc = wCtx.createOscillator();
        const wGain = wCtx.createGain();
        const wPan = wCtx.createStereoPanner();
        wOsc.type = "sine";
        wOsc.frequency.value = profile.rootFreq * 2;
        wOsc.detune.value = detune;
        wPan.pan.value = pan;
        // Slow rise → hold → fall: a breath that fills the silence then recedes
        wGain.gain.setValueAtTime(0.0, now);
        wGain.gain.linearRampToValueAtTime(vol, now + 9.0);
        wGain.gain.setValueAtTime(vol, now + 17.0);
        wGain.gain.linearRampToValueAtTime(0.0, now + 26.0);
        wOsc.connect(wGain);
        wGain.connect(wPan);
        wPan.connect(engine.reverb);
        wOsc.start(now);
        wOsc.stop(now + 27.0);
      }
    }
  }

  // Lush fireflies — brief high-frequency sine chirps in organization/complexity.
  // Each chirp is a single firefly: a soft blink of sound, randomly panned, randomly pitched.
  if (biome === "lush" && phaseIndex >= 2 && phaseIndex <= 3) {
    const lastFirefly = engineLushFireflyTime.get(engine) ?? 0;
    const fireflyInterval = phaseIndex === 3 ? 0.7 : 1.1; // denser in complexity
    if (now - lastFirefly > fireflyInterval && Math.random() < 0.70) {
      engineLushFireflyTime.set(engine, now + Math.random() * 0.4); // stagger next check
      const fCtx = engine.ctx;
      // Two chirps slightly staggered — feels like a real insect
      for (const [delay, freqMult] of [[0, 1.0], [0.045, 1.12]] as [number, number][]) {
        const fOsc = fCtx.createOscillator();
        const fGain = fCtx.createGain();
        const fPan = fCtx.createStereoPanner();
        fOsc.type = "sine";
        fOsc.frequency.value = (2200 + Math.random() * 2000) * freqMult;
        fPan.pan.value = (Math.random() * 2 - 1) * 0.85;
        const fVol = (0.006 + Math.random() * 0.006) * profile.masterMult;
        fGain.gain.setValueAtTime(0.0001, now + delay);
        fGain.gain.linearRampToValueAtTime(fVol, now + delay + 0.008);
        fGain.gain.exponentialRampToValueAtTime(0.0001, now + delay + 0.055);
        fOsc.connect(fGain);
        fGain.connect(fPan);
        fPan.connect(engine.reverb);
        fOsc.start(now + delay);
        fOsc.stop(now + delay + 0.07);
      }
    }
  }

  // Tundra crystal pings — resonant metallic tones, like ice shifting under pressure.
  // Rare during organization, moderate in complexity. Long decay echoing into frozen air.
  if (biome === "tundra" && phaseIndex >= 2 && phaseIndex <= 3) {
    const lastCrystal = engineTundraCrystalTime.get(engine) ?? 0;
    const crystalInterval = phaseIndex === 3 ? 3.5 : 5.5;
    if (now - lastCrystal > crystalInterval && Math.random() < 0.80) {
      engineTundraCrystalTime.set(engine, now);
      const cCtx = engine.ctx;
      // Two detuned tones for a glassy, slightly-out-of-phase shimmer
      for (const [detune, panVal] of [[-8, -0.55], [8, 0.55]] as [number, number][]) {
        const cOsc = cCtx.createOscillator();
        const cFilter = cCtx.createBiquadFilter();
        const cGain = cCtx.createGain();
        const cPan = cCtx.createStereoPanner();
        cOsc.type = "sine";
        cOsc.frequency.value = 1400 + Math.random() * 1400;
        cOsc.detune.value = detune;
        cFilter.type = "bandpass";
        cFilter.frequency.value = cOsc.frequency.value;
        cFilter.Q.value = 18; // high Q = crystalline ring
        cPan.pan.value = panVal;
        const cVol = (0.008 + Math.random() * 0.006) * profile.masterMult;
        cGain.gain.setValueAtTime(0.0001, now);
        cGain.gain.linearRampToValueAtTime(cVol, now + 0.006);
        cGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.65);
        cOsc.connect(cFilter);
        cFilter.connect(cGain);
        cGain.connect(cPan);
        cPan.connect(engine.reverb);
        cOsc.start(now);
        cOsc.stop(now + 0.7);
      }
    }
  }

  // Lush final silence bloom — a warm major-7th chord burst as the last mote leaves.
  // Fires exactly once: when mote count first drops to 0 in the silence phase.
  const prevMoteCount = enginePrevMoteCount.get(engine) ?? motes.length;
  enginePrevMoteCount.set(engine, motes.length);
  if (biome === "lush" && phaseIndex === 5 && motes.length === 0 && prevMoteCount > 0) {
    const lastBloom = engineLushBloomTime.get(engine) ?? -999;
    if (now - lastBloom > 30.0) {
      engineLushBloomTime.set(engine, now);
      playLushFinalBloom(engine, profile);
    }
  }

  // Volcanic dissolution: sub-bass rumbles that grow more frequent as the world ends.
  // Interval shrinks from 8s → 2s as phaseProgress approaches 1.
  if (biome === "volcanic" && phaseIndex === 4) {
    const lastRumble = engineVolcanicRumbleTime.get(engine) ?? 0;
    const rumbleInterval = 8.0 - phaseProgress * 6.0;
    if (now - lastRumble > rumbleInterval) {
      engineVolcanicRumbleTime.set(engine, now);
      const rCtx = engine.ctx;
      const rOsc = rCtx.createOscillator();
      const rFilter = rCtx.createBiquadFilter();
      const rGain = rCtx.createGain();
      rOsc.type = "sawtooth";
      // Pitch creeps up slightly as dissolution deepens — pressure building
      const rPitch = 36 + phaseProgress * 14;
      rOsc.frequency.setValueAtTime(rPitch, now);
      rOsc.frequency.exponentialRampToValueAtTime(rPitch * 0.52, now + 1.5);
      rFilter.type = "lowpass";
      rFilter.frequency.value = 85 + phaseProgress * 45;
      const rVol = (0.018 + phaseProgress * 0.034) * profile.masterMult;
      rGain.gain.setValueAtTime(0.0, now);
      rGain.gain.linearRampToValueAtTime(rVol, now + 0.06);
      rGain.gain.exponentialRampToValueAtTime(0.001, now + 1.6);
      rOsc.connect(rFilter);
      rFilter.connect(rGain);
      rGain.connect(engine.compressor);
      rOsc.start(now);
      rOsc.stop(now + 1.7);
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

/** Two-note ascending chime on bond formation — voiced per biome */
export function playBondForm(
  engine: SoundEngine,
  yNorm: number,
  scale: number[],
  profile?: BiomeSoundProfile,
): void {
  const p = profile ?? BIOME_SOUND.temperate;
  const biome = engineCurrentBiome.get(engine) ?? "temperate";
  const ctx = engine.ctx;
  const now = ctx.currentTime;

  const idx = Math.floor(yNorm * scale.length) % scale.length;
  const freq1 = p.rootFreq * Math.pow(2, scale[idx] / 12) * 2;
  const freq2 = freq1 * Math.pow(2, 7 / 12); // perfect fifth above

  // Per-biome bond voice: wave type, decay length, and gain
  interface BondVoice { wave: OscillatorType; decay1: number; decay2: number; g1: number; g2: number; }
  const bondVoice: Record<string, BondVoice> = {
    temperate: { wave: "sine",     decay1: 0.55, decay2: 0.65, g1: 0.032, g2: 0.025 },
    desert:    { wave: "sine",     decay1: 2.60, decay2: 2.80, g1: 0.028, g2: 0.018 }, // long bell toll
    tundra:    { wave: "sine",     decay1: 1.10, decay2: 1.70, g1: 0.030, g2: 0.022 }, // glassy, sustaining
    volcanic:  { wave: "triangle", decay1: 0.22, decay2: 0.18, g1: 0.020, g2: 0.014 }, // short, dull thud
    lush:      { wave: "sine",     decay1: 0.75, decay2: 0.95, g1: 0.034, g2: 0.027 }, // warm & full
  };
  const bv = bondVoice[biome] ?? bondVoice.temperate;

  const osc1 = ctx.createOscillator();
  const gain1 = ctx.createGain();
  osc1.type = bv.wave;
  osc1.frequency.value = freq1;
  gain1.gain.setValueAtTime(0.001, now);
  gain1.gain.linearRampToValueAtTime(bv.g1, now + 0.02);
  gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.02 + bv.decay1);
  osc1.connect(gain1);
  gain1.connect(engine.reverb);
  osc1.start(now);
  osc1.stop(now + 0.02 + bv.decay1 + 0.05);

  const osc2 = ctx.createOscillator();
  const gain2 = ctx.createGain();
  osc2.type = bv.wave;
  osc2.frequency.value = freq2;
  gain2.gain.setValueAtTime(0.001, now + 0.065);
  gain2.gain.linearRampToValueAtTime(bv.g2, now + 0.085);
  gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.065 + bv.decay2);
  osc2.connect(gain2);
  gain2.connect(engine.reverb);
  osc2.start(now + 0.065);
  osc2.stop(now + 0.065 + bv.decay2 + 0.05);

  // Tundra: crystalline high partial — ice chime shimmer
  if (biome === "tundra") {
    const osc3 = ctx.createOscillator();
    const gain3 = ctx.createGain();
    osc3.type = "sine";
    osc3.frequency.value = freq1 * 3.0; // 3rd harmonic
    gain3.gain.setValueAtTime(0.001, now);
    gain3.gain.linearRampToValueAtTime(0.010, now + 0.01);
    gain3.gain.exponentialRampToValueAtTime(0.001, now + 0.85);
    osc3.connect(gain3);
    gain3.connect(engine.reverb);
    osc3.start(now);
    osc3.stop(now + 0.92);
  }

  // Lush: add the major third so the bond lands as a full warm triad
  if (biome === "lush") {
    const freq3 = freq1 * Math.pow(2, 4 / 12);
    const osc3 = ctx.createOscillator();
    const gain3 = ctx.createGain();
    osc3.type = "sine";
    osc3.frequency.value = freq3;
    gain3.gain.setValueAtTime(0.001, now + 0.12);
    gain3.gain.linearRampToValueAtTime(0.019, now + 0.14);
    gain3.gain.exponentialRampToValueAtTime(0.001, now + 0.14 + 0.70);
    osc3.connect(gain3);
    gain3.connect(engine.reverb);
    osc3.start(now + 0.12);
    osc3.stop(now + 0.12 + 0.76);
  }
}

/** Two tones falling apart on bond break — voiced per biome, mirror of playBondForm */
function playBondBreak(
  engine: SoundEngine,
  yNorm: number,
  scale: number[],
  profile: BiomeSoundProfile,
): void {
  const biome = engineCurrentBiome.get(engine) ?? "temperate";
  const ctx = engine.ctx;
  const now = ctx.currentTime;
  const idx = Math.floor(yNorm * scale.length) % scale.length;
  const freq = profile.rootFreq * Math.pow(2, scale[idx] / 12) * 2;

  switch (biome) {
    case "desert": {
      // Single long descending bell toll — a note that rang, then faded alone
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, now);
      osc.frequency.exponentialRampToValueAtTime(freq * Math.pow(2, -4 / 12), now + 3.5);
      gain.gain.setValueAtTime(0.018, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 3.8);
      osc.connect(gain);
      gain.connect(engine.reverb);
      osc.start(now);
      osc.stop(now + 4.0);
      // Faint 3rd harmonic shimmer fades quickly
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = "sine";
      osc2.frequency.value = freq * 3.0;
      gain2.gain.setValueAtTime(0.006, now);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.9);
      osc2.connect(gain2);
      gain2.connect(engine.reverb);
      osc2.start(now);
      osc2.stop(now + 1.0);
      // 5th harmonic: the overtone ringing alone in vast emptiness long after the bell is gone
      const osc3 = ctx.createOscillator();
      const gain3 = ctx.createGain();
      osc3.type = "sine";
      osc3.frequency.value = freq * 5.0;
      gain3.gain.setValueAtTime(0.001, now + 0.35);
      gain3.gain.linearRampToValueAtTime(0.003, now + 0.60);
      gain3.gain.exponentialRampToValueAtTime(0.001, now + 5.8);
      osc3.connect(gain3);
      gain3.connect(engine.reverb);
      osc3.start(now + 0.35);
      osc3.stop(now + 6.0);
      break;
    }

    case "tundra": {
      // Two crystalline tones slide apart in opposite directions — cracking ice
      const high = freq * 2.0;
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = "sine";
      osc1.frequency.setValueAtTime(high, now);
      osc1.frequency.exponentialRampToValueAtTime(high * Math.pow(2, 5 / 12), now + 0.8); // slides up
      gain1.gain.setValueAtTime(0.001, now);
      gain1.gain.linearRampToValueAtTime(0.018, now + 0.01);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 1.6);
      osc1.connect(gain1);
      gain1.connect(engine.reverb);
      osc1.start(now);
      osc1.stop(now + 1.7);

      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = "sine";
      osc2.frequency.setValueAtTime(high * Math.pow(2, 7 / 12), now);
      osc2.frequency.exponentialRampToValueAtTime(high * Math.pow(2, -2 / 12), now + 0.9); // slides down
      gain2.gain.setValueAtTime(0.001, now);
      gain2.gain.linearRampToValueAtTime(0.014, now + 0.01);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 1.2);
      osc2.connect(gain2);
      gain2.connect(engine.reverb);
      osc2.start(now);
      osc2.stop(now + 1.3);
      break;
    }

    case "volcanic": {
      // Sharp noise crack followed by a fast sub-bass drop — a bond shattering like cooling rock
      const bufLen = Math.floor(ctx.sampleRate * 0.08);
      const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < bufLen; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufLen * 0.15));
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const filt = ctx.createBiquadFilter();
      filt.type = "bandpass";
      filt.frequency.value = 900;
      filt.Q.value = 2.0;
      const gn = ctx.createGain();
      gn.gain.setValueAtTime(0.025, now);
      gn.gain.exponentialRampToValueAtTime(0.001, now + 0.20);
      src.connect(filt);
      filt.connect(gn);
      gn.connect(engine.compressor);
      src.start(now);
      // Sub drop: a pitch falling off a cliff
      const sub = ctx.createOscillator();
      const subGain = ctx.createGain();
      sub.type = "sine";
      sub.frequency.setValueAtTime(80, now + 0.02);
      sub.frequency.exponentialRampToValueAtTime(28, now + 0.38);
      subGain.gain.setValueAtTime(0.030, now + 0.02);
      subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.42);
      sub.connect(subGain);
      subGain.connect(engine.compressor);
      sub.start(now + 0.02);
      sub.stop(now + 0.45);
      break;
    }

    case "lush": {
      // Three voices that were in harmony drift apart — warm dissolution
      for (const [semi, delay, dur] of [[0, 0.0, 1.3], [4, 0.04, 1.0], [7, 0.02, 0.8]] as [number, number, number][]) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(freq * Math.pow(2, semi / 12), now + delay);
        osc.frequency.exponentialRampToValueAtTime(freq * Math.pow(2, (semi - 2) / 12), now + delay + dur);
        gain.gain.setValueAtTime(0.001, now + delay);
        gain.gain.linearRampToValueAtTime(0.016 - semi * 0.001, now + delay + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, now + delay + dur);
        osc.connect(gain);
        gain.connect(engine.reverb);
        osc.start(now + delay);
        osc.stop(now + delay + dur + 0.05);
      }
      break;
    }

    default: { // temperate — minor third downward glide, fifth drops below root
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
      break;
    }
  }
}

/**
 * Ancient bond break — played when a bond older than 70s severs.
 * Much slower and deeper than the regular bond break. Two voices that shared
 * a long journey, now separating into silence. Biome-voiced, long decay.
 */
function playAncientBondBreak(
  engine: SoundEngine,
  yNorm: number,
  profile: BiomeSoundProfile,
  biome: Biome,
): void {
  const ctx = engine.ctx;
  const now = ctx.currentTime;
  // Use a low octave — ancient bonds lived deep
  const baseFreq = profile.rootFreq * (1.0 + yNorm * 0.5);

  switch (biome) {
    case "desert": {
      // Two bell tones that were ringing in unison slowly drift a semitone apart,
      // then fall together into silence — a long parting in the vast open.
      const freq1 = baseFreq * 2;
      const freq2 = baseFreq * 2 * Math.pow(2, -1 / 12); // minor second below
      for (const [f, pan, vol] of [[freq1, -0.3, 0.022], [freq2, 0.3, 0.018]] as [number, number, number][]) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const panner = ctx.createStereoPanner();
        osc.type = "sine";
        osc.frequency.setValueAtTime(f, now);
        osc.frequency.exponentialRampToValueAtTime(f * Math.pow(2, -5 / 12), now + 5.0);
        panner.pan.value = pan;
        gain.gain.setValueAtTime(vol, now);
        gain.gain.setValueAtTime(vol * 0.9, now + 1.5);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 5.5);
        osc.connect(gain); gain.connect(panner); panner.connect(engine.reverb);
        osc.start(now); osc.stop(now + 6.0);
      }
      break;
    }

    case "tundra": {
      // Two crystalline tones that drifted together now slowly pull apart —
      // one rises, one falls, both fade into the frozen dark.
      const freq1 = baseFreq * 4;
      const osc1 = ctx.createOscillator(), gain1 = ctx.createGain();
      osc1.type = "sine";
      osc1.frequency.setValueAtTime(freq1, now);
      osc1.frequency.exponentialRampToValueAtTime(freq1 * Math.pow(2, 4 / 12), now + 4.5);
      gain1.gain.setValueAtTime(0.001, now);
      gain1.gain.linearRampToValueAtTime(0.018, now + 0.3);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 5.0);
      osc1.connect(gain1); gain1.connect(engine.reverb);
      osc1.start(now); osc1.stop(now + 5.5);

      const osc2 = ctx.createOscillator(), gain2 = ctx.createGain();
      osc2.type = "sine";
      osc2.frequency.setValueAtTime(freq1 * Math.pow(2, 7 / 12), now + 0.1);
      osc2.frequency.exponentialRampToValueAtTime(freq1 * Math.pow(2, -3 / 12), now + 4.5);
      gain2.gain.setValueAtTime(0.001, now + 0.1);
      gain2.gain.linearRampToValueAtTime(0.016, now + 0.35);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 4.8);
      osc2.connect(gain2); gain2.connect(engine.reverb);
      osc2.start(now + 0.1); osc2.stop(now + 5.0);
      break;
    }

    case "volcanic": {
      // A slow deep sine pulse — the earth groans once, long and low, as two forces part.
      // Subterranean, ominous, final.
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(baseFreq, now);
      osc.frequency.exponentialRampToValueAtTime(baseFreq * Math.pow(2, -4 / 12), now + 4.5);
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.030 * profile.masterMult, now + 0.8);
      gain.gain.setValueAtTime(0.030 * profile.masterMult, now + 2.0);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 5.0);
      osc.connect(gain); gain.connect(engine.reverb);
      osc.start(now); osc.stop(now + 5.5);
      // A faint second harmonic trails off faster
      const osc2 = ctx.createOscillator(), gain2 = ctx.createGain();
      osc2.type = "triangle";
      osc2.frequency.value = baseFreq * 2;
      gain2.gain.setValueAtTime(0.010, now);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 2.5);
      osc2.connect(gain2); gain2.connect(engine.reverb);
      osc2.start(now); osc2.stop(now + 3.0);
      break;
    }

    case "lush": {
      // A warm minor-seventh chord (root + m3 + m7) swells and slowly dissolves —
      // abundance fading into stillness, like sunlight leaving a clearing.
      for (const [semi, vol, pan] of [[0, 0.018, 0], [3, 0.014, -0.35], [10, 0.012, 0.35]] as [number, number, number][]) {
        const osc = ctx.createOscillator(), gain = ctx.createGain(), panner = ctx.createStereoPanner();
        osc.type = "sine";
        osc.frequency.value = baseFreq * 2 * Math.pow(2, semi / 12);
        panner.pan.value = pan;
        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(vol, now + 0.5);
        gain.gain.setValueAtTime(vol, now + 2.0);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 5.5);
        osc.connect(gain); gain.connect(panner); panner.connect(engine.reverb);
        osc.start(now); osc.stop(now + 6.0);
      }
      break;
    }

    default: { // temperate — two sine waves a perfect fifth apart slowly fall together,
      // like two voices that shared a melody, now going quiet
      const freq1 = baseFreq * 2;
      const freq2 = freq1 * Math.pow(2, 7 / 12); // fifth above
      for (const [f, vol, pan] of [[freq1, 0.020, -0.25], [freq2, 0.016, 0.25]] as [number, number, number][]) {
        const osc = ctx.createOscillator(), gain = ctx.createGain(), panner = ctx.createStereoPanner();
        osc.type = "sine";
        osc.frequency.setValueAtTime(f, now);
        osc.frequency.exponentialRampToValueAtTime(f * Math.pow(2, -3 / 12), now + 4.0);
        panner.pan.value = pan;
        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(vol, now + 0.4);
        gain.gain.setValueAtTime(vol, now + 1.5);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 4.5);
        osc.connect(gain); gain.connect(panner); panner.connect(engine.reverb);
        osc.start(now); osc.stop(now + 5.0);
      }
      break;
    }
  }
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
      // Thunder crack: sharp percussive bass that breaks the silence before the flood
      const thunderNoise = createNoiseSource(ctx, 0.7);
      const thunderFilter = ctx.createBiquadFilter();
      thunderFilter.type = "lowpass";
      thunderFilter.frequency.setValueAtTime(300, now);
      thunderFilter.frequency.exponentialRampToValueAtTime(60, now + 0.5);
      thunderFilter.Q.value = 0.8;
      const thunderGain = ctx.createGain();
      thunderGain.gain.setValueAtTime(0.0, now);
      thunderGain.gain.linearRampToValueAtTime(0.38, now + 0.04);
      thunderGain.gain.exponentialRampToValueAtTime(0.001, now + 0.65);
      thunderNoise.connect(thunderFilter);
      thunderFilter.connect(thunderGain);
      thunderGain.connect(engine.compressor);
      thunderNoise.start(now);
      thunderNoise.stop(now + 0.7);

      // Rising wash of filtered noise — water sweeping in after the crack
      const src = createNoiseSource(ctx, 2.5);
      const filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.setValueAtTime(2800, now + 0.35);
      filter.frequency.exponentialRampToValueAtTime(180, now + 2.5);
      filter.Q.value = 0.4;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0, now + 0.35);
      gain.gain.linearRampToValueAtTime(0.085, now + 0.75);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 2.5);
      src.connect(filter);
      filter.connect(gain);
      gain.connect(engine.compressor);
      src.start(now + 0.35);
      src.stop(now + 2.6);
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

/** Desert heat shimmer — two brief ultra-high harmonic pings, slight interval apart */
function playDesertShimmer(engine: SoundEngine, profile: BiomeSoundProfile, scale: number[]): void {
  const ctx = engine.ctx;
  const now = ctx.currentTime;
  const idx = Math.floor(Math.random() * scale.length);
  // Three octaves above the scale note — glittering in the heat
  const baseFreq = profile.rootFreq * Math.pow(2, scale[idx] / 12) * 8;

  for (let i = 0; i < 2; i++) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const panner = ctx.createStereoPanner();
    osc.type = "sine";
    osc.frequency.value = baseFreq * (i === 0 ? 1.0 : 1.125); // minor second interval
    panner.pan.value = (Math.random() * 2 - 1) * 0.75;
    const t = now + i * 0.038;
    gain.gain.setValueAtTime(0.001, t);
    gain.gain.linearRampToValueAtTime(0.007 + Math.random() * 0.005, t + 0.013);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.55 + Math.random() * 0.45);
    osc.connect(gain);
    gain.connect(panner);
    panner.connect(engine.reverb);
    osc.start(t);
    osc.stop(t + 1.1);
  }
}

/** Cluster milestone — special sound when a cluster first reaches size 4 (harmony) or 8 (chorus) */
function playClusterMilestone(engine: SoundEngine, scale: number[], profile: BiomeSoundProfile, size: number): void {
  const ctx = engine.ctx;
  const now = ctx.currentTime;

  if (size >= 8) {
    // Full chorus awakening — staggered maj7 chord spread wide across stereo
    const semitones = [0, 4, 7, 11, 14];
    semitones.forEach((semi, i) => {
      const freq = profile.rootFreq * Math.pow(2, semi / 12) * 2;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const panner = ctx.createStereoPanner();
      osc.type = profile.waveLarge;
      osc.frequency.value = freq;
      panner.pan.value = (i / (semitones.length - 1) * 2 - 1) * 0.88;
      const t = now + i * 0.058;
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(0.024, t + 0.07);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 2.8);
      osc.connect(gain);
      gain.connect(panner);
      panner.connect(engine.reverb);
      osc.start(t);
      osc.stop(t + 2.9);
    });
  } else {
    // Small cluster finding first harmony — two voices, a gentle major third arriving together
    const freq1 = profile.rootFreq * Math.pow(2, scale[0] / 12) * 2;
    const freq2 = freq1 * Math.pow(2, 4 / 12); // major third
    for (const [freq, delay] of [[freq1, 0.0], [freq2, 0.07]] as [number, number][]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = profile.waveSmall;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.001, now + delay);
      gain.gain.linearRampToValueAtTime(0.016, now + delay + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, now + delay + 1.25);
      osc.connect(gain);
      gain.connect(engine.reverb);
      osc.start(now + delay);
      osc.stop(now + delay + 1.35);
    }
  }
}

/** Cluster merge sound — two communities finding each other's resonance */
function playClusterMerge(
  engine: SoundEngine,
  profile: BiomeSoundProfile,
  biome: Biome,
): void {
  const ctx = engine.ctx;
  const now = ctx.currentTime;
  const rootFreq = profile.rootFreq * 2; // upper register — bright, spatial

  // Per-biome intervals and character: the emotional flavour of two groups becoming one
  interface MergeVoice {
    semitones: number[];
    wave: OscillatorType;
    spacing: number;
    decay: number;
    vol: number;
  }
  const mergeVoice: Record<Biome, MergeVoice> = {
    temperate: { semitones: [0, 4, 7],     wave: "sine",     spacing: 0.055, decay: 1.8, vol: 0.020 },
    desert:    { semitones: [0, 5, 9],     wave: "sine",     spacing: 0.090, decay: 3.2, vol: 0.015 }, // suspended — cautious union
    tundra:    { semitones: [0, 3, 7],     wave: "sine",     spacing: 0.075, decay: 2.4, vol: 0.013 }, // minor — cold solidarity
    volcanic:  { semitones: [0, 3, 6],     wave: "triangle", spacing: 0.038, decay: 0.9, vol: 0.017 }, // diminished — tense merger
    lush:      { semitones: [0, 4, 7, 11], wave: "sine",     spacing: 0.045, decay: 2.2, vol: 0.021 }, // maj7 — rich, full
  };
  const mv = mergeVoice[biome];

  for (let i = 0; i < mv.semitones.length; i++) {
    const freq = rootFreq * Math.pow(2, mv.semitones[i] / 12);
    const t = now + i * mv.spacing;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const panner = ctx.createStereoPanner();
    osc.type = mv.wave;
    osc.frequency.value = freq;
    panner.pan.value = ((i / Math.max(mv.semitones.length - 1, 1)) * 2 - 1) * profile.panStrength * 0.65;
    gain.gain.setValueAtTime(0.001, t);
    gain.gain.linearRampToValueAtTime(mv.vol, t + 0.06);
    gain.gain.exponentialRampToValueAtTime(0.001, t + mv.decay);
    osc.connect(gain);
    gain.connect(panner);
    panner.connect(engine.reverb);
    osc.start(t);
    osc.stop(t + mv.decay + 0.1);
  }
}

/** Communal mourning chord — when motes grieve together, a shared low tone */
function playMourningChorus(
  engine: SoundEngine,
  profile: BiomeSoundProfile,
  biome: Biome,
): void {
  const ctx = engine.ctx;
  const now = ctx.currentTime;
  const baseFreq = profile.rootFreq; // low register — weight and gravity of collective loss

  // Minor triad (or biome variant) — collective sorrow voiced differently by each world
  const semitoneSets: Record<Biome, number[]> = {
    temperate: [0, 3, 7],      // natural minor triad
    desert:    [0, 3, 7],      // minor triad — hollowed-out grief
    tundra:    [0, 2, 7],      // open fifth + 2nd — suspended, unresolved cold
    volcanic:  [0, 3, 6],      // diminished — raw anguish
    lush:      [0, 3, 7, 10],  // minor 7th — warm, bittersweet
  };
  const semitones = semitoneSets[biome];

  for (let i = 0; i < semitones.length; i++) {
    const freq = baseFreq * Math.pow(2, semitones[i] / 12);
    const t = now + i * 0.05;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    // Very quiet, very long — grief that lingers, doesn't announce itself
    gain.gain.setValueAtTime(0.001, t);
    gain.gain.linearRampToValueAtTime(0.007, t + 0.15);
    gain.gain.setValueAtTime(0.007, t + 0.55);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 3.8);
    osc.connect(gain);
    gain.connect(engine.reverb);
    osc.start(t);
    osc.stop(t + 4.0);
  }
}

/** Lush final silence bloom — a warm major-7th chord burst as the last mote disappears */
function playLushFinalBloom(engine: SoundEngine, profile: BiomeSoundProfile): void {
  const ctx = engine.ctx;
  const now = ctx.currentTime;
  const rootFreq = profile.rootFreq;
  // Full spread: root through two octaves — the world's last exhalation of warmth
  const semitones = [0, 4, 7, 12, 16, 19]; // root, M3, P5, octave, M3', P5'

  for (let i = 0; i < semitones.length; i++) {
    const freq = rootFreq * Math.pow(2, semitones[i] / 12);
    const t = now + i * 0.07;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const panner = ctx.createStereoPanner();
    osc.type = "sine";
    osc.frequency.value = freq;
    panner.pan.value = ((i / (semitones.length - 1)) * 2 - 1) * 0.75;
    const vol = Math.max(0.006, 0.028 - i * 0.003);
    gain.gain.setValueAtTime(0.001, t);
    gain.gain.linearRampToValueAtTime(vol, t + 0.10);
    gain.gain.setValueAtTime(vol, t + 0.45);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 5.5);
    osc.connect(gain);
    gain.connect(panner);
    panner.connect(engine.reverb);
    osc.start(t);
    osc.stop(t + 5.7);
  }
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

  // Per-biome waveform selection for phase transitions:
  // volcanic gets harsh sawtooth at dissolution/silence; tundra/desert stay pure sine;
  // lush gets triangle at complexity/organization for warmth; temperate always sine.
  const transitionWave = (phase: number): OscillatorType => {
    if (biome === "volcanic") return phase >= 4 ? "sawtooth" : "triangle";
    if (biome === "lush")     return phase >= 2 ? "triangle" : "sine";
    return "sine";
  };

  const note = (semitones: number, octaveMult: number, delay: number, duration: number, maxGain: number, wave?: OscillatorType) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = wave ?? transitionWave(phaseIndex);
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

    case 1: // exploration — ascending major arpeggio (tundra: slow detuned ice sweep)
      if (biome === "tundra") {
        // Two sines spread across stereo, detuned ±14 cents apart, slowly converging —
        // cold air finding a harmonic center, colder and less resolved than a crisp arpeggio
        for (const [detune, pan] of [[-14, -0.78], [14, 0.78]] as [number, number][]) {
          const sweepOsc = ctx.createOscillator();
          const sweepGain = ctx.createGain();
          const sweepPan = ctx.createStereoPanner();
          sweepOsc.type = "sine";
          sweepOsc.frequency.value = p.rootFreq * 2;
          sweepOsc.detune.value = detune;
          // Slowly converge toward zero — two voices seeking unison but never quite arriving
          sweepOsc.detune.linearRampToValueAtTime(detune * 0.15, now + 6.0);
          sweepPan.pan.value = pan;
          sweepGain.gain.setValueAtTime(0.001, now);
          sweepGain.gain.linearRampToValueAtTime(0.014, now + 2.2);
          sweepGain.gain.setValueAtTime(0.014, now + 3.8);
          sweepGain.gain.exponentialRampToValueAtTime(0.001, now + 6.5);
          sweepOsc.connect(sweepGain);
          sweepGain.connect(sweepPan);
          sweepPan.connect(engine.reverb);
          sweepOsc.start(now);
          sweepOsc.stop(now + 6.7);
        }
      } else {
        note(0,  2, 0.00, 1.1, 0.019);
        note(4,  2, 0.09, 1.0, 0.017);
        note(7,  2, 0.18, 1.0, 0.016);
        note(12, 2, 0.27, 1.3, 0.021);
      }
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

/**
 * Cascade arrival — rising arpeggio when a cluster first reaches 8+ members.
 * The visual triple ring expands outward; the audio ascends in parallel —
 * 6 notes climbing the biome scale at 160ms intervals, then a full chord sustains.
 * Biome-voiced timbre. Cooldown prevents rapid-fire on simultaneous cascades.
 */
export function playCascadeArrival(engine: SoundEngine, biome: Biome): void {
  if (!engine.initialized) return;
  const ctx = engine.ctx;
  const now = ctx.currentTime;

  // Per-engine cooldown — at most one cascade sound every 4 seconds
  const lastCascade = engineCascadeArrivalTime.get(engine) ?? -999;
  if (now - lastCascade < 4.0) return;
  engineCascadeArrivalTime.set(engine, now);

  const profile = BIOME_SOUND[biome];
  // Use the complexity-phase scale — richest voicing, peak of life
  const scale = BIOME_PHASE_SCALES[biome][3];

  const spacing = 0.155; // seconds between ascending notes
  const noteCount = 6;

  // Ascending arpeggio: picks evenly-spaced scale degrees, low to high, mid register
  for (let i = 0; i < noteCount; i++) {
    const scaleIdx = Math.floor((i / noteCount) * scale.length);
    const semi = scale[Math.min(scaleIdx, scale.length - 1)];
    const freq = profile.rootFreq * Math.pow(2, semi / 12) * 2; // one octave up
    const t = now + i * spacing;

    // Each note slightly louder/brighter — crescendo toward the chord
    const vol = (0.016 + i * 0.003) * profile.masterMult;
    const decay = i < noteCount - 1 ? 0.50 : 2.4;
    const wave: OscillatorType = i < noteCount - 1 ? profile.waveSmall : profile.waveLarge;
    // Pan spreads left to right as the arpeggio rises
    const pan = ((i / (noteCount - 1)) * 2 - 1) * profile.panStrength * 0.65;

    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();
    const panner = ctx.createStereoPanner();
    osc.type = wave;
    osc.frequency.value = freq;
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    gainNode.gain.setValueAtTime(0.001, t);
    gainNode.gain.linearRampToValueAtTime(vol, t + 0.022);
    gainNode.gain.setValueAtTime(vol, t + 0.022 + 0.015);
    gainNode.gain.exponentialRampToValueAtTime(0.001, t + 0.022 + decay);
    osc.connect(gainNode);
    gainNode.connect(panner);
    panner.connect(engine.reverb);
    osc.start(t);
    osc.stop(t + 0.022 + decay + 0.1);
  }

  // Final chord: root + perfect fifth + octave, arrives as last arpeggio note sounds
  const chordStart = now + (noteCount - 1) * spacing + 0.08;
  const chordSemitones = [0, 7, 12];
  for (let j = 0; j < chordSemitones.length; j++) {
    const freq = profile.rootFreq * Math.pow(2, chordSemitones[j] / 12) * 2;
    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();
    const panner = ctx.createStereoPanner();
    osc.type = profile.waveLarge;
    osc.frequency.value = freq;
    panner.pan.value = (j - 1) * profile.panStrength * 0.45;
    const chordVol = (0.020 - j * 0.003) * profile.masterMult;
    gainNode.gain.setValueAtTime(0.001, chordStart);
    gainNode.gain.linearRampToValueAtTime(chordVol, chordStart + 0.10);
    gainNode.gain.setValueAtTime(chordVol, chordStart + 1.0);
    gainNode.gain.exponentialRampToValueAtTime(0.001, chordStart + 2.6);
    osc.connect(gainNode);
    gainNode.connect(panner);
    panner.connect(engine.reverb);
    osc.start(chordStart);
    osc.stop(chordStart + 2.8);
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
