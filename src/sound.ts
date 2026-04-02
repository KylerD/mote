// sound.ts — Generative audio engine. Note-trigger architecture with biome-aware sonic identity.
// Five biomes, five voices. Clusters trigger discrete envelope-driven notes. Motes chirp individually.

import type { Mote, SoundEngine, Biome } from "./types";
import { findClusters } from "./physics";
import { W, H } from "./config";
import {
  BIOME_SOUND, BIOME_PHASE_SCALES, PHASE_AUDIO, PHASE_AMBIENT_MULT,
  type BiomeSoundProfile,
} from "./sound-config";
import { getState, type AmbientBed } from "./sound-state";
import {
  playBondForm, playBondBreak, playAncientBondBreak,
  playClusterMilestone, playClusterMerge, playMourningChorus, playLushFinalBloom,
} from "./sound-lifecycle";

// Re-export for backward compatibility
export type { SoundEngine };

const MAX_VOICES = 8;

// ---- Biome Ambient Texture Beds ----

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

  const st0 = getState(engine);
  st0.currentBiome = null;

  // Start ambient bed at temperate default; swapped on first biome-aware updateSound
  st0.ambientBed = createAmbientBed(ctx, "temperate", engine.masterGain);

  engine.initialized = true;
}

export function createReverb(ctx: AudioContext, seconds: number): ConvolverNode {
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
export function triggerNote(
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

  const st = getState(engine);

  // Rebuild reverb and swap ambient bed when biome changes
  if (st.currentBiome !== biome) {
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
    if (st.ambientBed) stopAmbientBed(st.ambientBed, now);
    st.ambientBed = createAmbientBed(engine.ctx, biome, engine.masterGain);

    st.currentBiome = biome;
  }

  // Phase-reactive ambient bed — drives the full sonic arc (quiet genesis → full complexity → silent silence)
  const ambBed = st.ambientBed;
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
  // Phase-capped voices: genesis gets 1, silence gets 0, complexity gets all 8
  const active = clusters.slice(0, Math.min(pa.maxVoices, MAX_VOICES));

  // Mote-count-aware mixing: gently reduce gain as population peaks to prevent saturation
  const densityScale = Math.max(0.55, 1.1 - motes.length * 0.009);

  // Phase-based reverb routing: dissolution & silence send notes through reverb → ghostly distance
  // Starts crossfading in mid-dissolution, fully wet in silence
  const reverbProb = phaseIndex >= 5 ? 1.0 : phaseIndex === 4 ? 0.35 + phaseProgress * 0.65 : 0;

  // Cluster growth milestones — fire a special sound when a cluster first reaches size 4 or 8
  for (const cluster of active) {
    const sz = cluster.length;
    if (sz === 4) {
      if (now - st.milestone4Time > 25.0) {
        st.milestone4Time = now;
        playClusterMilestone(engine, scale, profile, 4);
      }
    } else if (sz >= 8) {
      if (now - st.milestone8Time > 50.0) {
        st.milestone8Time = now;
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
    if (now - st.desertShimmerTime > 0.9 && Math.random() < 0.028) {
      st.desertShimmerTime = now;
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

  // Lone mote pings — sparse presence using audio clock.
  // Suppressed in silence: only the lonely drone speaks for the last survivors.
  const loners = motes.filter((m) => m.bonds.length === 0);
  if (loners.length > 0 && phaseIndex < 5) {
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
  if (now - st.bondBreakCooldown > 0.20) {
    for (const m of motes) {
      if (m.bondBreakFlash > 0.9) {
        playBondBreak(engine, 1 - m.y / H, scale, profile);
        st.bondBreakCooldown = now;
        break;
      }
    }
  }

  // Ancient bond break — deep sorrowful chord when a long relationship ends (70s+ bonds)
  if (now - st.ancientBondBreakTime > 3.0) {
    for (const m of motes) {
      if (m.ancientBondBreakFlash > 0.9) {
        playAncientBondBreak(engine, 1 - m.y / H, profile, biome);
        st.ancientBondBreakTime = now;
        break;
      }
    }
  }

  // Cluster merge sounds — two communities finding each other's resonance
  if (now - st.clusterMergeCooldown > 1.5) {
    for (const m of motes) {
      if (m.clusterMergeFlash > 0.9) {
        playClusterMerge(engine, profile, biome);
        st.clusterMergeCooldown = now;
        break;
      }
    }
  }

  // Mourning chorus — when 2+ motes grieve together, a quiet communal chord
  if (now - st.mourningTime > 7.0) {
    let mourningCount = 0;
    for (const m of motes) { if (m.mourningFlash > 0.6) mourningCount++; }
    if (mourningCount >= 2) {
      playMourningChorus(engine, profile, biome);
      st.mourningTime = now;
    }
  }

  // Spawn sounds — gentle arrival ping for freshly born motes
  if (now - st.spawnCooldown > 0.18) {
    const freshMote = motes.find((m) => m.spawnFlash > 0.75);
    if (freshMote) {
      playSpawnPing(engine, freshMote.x / W, 1 - freshMote.y / H, scale, profile);
      st.spawnCooldown = now;
    }
  }

  // Volcanic lava pops — periodic low-frequency transients, like bubbles of magma surfacing
  if (biome === "volcanic") {
    if (now - st.volcanicAccentTime > 2.2 + Math.random() * 4.5) {
      st.volcanicAccentTime = now;
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
    if (now - st.lonelyDroneTime > 22.0) {
      st.lonelyDroneTime = now;
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
    if (now - st.tundraWindTime > 28.0) {
      st.tundraWindTime = now;
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
    const fireflyInterval = phaseIndex === 3 ? 0.7 : 1.1; // denser in complexity
    if (now - st.lushFireflyTime > fireflyInterval && Math.random() < 0.70) {
      st.lushFireflyTime = now + Math.random() * 0.4; // stagger next check
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
    const crystalInterval = phaseIndex === 3 ? 3.5 : 5.5;
    if (now - st.tundraCrystalTime > crystalInterval && Math.random() < 0.80) {
      st.tundraCrystalTime = now;
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
  const prevMoteCount = st.prevMoteCount;
  st.prevMoteCount = motes.length;
  if (biome === "lush" && phaseIndex === 5 && motes.length === 0 && prevMoteCount > 0) {
    if (now - st.lushBloomTime > 30.0) {
      st.lushBloomTime = now;
      playLushFinalBloom(engine, profile);
    }
  }

  // Volcanic dissolution: sub-bass rumbles that grow more frequent as the world ends.
  // Interval shrinks from 8s → 2s as phaseProgress approaches 1.
  if (biome === "volcanic" && phaseIndex === 4) {
    const rumbleInterval = 8.0 - phaseProgress * 6.0;
    if (now - st.volcanicRumbleTime > rumbleInterval) {
      st.volcanicRumbleTime = now;
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


/**
 * Elder death knell — played when an ancient mote (age > 25) dies.
 * A three-note resonant chord descending slowly into silence. More mournful and
 * spacious than the regular death sound: this was a life that mattered.
 * Biome-voiced timbre. Always routed through reverb for ghostly distance.
 */
export function playElderDeath(engine: SoundEngine, yNorm: number): void {
  if (!engine.initialized) return;
  const st = getState(engine);
  const biome = st.currentBiome ?? "temperate";
  const p = BIOME_SOUND[biome];
  const ctx = engine.ctx;
  const now = ctx.currentTime;

  // Cooldown: at most one elder knell every 4 seconds (avoids saturation in dissolution)
  if (now - st.elderDeathTime < 4.0) return;
  st.elderDeathTime = now;

  // Root from biome profile shifted by Y position — high deaths ring higher
  const rootFreq = p.rootFreq * (1.0 + yNorm * 0.35);

  // Three descending tones: root, minor 3rd down, octave down
  // They trigger in sequence, each with a longer decay than the last.
  const tones: [number, number, number, number][] = [
    // [semitones_from_root, delay_s, peak_gain, decay_s]
    [0,  0.00, 0.030, 4.0],
    [-3, 0.35, 0.022, 3.2],
    [-12,0.75, 0.028, 5.5],
  ];

  const wave: OscillatorType = (biome === "volcanic") ? "triangle"
    : (biome === "tundra") ? "sine"
    : "sine";

  for (const [semi, delay, vol, decay] of tones) {
    const freq = rootFreq * Math.pow(2, semi / 12);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = wave;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.001, now + delay);
    gain.gain.linearRampToValueAtTime(vol * p.masterMult, now + delay + 0.06);
    gain.gain.exponentialRampToValueAtTime(0.001, now + delay + decay);
    osc.connect(gain);
    gain.connect(engine.reverb);
    osc.start(now + delay);
    osc.stop(now + delay + decay + 0.1);

    // Faint upper harmonic — adds warmth, slightly detuned per tone for richness
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = "sine";
    osc2.frequency.value = freq * 2.0;
    osc2.detune.value = 8;
    gain2.gain.setValueAtTime(0.001, now + delay);
    gain2.gain.linearRampToValueAtTime(vol * 0.28 * p.masterMult, now + delay + 0.04);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + delay + decay * 0.55);
    osc2.connect(gain2);
    gain2.connect(engine.reverb);
    osc2.start(now + delay);
    osc2.stop(now + delay + decay * 0.6);
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

/** Create a looping stereo noise buffer source */
export function createNoiseSource(ctx: AudioContext, duration: number): AudioBufferSourceNode {
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

// Re-exports from sub-modules
export {
  playEventSound, playPhaseTransition, playCascadeArrival, playBirdChirp, playStarAscension,
} from "./sound-events";
export {
  playBondForm, playBondBreak, playAncientBondBreak, playDeath,
  playClusterMilestone, playClusterMerge, playMourningChorus, playLushFinalBloom,
} from "./sound-lifecycle";
export { updateWeatherSound, updateDissolutionSound } from "./sound-weather";
