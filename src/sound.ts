// sound.ts — Generative audio engine. The world's voice.
// Five biomes, five sonic identities. Phase shapes the arc. Stereo space = living positions.

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
  lfoFreq: number;           // LFO speed (Hz) — breathing rate of the biome
  lfoDepth: number;          // LFO filter modulation depth (Hz)
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
    lfoFreq: 0.12,      // Slow, organic breathing
    lfoDepth: 80,
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
    lfoFreq: 0.05,      // Very slow: shimmering stillness
    lfoDepth: 120,
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
    lfoFreq: 0.07,      // Slow: distant wind
    lfoDepth: 60,
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
    lfoFreq: 0.28,      // Faster: unstable, rumbling
    lfoDepth: 40,
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
    lfoFreq: 0.18,      // Gentle, alive
    lfoDepth: 100,
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
    [0, 3, 7, 10, 14],                        // genesis: minor pentatonic — tentative
    [0, 2, 4, 7, 9, 12, 14],                  // exploration: major pentatonic — cheerful
    [0, 2, 4, 5, 7, 9, 11, 12],               // organization: ionian — resolved, warm
    [0, 2, 4, 5, 7, 9, 11, 12, 14, 16],       // complexity: major extended
    [0, 3, 5, 7, 10, 12],                     // dissolution: minor penta + octave
    [0, 7, 12],                               // silence: root + fifth + octave
  ],
  desert: [
    [0, 2, 4, 7, 9],                          // genesis: major penta — sparse, open
    [0, 2, 5, 7, 10, 12],                     // exploration: suspended — heat shimmer
    [0, 2, 4, 6, 7, 9, 11],                   // organization: lydian — shimmering raised fourth
    [0, 2, 4, 6, 7, 9, 11, 12, 14, 16],       // complexity: lydian extended
    [0, 2, 7, 9, 12],                         // dissolution: open fifths emptying
    [0, 7],                                   // silence: bare fifth
  ],
  tundra: [
    [0, 2, 3, 7, 10],                         // genesis: dorian penta — cold
    [0, 2, 3, 5, 7, 9, 10, 12],               // exploration: dorian — dark but alive
    [0, 2, 3, 5, 7, 8, 10, 12],               // organization: natural minor — colder
    [0, 1, 3, 5, 7, 8, 10, 12, 13, 15],       // complexity: phrygian — ancient, cold
    [0, 3, 7, 10],                            // dissolution: minor penta
    [0, 3, 7],                                // silence: minor triad
  ],
  volcanic: [
    [0, 1, 6, 7],                             // genesis: semitone + tritone — threatening
    [0, 1, 3, 6, 7, 10],                      // exploration: diminished 7th arpeggio
    [0, 1, 4, 5, 7, 8, 10],                   // organization: phrygian dominant
    [0, 1, 3, 4, 6, 7, 9, 10, 12],            // complexity: octatonic — unstable
    [0, 3, 6, 9, 12],                         // dissolution: diminished arp
    [0, 6],                                   // silence: tritone alone
  ],
  lush: [
    [0, 2, 4, 7, 9],                          // genesis: major penta — warm arrival
    [0, 2, 4, 7, 9, 12, 14],                  // exploration: major penta wide
    [0, 2, 4, 5, 7, 9, 11, 12],               // organization: ionian — rich, full
    [0, 2, 4, 5, 7, 9, 11, 12, 14, 16, 17, 19], // complexity: two lush octaves
    [0, 2, 4, 7, 9, 12],                      // dissolution: warmth fading
    [0, 4, 7],                                // silence: major triad — gentle rest
  ],
};

const MAX_VOICES = 8;

// ---- Biome Ambient Texture Beds ----
// Each biome has a continuous low-level background: a root drone + filtered noise.
// These run the entire session and give each world its resting acoustic identity.

interface AmbientBed {
  droneOsc: OscillatorNode | null;
  droneGain: GainNode | null;
  textureSource: AudioBufferSourceNode;
  textureFilter: BiquadFilterNode;
  textureGain: GainNode;
}

