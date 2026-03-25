// main.ts — Entry point. Thin orchestrator: init + frame loop.

import { createRenderContext, present } from "./render";
import { W, H } from "./config";
import { renderTerrain, applyHeatHaze, applyVolcanicAsh, renderRainPuddles, renderWaterMist, renderVolcanicEmbers, applyTundraIce } from "./terrain";
import { createWorld, updateWorld } from "./world";
import { cycleName } from "./names";
import { createSoundEngine, initAudio, updateSound, updateWeatherSound, updateDissolutionSound, playDeath, playElderDeath, playEventSound, playPhaseTransition, playCascadeArrival, playBirdChirp, playStarAscension } from "./sound";
import { createInteraction, applyInteraction } from "./interaction";
import { isEventActive, isEclipseActive } from "./events";
import {
  renderCelestial, renderClouds, renderParticles,
  renderLightning, renderFog, applyWeatherDarkening,
  applyTundraAurora, applyGodRays, renderShootingStars,
  renderBirds, renderDissolutionWind, renderDissolutionRain,
} from "./weather";
import { createNarrative, updateNarrative } from "./narrative";
import { computeMoteColor, renderMoteTrails, renderMotes } from "./render-motes";
import {
  renderAuroraCurtains, renderEclipse, applyAuroraBoost,
  renderMeteorVisual, renderCraterGlow, renderPhaseFlash,
  applyVignette, applyPhaseColorGrade, createMeteorState,
  applyBloom, renderAtmosphericParticles, renderBiomeAmbientLife, renderClusterRadiance,
  applyChromaticAberration, applyLastLight, renderFloodStorm, renderDroughtHeat,
  renderHeatmap,
} from "./render-effects";
import { renderClusterGroundGlow, renderClusterGlow, renderClusterBeacons, renderBondLines, renderProtoAttractions, renderDeathParticles, renderSilenceConstellation, renderSilenceGraveyards, renderCascadeBursts, renderSoulWisps, renderSpiritAscension } from "./render-bonds";
import { renderRipples, renderCursor, renderEventMessage, renderDebugOverlay } from "./render-ui";
import type { Mote, RenderContext, SoundEngine, Interaction } from "./types";

let rc: RenderContext;
const world = { ref: createWorld() };
let sound: SoundEngine;
let input: Interaction;

