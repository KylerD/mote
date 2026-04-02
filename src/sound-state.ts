// sound-state.ts — Per-engine sound state, replacing separate WeakMaps.

import type { Biome, SoundEngine } from "./types";

/** Ambient bed oscillators and gain nodes */
export interface AmbientBed {
  droneOsc: OscillatorNode | null;
  droneGain: GainNode | null;
  textureSource: AudioBufferSourceNode;
  textureFilter: BiquadFilterNode;
  textureGain: GainNode;
  lfoOsc: OscillatorNode | null;
  lfoGain: GainNode | null;
}

export interface SoundState {
  currentBiome: Biome | null;
  ambientBed: AmbientBed | null;
  spawnCooldown: number;
  bondBreakCooldown: number;
  volcanicAccentTime: number;
  lonelyDroneTime: number;
  desertShimmerTime: number;
  milestone4Time: number;
  milestone8Time: number;
  tundraWindTime: number;
  volcanicRumbleTime: number;
  clusterMergeCooldown: number;
  mourningTime: number;
  prevMoteCount: number;
  lushBloomTime: number;
  ancientBondBreakTime: number;
  lushFireflyTime: number;
  tundraCrystalTime: number;
  cascadeArrivalTime: number;
  elderDeathTime: number;
}

const engineState = new Map<SoundEngine, SoundState>();

export function getState(engine: SoundEngine): SoundState {
  let s = engineState.get(engine);
  if (!s) {
    s = {
      currentBiome: null,
      ambientBed: null,
      spawnCooldown: 0,
      bondBreakCooldown: 0,
      volcanicAccentTime: -999,
      lonelyDroneTime: -999,
      desertShimmerTime: -999,
      milestone4Time: -999,
      milestone8Time: -999,
      tundraWindTime: -999,
      volcanicRumbleTime: -999,
      clusterMergeCooldown: 0,
      mourningTime: -999,
      prevMoteCount: 0,
      lushBloomTime: -999,
      ancientBondBreakTime: -999,
      lushFireflyTime: -999,
      tundraCrystalTime: -999,
      cascadeArrivalTime: -999,
      elderDeathTime: -999,
    };
    engineState.set(engine, s);
  }
  return s;
}