interface BiomeAmbientConfig {
  droneFreq: number;        // 0 = no drone
  droneTargetGain: number;
  droneWave: OscillatorType;
  noiseFilterType: BiquadFilterType;
  noiseFreq: number;
  noiseQ: number;
  noiseTargetGain: number;
}

const BIOME_AMBIENT: Record<Biome, BiomeAmbientConfig> = {
  temperate: {
    droneFreq: 130.81, droneTargetGain: 0.006, droneWave: "sine",
    noiseFilterType: "bandpass", noiseFreq: 900, noiseQ: 1.5, noiseTargetGain: 0.004,
  },
  desert: {
    droneFreq: 0, droneTargetGain: 0, droneWave: "sine",
    noiseFilterType: "highpass", noiseFreq: 3000, noiseQ: 0.8, noiseTargetGain: 0.004,
  },
  tundra: {
    droneFreq: 0, droneTargetGain: 0, droneWave: "sine",
    noiseFilterType: "highpass", noiseFreq: 2400, noiseQ: 1.5, noiseTargetGain: 0.006,
  },
  volcanic: {
    droneFreq: 41.2, droneTargetGain: 0.008, droneWave: "sawtooth",
    noiseFilterType: "lowpass", noiseFreq: 70, noiseQ: 2.5, noiseTargetGain: 0.014,
  },
  lush: {
    droneFreq: 98, droneTargetGain: 0.005, droneWave: "sine",
    noiseFilterType: "bandpass", noiseFreq: 2200, noiseQ: 1.2, noiseTargetGain: 0.005,
  },
};

function createAmbientBed(ctx: AudioContext, biome: Biome, destination: AudioNode): AmbientBed {
  const cfg = BIOME_AMBIENT[biome];
  const now = ctx.currentTime;

  // Looping noise texture filtered for biome character
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

  // Optional root drone oscillator
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

  return { droneOsc, droneGain, textureSource, textureFilter, textureGain };
}

function stopAmbientBed(bed: AmbientBed, now: number): void {
  const fadeTime = 2.5;
  bed.textureGain.gain.linearRampToValueAtTime(0, now + fadeTime);
  if (bed.droneGain) bed.droneGain.gain.linearRampToValueAtTime(0, now + fadeTime);
  try { bed.textureSource.stop(now + fadeTime + 0.1); } catch (_) { /* already stopped */ }
  if (bed.droneOsc) { try { bed.droneOsc.stop(now + fadeTime + 0.1); } catch (_) { /* already stopped */ } }
}

// ---- Module-level engine augmentation ----
// Extra audio nodes stored in WeakMaps keyed on the engine,
// without needing to modify the SoundEngine interface in types.ts.