function init(): void {
  const canvas = document.getElementById("world") as HTMLCanvasElement;
  rc = createRenderContext(canvas);
  world.ref = createWorld();
  sound = createSoundEngine();
  input = createInteraction(canvas);

  const narrative = createNarrative();
  const meteor = createMeteorState();

  // TERRAIN LIFE HEATMAP — accumulated warmth from mote presence.
  // Builds up where motes walk, decays slowly, leaves glowing amber paths.
  const heatBuffer = new Float32Array(W * H);
  let heatCycleNumber = -1; // initialized to sentinel; synced to cycle on first frame

  // CLUSTER CASCADE — tracks 8+ member milestone bursts.
  // When a cluster first reaches 8 members, a triple expanding ring fires from the centroid.
  // Anchored by the oldest mote: stable across frames, clears naturally when the anchor dies.
  interface CascadeBurst { cx: number; cy: number; r: number; g: number; b: number; age: number; }
  const cascadeBursts: CascadeBurst[] = [];
  const cascadeAnchors = new Set<Mote>(); // one anchor per cluster that has already cascaded

  // DOM info elements
  const elCycleName = document.getElementById("cycle-name");
  const elPhase = document.getElementById("cycle-phase");

  // Biome-reactive frame glow — set once; biome is fixed for the cycle
  const frameEl = document.getElementById("frame");
  if (frameEl) {
    const BIOME_GLOWS: Record<string, string> = {
      temperate: "rgba(180, 190, 140, 0.10)",
      desert:    "rgba(240, 175, 65,  0.11)",
      tundra:    "rgba(100, 185, 245, 0.10)",
      volcanic:  "rgba(255,  70, 25,  0.10)",
      lush:      "rgba(100, 210, 120, 0.10)",
    };
    frameEl.style.setProperty(
      "--frame-glow",
      BIOME_GLOWS[world.ref.terrain.biome] ?? "rgba(220, 140, 80, 0.07)",
    );
  }

  // Audio init on first interaction
  const audioPrompt = document.getElementById("audio-prompt");
  const startAudio = () => {
    initAudio(sound);
    if (audioPrompt) {
      audioPrompt.classList.add("dismissed");
      setTimeout(() => { if (audioPrompt.parentNode) audioPrompt.style.display = "none"; }, 600);
    }
    document.removeEventListener("click", startAudio);
    document.removeEventListener("touchstart", startAudio);
    document.removeEventListener("keydown", startAudio);
  };
  document.addEventListener("click", startAudio);
  document.addEventListener("touchstart", startAudio);
  document.addEventListener("keydown", startAudio);

  // Sound update loop (~15fps, decoupled)
  // Track phase for transition sounds; -1 until first sync so stale phases don't fire on load
  let lastPhaseIndex = -1;
  let lastBirdChirpTime = 0;
  let nextBirdChirpDelay = 9 + Math.random() * 7; // 9–16s first chirp
  setInterval(() => {
    const curPhase = world.ref.phaseIndex;
    if (sound.initialized) {
      if (curPhase !== lastPhaseIndex && lastPhaseIndex >= 0) {
        playPhaseTransition(sound, curPhase, world.ref.terrain.biome);
      }
      lastPhaseIndex = curPhase;

      // Bird chirps — occasional calls from passing flocks during active flight phases
      const birdsActive = curPhase >= 1 && curPhase <= 4 && world.ref.terrain.biome !== "volcanic";
      const weatherAllows = world.ref.weather.type !== "storm" && world.ref.weather.type !== "overcast";
      if (birdsActive && weatherAllows) {
        const realNow = performance.now() / 1000;
        if (realNow - lastBirdChirpTime > nextBirdChirpDelay) {
          lastBirdChirpTime = realNow;
          nextBirdChirpDelay = 8 + Math.random() * 12; // 8–20s between calls
          const pan = (Math.random() - 0.5) * 1.6;     // wide stereo spread
          playBirdChirp(sound, world.ref.terrain.biome, Math.max(-1, Math.min(1, pan)));
        }
      }
    } else {
      lastPhaseIndex = curPhase; // stay in sync without playing
    }
    updateSound(sound, world.ref.motes, curPhase, world.ref.phaseProgress, world.ref.terrain.biome);
    updateWeatherSound(sound, world.ref.weather);
    updateDissolutionSound(sound, world.ref.cycleProgress, world.ref.terrain.biome, world.ref.weather.type);
  }, 67);

  // Idle cursor hide
  let idleTimer = 0;
  document.addEventListener("mousemove", () => {
    document.body.classList.remove("idle");
    clearTimeout(idleTimer);
    idleTimer = window.setTimeout(() => document.body.classList.add("idle"), 3000);
  });

  let lastTime = performance.now();
  const debugMode = new URLSearchParams(window.location.search).has("debug");
  const w = world.ref;

  // Vignette cross-fade: track the phase we transitioned FROM so we can blend tints at boundaries
  let vigPrevPhaseIndex = w.phaseIndex;
  let vigLastSeenPhase = w.phaseIndex;

  // Spirit star chimes — track how many deaths have had their star-rise chime played
  // Only fires during dissolution (phaseIndex >= 4) when stars are visible
  let starChimeCount = 0;
  let starChimeCycleNumber = -1;

  function frame(now: number): void {
    const dt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;

    // Update
    updateWorld(w, dt);
    applyInteraction(input, w.motes);

    // Terrain life heatmap: clear on new cycle, deposit at mote positions, decay
    if (w.cycleNumber !== heatCycleNumber) {
      heatBuffer.fill(0);
      heatCycleNumber = w.cycleNumber;
    }
    const heatDeposit = dt * 1.6;
    const heatDecay = 1 - dt * 0.026; // half-life ~27s
    for (const m of w.motes) {
      const mx = Math.round(m.x);
      const my = Math.round(m.y);
      if (mx >= 1 && mx < W - 1 && my >= 1 && my < H - 1) {
        const idx = my * W + mx;
        heatBuffer[idx] = Math.min(1, heatBuffer[idx] + heatDeposit);
        // Spread warmth to adjacent pixels for a softer glow
        heatBuffer[idx - 1]     = Math.min(1, heatBuffer[idx - 1]     + heatDeposit * 0.40);
        heatBuffer[idx + 1]     = Math.min(1, heatBuffer[idx + 1]     + heatDeposit * 0.40);
        heatBuffer[idx - W]     = Math.min(1, heatBuffer[idx - W]     + heatDeposit * 0.25);
        heatBuffer[idx + W]     = Math.min(1, heatBuffer[idx + W]     + heatDeposit * 0.25);
        heatBuffer[idx - W - 1] = Math.min(1, heatBuffer[idx - W - 1] + heatDeposit * 0.12);
        heatBuffer[idx - W + 1] = Math.min(1, heatBuffer[idx - W + 1] + heatDeposit * 0.12);
        heatBuffer[idx + W - 1] = Math.min(1, heatBuffer[idx + W - 1] + heatDeposit * 0.12);
        heatBuffer[idx + W + 1] = Math.min(1, heatBuffer[idx + W + 1] + heatDeposit * 0.12);
      }
    }
    for (let i = 0; i < heatBuffer.length; i++) heatBuffer[i] *= heatDecay;

    // Event sound
    if (w.pendingEventSound && sound.initialized) {
      playEventSound(sound, w.pendingEventSound);
      w.pendingEventSound = null;
    }

    // Death sounds — elders (age > 25) get a distinct resonant knell
    for (const d of w.deaths) {
      if (w.time - d.time < 0.02) {
        if (sound.initialized) {
          if (d.age !== undefined && d.age > 25) {
            playElderDeath(sound, 1 - d.y / H);
          } else {
            playDeath(sound, 1 - d.y / H);
          }
        }
        break;
      }
    }

    // Spirit star chimes — soft crystalline tone when each spirit ascends to the sky.
    // Only fires during dissolution/silence when stars are visible.
    if (w.cycleNumber !== starChimeCycleNumber) { starChimeCount = 0; starChimeCycleNumber = w.cycleNumber; }
    if (w.phaseIndex >= 4 && sound.initialized && w.allDeaths.length > starChimeCount) {
      const d = w.allDeaths[starChimeCount];
      playStarAscension(sound, 1 - d.y / H, d.r, d.g, d.b);
      starChimeCount++;
    }

    // Narrative
    updateNarrative(narrative, w);

    // --- Render ---

    // Terrain + sky
    renderTerrain(rc.buf, w.terrain, w.time, w.cycleProgress);

    // Weather background
    renderCelestial(rc.buf, w.weather, w.time, w.cycleProgress);
    applyGodRays(rc.buf, w.weather, w.time, w.cycleProgress, w.terrain.biome);
    renderShootingStars(rc.buf, w.cycleProgress, w.cycleNumber, w.weather.type);
    applyTundraAurora(rc.buf, w.terrain.biome, w.time, w.cycleProgress, w.weather.type);
    renderClouds(rc.buf, w.weather, w.time, w.terrain.biome);
    renderBirds(rc.buf, w.cycleNumber, w.cycleProgress, w.phaseIndex, w.weather.type, w.terrain.biome, w.time);
    renderDissolutionWind(rc.buf, w.cycleProgress, w.time, w.terrain.biome, w.cycleNumber);
    renderDissolutionRain(rc.buf, w.cycleProgress, w.time, w.terrain.biome, w.cycleNumber);
    applyWeatherDarkening(rc.buf, w.weather);
    applyTundraIce(rc.buf, w.terrain, w.cycleProgress);
    renderRainPuddles(rc.buf, w.terrain, w.weather, w.time);
    renderWaterMist(rc.buf, w.terrain, w.time, w.cycleProgress);
    applyHeatHaze(rc.buf, w.terrain, w.time, w.cycleProgress);
    applyVolcanicAsh(rc.buf, w.terrain, w.cycleProgress);
    renderVolcanicEmbers(rc.buf, w.terrain, w.time, w.cycleProgress);

    // Terrain life heatmap — warm glowing paths where motes have been
    renderHeatmap(rc.buf, heatBuffer, w.phaseIndex);

    // Pre-compute mote colors
    const moteColors = new Map<Mote, [number, number, number]>();
    for (const m of w.motes) {
      moteColors.set(m, computeMoteColor(m, w.terrain.bp));
    }

    // Cluster heartbeat: all motes in a cluster pulse their inner glow in unison.
    // Larger clusters beat slower — biological scaling makes size legible at a glance.
    const clusterHeartbeat = new Map<Mote, number>();
    for (const cluster of w.clusters) {
      if (cluster.length < 2) continue;
      let cx = 0;
      for (const m of cluster) cx += m.x;
      cx /= cluster.length;
      // Hz falls with sqrt(size): 2-mote ≈ 1.27 Hz, 4-mote ≈ 0.90 Hz, 9-mote ≈ 0.60 Hz
      const hz = 1.8 / Math.sqrt(Math.max(2, cluster.length));
      const beat = Math.sin(w.time * hz * Math.PI * 2 + cx * 0.02) * 0.5 + 0.5;
      for (const m of cluster) clusterHeartbeat.set(m, beat);
    }

    // Cluster cascade: fire a triple-ring burst when a cluster first reaches 8+ members
    for (const cluster of w.clusters) {
      if (cluster.length < 8) continue;
      const anchor = cluster.reduce((a, b) => a.age > b.age ? a : b);
      if (cascadeAnchors.has(anchor)) continue;
      cascadeAnchors.add(anchor);
      let cx = 0, cy = 0, avgR = 0, avgG = 0, avgB = 0;
      for (const m of cluster) {
        cx += m.x; cy += m.y;
        const [r, g, b] = moteColors.get(m)!;
        avgR += r; avgG += g; avgB += b;
      }
      cx /= cluster.length; cy /= cluster.length;
      cascadeBursts.push({ cx, cy, r: Math.round(avgR / cluster.length), g: Math.round(avgG / cluster.length), b: Math.round(avgB / cluster.length), age: 0 });
      if (sound.initialized) playCascadeArrival(sound, w.terrain.biome);
    }
    // Advance burst ages; prune finished bursts
    for (let i = cascadeBursts.length - 1; i >= 0; i--) {
      cascadeBursts[i].age += dt;
      if (cascadeBursts[i].age > 2.5) cascadeBursts.splice(i, 1);
    }

    // Event state
    const plagueActive = w.event !== null && w.event.type === "plague" && isEventActive(w.event, w.time);
    const plaguePulse = plagueActive ? Math.sin(w.time * 6) : 0;
    const eclipseActive = isEclipseActive(w.event, w.time);
    const auroraActive = w.event !== null && w.event.type === "aurora" && isEventActive(w.event, w.time);

    // Aurora curtains (behind motes)
    if (auroraActive && w.event) {
      renderAuroraCurtains(rc.buf, w.time, w.event.startTime);
    }

    // Cluster ground glow (beneath motes — warm terrain light)
    for (const cluster of w.clusters) {
      if (cluster.length >= 2) {
        renderClusterGroundGlow(rc.buf, cluster, moteColors, w.phaseIndex, w.time);
      }
    }

    // Cluster glow (behind motes)
    for (const cluster of w.clusters) {
      if (cluster.length >= 2) {
        renderClusterGlow(rc.buf, cluster, moteColors, w.time, w.phaseIndex);
      }
    }

    // Cluster beacons — light pillars rising from large clusters into the sky
    renderClusterBeacons(rc.buf, w.clusters, moteColors, w.phaseIndex, w.time);

    // Soul wisps — lingering colored spirits of the dead, drifting above the terrain (3–55s)
    renderSoulWisps(rc.buf, w.allDeaths, w.phaseName, w.time);

    // Mote trails, sprites, bonds, deaths
    renderMoteTrails(rc.buf, w.motes, moteColors);
    // Proto-attraction arcs: faint animated dotted lines between approaching motes
    renderProtoAttractions(rc.buf, w.motes, moteColors, w.time, w.phaseIndex);
    renderMotes(rc.buf, w.motes, moteColors, plagueActive, plaguePulse, w.time, w.phaseIndex, clusterHeartbeat);
    renderBondLines(rc.buf, w.motes, moteColors, w.time);
    renderCascadeBursts(rc.buf, cascadeBursts);
    renderDeathParticles(rc.buf, w.deaths, w.time);
    renderSilenceConstellation(rc.buf, w.allDeaths, w.phaseName, w.motes.length, w.time, w.phaseProgress);
    renderSilenceGraveyards(rc.buf, w.allDeaths, w.phaseName, w.motes.length, w.time, w.phaseProgress);
    // Spirit ascension: memorial stars in the sky during dissolution and silence
    renderSpiritAscension(rc.buf, w.allDeaths, w.phaseIndex, w.phaseProgress, w.time);

    // Meteor
    renderMeteorVisual(rc.buf, meteor, w.event, w.time, w.cycleNumber, dt);
    if (w.event && w.event.type === "meteor") {
      renderCraterGlow(rc.buf, w.event, w.time);
    }

    // Eclipse
    if (eclipseActive && w.event) {
      renderEclipse(rc.buf, w.event, w.time, w.motes, moteColors, w.cycleNumber,
        w.weather.celestial.x, w.weather.celestial.y);
    }

    // Aurora boost
    if (auroraActive) {
      applyAuroraBoost(rc.buf);
    }

    // UI: ripples, cursor
    renderRipples(rc.buf, input, dt);
    renderCursor(rc.buf, input, w.time);

    // Weather foreground
    renderParticles(rc.buf, w.weather, w.terrain.biome);
    renderFog(rc.buf, w.weather, w.time, w.terrain.biome);
    renderLightning(rc.buf, w.weather);

    // Flood storm overlay — dark sky, heavy rain, thunder flash when flood is active
    if (w.event && w.event.type === "flood" && isEventActive(w.event, w.time)) {
      renderFloodStorm(rc.buf, w.event, w.time, w.cycleNumber);
    }

    // Drought heat overlay — bleached sky, heat shimmer, dust haze when drought is active
    if (w.event && w.event.type === "drought" && isEventActive(w.event, w.time)) {
      renderDroughtHeat(rc.buf, w.event, w.time, w.cycleNumber);
    }

    // Phase flash + atmospheric particles + bloom + vignette
    renderPhaseFlash(rc.buf, w.phaseFlash, w.phaseIndex);

    // Phase-specific atmospheric particles — rendered pre-bloom so they glow
    renderAtmosphericParticles(rc.buf, w.phaseIndex, w.phaseProgress, w.time, w.cycleNumber);
    // Biome ambient life — fireflies, embers, pollen, ice sparkles, heat dust
    renderBiomeAmbientLife(rc.buf, w.terrain.biome, w.phaseIndex, w.phaseProgress, w.time, w.cycleNumber);

    // Cluster radiance — soft area light from large bonded clusters, feeds into bloom
    renderClusterRadiance(rc.buf, w.clusters, w.terrain.biome, w.phaseIndex, w.time);

    // Bloom strength varies by phase and event — creatures glow brightest at peak complexity
    const BLOOM_BY_PHASE = [0.45, 0.40, 0.50, 0.62, 0.33, 0.20];
    let bloomStrength = BLOOM_BY_PHASE[Math.min(5, w.phaseIndex)];
    if (eclipseActive) bloomStrength = 0.78;     // dramatic: mote eyes as tiny lanterns
    else if (auroraActive) bloomStrength = Math.min(0.65, bloomStrength * 1.2);

    // Per-biome bloom tint — each world's light has a characteristic color cast
    let bloomTintR = 1.0, bloomTintG = 1.0, bloomTintB = 1.0;
    switch (w.terrain.biome) {
      case "volcanic":   bloomTintR = 1.40; bloomTintG = 0.72; bloomTintB = 0.52; break;
      case "tundra":     bloomTintR = 0.62; bloomTintG = 0.88; bloomTintB = 1.48; break;
      case "desert":     bloomTintR = 1.32; bloomTintG = 1.05; bloomTintB = 0.62; break;
      case "lush":       bloomTintR = 0.88; bloomTintG = 1.22; bloomTintB = 0.80; break;
      // temperate: neutral (1, 1, 1)
    }
    applyBloom(rc.buf, bloomStrength, bloomTintR, bloomTintG, bloomTintB);

    // Chromatic aberration — brief lens-shock at phase transitions
    applyChromaticAberration(rc.buf, w.phaseFlash);

    // Detect phase transitions and update the cross-fade tracker
    if (w.phaseIndex !== vigLastSeenPhase) {
      vigPrevPhaseIndex = vigLastSeenPhase;
      vigLastSeenPhase = w.phaseIndex;
    }
    applyVignette(rc.buf, w.phaseIndex, w.phaseProgress, w.motes.length, vigPrevPhaseIndex, w.phaseFlash);
    applyPhaseColorGrade(rc.buf, w.phaseIndex, w.phaseProgress, w.terrain.biome);

    // Last-light — cinematic spotlight on the final survivors
    applyLastLight(rc.buf, w.motes, w.phaseIndex, w.phaseProgress, w.time);

    // Event message
    renderEventMessage(rc.buf, w.event, w.time);

    // DOM updates
    if (elCycleName) elCycleName.textContent = cycleName(w.cycleNumber);
    if (elPhase) elPhase.textContent = w.phaseName;

    // Debug
    if (debugMode) {
      renderDebugOverlay(rc.buf, w.phaseName, w.motes.length, w.clusters.length, dt);
    }

    present(rc.ctx, rc.buf);
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

init();