const enginePanners = new WeakMap<SoundEngine, StereoPannerNode[]>();
const engineLFO = new WeakMap<SoundEngine, OscillatorNode>();
const engineLFOGain = new WeakMap<SoundEngine, GainNode>();
const engineCurrentBiome = new WeakMap<SoundEngine, Biome | null>();
const engineAmbientBed = new WeakMap<SoundEngine, AmbientBed>();
const engineSpawnCooldown = new WeakMap<SoundEngine, number>();

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
  engine.masterGain.gain.value = 0.12;

  // Initial reverb — temperate profile, rebuilt on first biome-aware updateSound
  engine.reverb = createReverb(ctx, 1.8);

  engine.compressor.connect(engine.masterGain);
  engine.compressor.connect(engine.reverb);
  engine.reverb.connect(engine.masterGain);
  engine.masterGain.connect(ctx.destination);

  // Shared LFO for organic filter modulation across all voices
  const lfo = ctx.createOscillator();
  const lfoGain = ctx.createGain();
  lfo.type = "sine";
  lfo.frequency.value = 0.12; // Default temperate speed; updated per biome
  lfoGain.gain.value = 80;    // Modulates filter freq by ±80Hz
  lfo.connect(lfoGain);
  lfo.start();
  engineLFO.set(engine, lfo);
  engineLFOGain.set(engine, lfoGain);

  const panners: StereoPannerNode[] = [];
  for (let i = 0; i < MAX_VOICES; i++) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    const panner = ctx.createStereoPanner();

    osc.type = "sine";
    osc.frequency.value = 220;
    filter.type = "lowpass";
    filter.frequency.value = 800;
    filter.Q.value = 1.0;
    gain.gain.value = 0;
    panner.pan.value = 0;

    // LFO → filter frequency (additive modulation atop base value)
    lfoGain.connect(filter.frequency);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(panner);
    panner.connect(engine.compressor);
    osc.start();

    engine.voices.push({
      osc, gain, filter,
      active: false, targetFreq: 220, targetGain: 0, targetFilterFreq: 800,
    });
    panners.push(panner);
  }

  enginePanners.set(engine, panners);
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
  const panners = enginePanners.get(engine);

  // Rebuild reverb and retune LFO when biome changes
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

    // Update LFO character for new biome
    const lfo = engineLFO.get(engine);
    const lfoGain = engineLFOGain.get(engine);
    if (lfo) lfo.frequency.linearRampToValueAtTime(profile.lfoFreq, now + 3);
    if (lfoGain) lfoGain.gain.linearRampToValueAtTime(profile.lfoDepth, now + 3);

    // Update filter Q for biome character
    for (const voice of engine.voices) {
      voice.filter.Q.linearRampToValueAtTime(profile.filterQ, now + 2);
    }

    // Swap ambient texture bed to match new biome
    const oldBed = engineAmbientBed.get(engine);
    if (oldBed) stopAmbientBed(oldBed, now);
    engineAmbientBed.set(engine, createAmbientBed(engine.ctx, biome, engine.masterGain));

    engineCurrentBiome.set(engine, biome);
  }

  // Phase volume arc — quiet genesis, peak complexity, fade to silence
  const phaseVols = [0.05, 0.09, 0.13, 0.16, 0.07, 0.014];
  const next = (phaseIndex + 1) % 6;
  const targetVol = (phaseVols[phaseIndex] * (1 - phaseProgress) + phaseVols[next] * phaseProgress) * profile.masterMult;
  engine.masterGain.gain.linearRampToValueAtTime(targetVol, now + 0.5);

  // Clusters → voices
  const clusters = findClusters(motes);
  clusters.sort((a, b) => b.length - a.length);
  const active = clusters.slice(0, MAX_VOICES);

  for (let i = 0; i < MAX_VOICES; i++) {
    const voice = engine.voices[i];
    const panner = panners?.[i];

    if (i < active.length) {
      const cluster = active[i];
      let cx = 0, cy = 0, totalEnergy = 0;
      for (const m of cluster) { cx += m.x; cy += m.y; totalEnergy += m.energy; }
      cx /= cluster.length;
      cy /= cluster.length;
      totalEnergy /= cluster.length;

      // Y position → scale degree → frequency (with biome root)
      // Offset each voice by its index so concurrent voices form chords, not unisons
      const yNorm = 1 - cy / H;
      const baseIdx = Math.floor(yNorm * scale.length) % scale.length;
      const idx = (baseIdx + i) % scale.length;
      voice.targetFreq = profile.rootFreq * Math.pow(2, scale[idx] / 12);

      // Gain: log-scaled cluster size, energy-weighted
      voice.targetGain = Math.log2(cluster.length + 1) / Math.log2(MAX_VOICES + 1) * totalEnergy * 0.35;

      // Filter: biome-tuned base + energy modulation (LFO adds on top)
      voice.targetFilterFreq = profile.filterBase + totalEnergy * profile.filterMod;

      // Waveform by cluster size — biome defines the timbral character
      const sz = cluster.length;
      const waveTarget = sz < 4 ? profile.waveSmall : sz < 8 ? profile.waveMed : profile.waveLarge;
      // Change waveform only when voice is quiet to avoid clicks
      if (voice.osc.type !== waveTarget && voice.targetGain < 0.04) {
        voice.osc.type = waveTarget;
      }

      // Stereo panning from X position
      if (panner) {
        const pan = ((cx / W) * 2 - 1) * profile.panStrength;
        panner.pan.linearRampToValueAtTime(pan, now + 0.5);
      }

      // X-detune for subtle spatial width within the stereo field
      voice.osc.detune.linearRampToValueAtTime((cx / W - 0.5) * profile.detuneRange, now + 0.2);
      voice.active = true;
    } else {
      voice.targetGain = 0;
      voice.active = false;
      if (panner) panner.pan.linearRampToValueAtTime(0, now + 1.5);
    }

    voice.osc.frequency.linearRampToValueAtTime(voice.targetFreq, now + 0.5);
    voice.gain.gain.linearRampToValueAtTime(voice.targetGain, now + (voice.active ? 0.4 : 2.0));
    voice.filter.frequency.linearRampToValueAtTime(voice.targetFilterFreq, now + 0.3);
  }

  // Lone mote pings — sparse presence, using ctx time for sparse timing
  const loners = motes.filter((m) => m.bonds.length === 0);
  if (loners.length > 0) {
    // ~once per 8 seconds, using audio clock for timing
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
      break; // max 1 bond sound per update
    }
  }

  // Spawn sounds — gentle arrival ping for freshly born motes
  // spawnFlash starts at 1.0 and decays at 3/sec; we catch motes within their first ~80ms
  const spawnCooldown = engineSpawnCooldown.get(engine) ?? 0;
  if (now - spawnCooldown > 0.18) {
    const freshMote = motes.find((m) => m.spawnFlash > 0.75);
    if (freshMote) {
      playSpawnPing(engine, freshMote.x / W, 1 - freshMote.y / H, scale, profile);
      engineSpawnCooldown.set(engine, now);
    }
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
  osc.frequency.value = profile.rootFreq * Math.pow(2, scale[idx] / 12) * 2; // Octave up: bright, clear

  panner.pan.value = (xNorm * 2 - 1) * profile.panStrength * 0.6; // Gentler pan than cluster voices

  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.013, now + 0.012); // Quick attack — a knock on existence
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.38);

  osc.connect(gain);
  gain.connect(panner);
  panner.connect(engine.reverb); // Reverberant — the world acknowledges arrival
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
  const freq1 = p.rootFreq * Math.pow(2, scale[idx] / 12) * 2; // Up an octave for chime clarity

  // Second note: a perfect fifth above (7 semitones) — always consonant
  const freq2 = freq1 * Math.pow(2, 7 / 12);

  // First note — the arrival
  const osc1 = ctx.createOscillator();
  const gain1 = ctx.createGain();
  osc1.type = "sine";
  osc1.frequency.value = freq1;
  gain1.gain.setValueAtTime(0.001, now);
  gain1.gain.linearRampToValueAtTime(0.032, now + 0.02);
  gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
  osc1.connect(gain1);
  gain1.connect(engine.reverb); // Bond chimes are reverberant — spatial, ethereal
  osc1.start(now);
  osc1.stop(now + 0.6);

  // Second note — the harmony, 65ms later
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

/** Descending glide on mote death — loss made audible, biome-tuned */
export function playDeath(engine: SoundEngine, yNorm: number): void {
  // Look up current biome from WeakMap — main.ts doesn't need to change
  const biome = engineCurrentBiome.get(engine) ?? "temperate";
  const p = BIOME_SOUND[biome];
  const ctx = engine.ctx;
  const now = ctx.currentTime;

  // Start near the mote's pitch, descend roughly a tritone — loss is always falling
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
  gain.connect(engine.reverb); // Deaths resonate — the world remembers
  osc.start(now);
  osc.stop(now + 1.1);
}

/** Different sound per event type */
export function playEventSound(engine: SoundEngine, eventType: string): void {
  const ctx = engine.ctx;
  const now = ctx.currentTime;

  switch (eventType) {
    case "meteor": {
      // High noise burst sweeping down to bass impact — the whole arc of impact
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
      // Rising wash of filtered noise — the world filling up
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
        osc.detune.value = (i - 2.5) * 6; // Gentle spread
        panner.pan.value = (i / (ratios.length - 1)) * 2 - 1; // Full stereo spread
        const vol = 0.038 / (i * 0.6 + 1); // Harmonics fade with height
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

      // Bass drone — the darkness arriving
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

      // 7th harmonic — eerie overtone, not quite in tune with anything
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

  // Stereo pan from X position
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

/** Update ambient weather sounds — continuous rain, wind, thunder */
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
      filter.frequency.value = weather.type === "storm" ? 800 : 2500;
      filter.Q.value = 0.5;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, now);
      const targetVol = weather.type === "storm"
        ? 0.04 + weather.intensity * 0.06
        : 0.02 + weather.intensity * 0.04;
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
      filter.frequency.value = 300;
      filter.Q.value = 0.3;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, now);
      const targetVol = weather.type === "storm"
        ? 0.03 + weather.intensity * 0.04
        : 0.01 + weather.intensity * 0.02;
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
    const sweep = Math.sin(now * 0.2) * 500 + (weather.type === "storm" ? 1200 : 2500);
    amb.rainFilter.frequency.linearRampToValueAtTime(sweep, now + 0.1);
  }

  if (amb.windGain && needsWind) {
    const gust = Math.sin(now * 0.4) * 0.01 + (weather.type === "storm" ? 0.05 : 0.02);
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
 * Six phases, six characters: awakening, discovery, harmony, peak, loss, silence.
 */
export function playPhaseTransition(engine: SoundEngine, phaseIndex: number, biome: Biome = "temperate"): void {
  if (!engine.initialized) return;
  const p = BIOME_SOUND[biome];
  const ctx = engine.ctx;
  const now = ctx.currentTime;

  // Helper: schedule a single sine note through reverb
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
    case 0: // genesis — a slow-dawning fifth: root and fifth fade in together, tentative
      note(0,  1, 0.0, 4.2, 0.016);
      note(7,  1, 0.4, 3.8, 0.012);
      break;

    case 1: // exploration — ascending major arpeggio, two octaves, curious and alive
      note(0,  2, 0.00, 1.1, 0.019);
      note(4,  2, 0.09, 1.0, 0.017);
      note(7,  2, 0.18, 1.0, 0.016);
      note(12, 2, 0.27, 1.3, 0.021);
      break;

    case 2: // organization — warm major triad landing softly in unison
      note(0, 1, 0.00, 2.8, 0.023);
      note(4, 1, 0.05, 2.7, 0.021);
      note(7, 1, 0.10, 2.7, 0.020);
      break;

    case 3: // complexity — full major 7th chord, the peak of life
      note(0,  1, 0.00, 3.0, 0.025);
      note(4,  1, 0.00, 3.0, 0.023);
      note(7,  1, 0.00, 3.0, 0.023);
      note(11, 1, 0.06, 2.6, 0.019);
      note(0,  2, 0.12, 2.3, 0.017);
      break;

    case 4: // dissolution — minor triad then a drop: the world begins to let go
      note(0,  2, 0.00, 1.3, 0.019);
      note(3,  2, 0.00, 1.3, 0.017);
      note(7,  2, 0.00, 1.3, 0.017);
      note(0,  1, 0.35, 3.8, 0.021); // drops an octave — weight and loss
      break;

    case 5: // silence — a single root tone one octave below, fading into nothing
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
  filter.frequency.value = 120;
  const gain = ctx.createGain();
  const vol = 0.06 + intensity * 0.06;
  gain.gain.setValueAtTime(0.001, now);
  gain.gain.linearRampToValueAtTime(vol, now + 0.05);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 1.4);
  src.connect(filter);
  filter.connect(gain);
  gain.connect(engine.compressor);
  src.start(now);
  src.stop(now + 1.5);
}
