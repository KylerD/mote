// main.ts — Entry point. Thin orchestrator: init + frame loop.

import { createRenderContext, present } from "./render";
import { H } from "./config";
import { renderTerrain, applyHeatHaze, applyVolcanicAsh } from "./terrain";
import { createWorld, updateWorld } from "./world";
import { cycleName } from "./names";
import { createSoundEngine, initAudio, updateSound, updateWeatherSound, playDeath, playEventSound, playPhaseTransition } from "./sound";
import { createInteraction, applyInteraction } from "./interaction";
import { isEventActive, isEclipseActive } from "./events";
import {
  renderCelestial, renderClouds, renderParticles,
  renderLightning, renderFog, applyWeatherDarkening,
  applyTundraAurora,
} from "./weather";
import { createNarrative, updateNarrative } from "./narrative";
import { computeMoteColor, renderMoteTrails, renderMotes } from "./render-motes";
import {
  renderAuroraCurtains, renderEclipse, applyAuroraBoost,
  renderMeteorVisual, renderCraterGlow, renderPhaseFlash,
  applyVignette, applyPhaseColorGrade, createMeteorState,
  applyBloom, renderAtmosphericParticles, renderClusterRadiance,
} from "./render-effects";
import { renderClusterGlow, renderBondLines, renderDeathParticles } from "./render-bonds";
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
  setInterval(() => {
    const curPhase = world.ref.phaseIndex;
    if (sound.initialized) {
      if (curPhase !== lastPhaseIndex && lastPhaseIndex >= 0) {
        playPhaseTransition(sound, curPhase, world.ref.terrain.biome);
      }
      lastPhaseIndex = curPhase;
    } else {
      lastPhaseIndex = curPhase; // stay in sync without playing
    }
    updateSound(sound, world.ref.motes, curPhase, world.ref.phaseProgress, world.ref.terrain.biome);
    updateWeatherSound(sound, world.ref.weather);
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

  function frame(now: number): void {
    const dt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;

    // Update
    updateWorld(w, dt);
    applyInteraction(input, w.motes);

    // Event sound
    if (w.pendingEventSound && sound.initialized) {
      playEventSound(sound, w.pendingEventSound);
      w.pendingEventSound = null;
    }

    // Death sounds
    for (const d of w.deaths) {
      if (w.time - d.time < 0.02) {
        if (sound.initialized) playDeath(sound, 1 - d.y / H);
        break;
      }
    }

    // Narrative
    updateNarrative(narrative, w);

    // --- Render ---

    // Terrain + sky
    renderTerrain(rc.buf, w.terrain, w.time, w.cycleProgress);

    // Weather background
    renderCelestial(rc.buf, w.weather, w.time, w.cycleProgress);
    applyTundraAurora(rc.buf, w.terrain.biome, w.time, w.cycleProgress, w.weather.type);
    renderClouds(rc.buf, w.weather, w.time, w.terrain.biome);
    applyWeatherDarkening(rc.buf, w.weather);
    applyHeatHaze(rc.buf, w.terrain, w.time, w.cycleProgress);
    applyVolcanicAsh(rc.buf, w.terrain, w.cycleProgress);

    // Pre-compute mote colors
    const moteColors = new Map<Mote, [number, number, number]>();
    for (const m of w.motes) {
      moteColors.set(m, computeMoteColor(m, w.terrain.bp));
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

    // Cluster glow (behind motes)
    for (const cluster of w.clusters) {
      if (cluster.length >= 3) {
        renderClusterGlow(rc.buf, cluster, moteColors, w.time);
      }
    }

    // Mote trails, sprites, bonds, deaths
    renderMoteTrails(rc.buf, w.motes, moteColors);
    renderMotes(rc.buf, w.motes, moteColors, plagueActive, plaguePulse, w.time);
    renderBondLines(rc.buf, w.motes, moteColors, w.time);
    renderDeathParticles(rc.buf, w.deaths, w.time);

    // Meteor
    renderMeteorVisual(rc.buf, meteor, w.event, w.time, w.cycleNumber, dt);
    if (w.event && w.event.type === "meteor") {
      renderCraterGlow(rc.buf, w.event, w.time);
    }

    // Eclipse
    if (eclipseActive && w.event) {
      renderEclipse(rc.buf, w.event, w.time, w.motes, moteColors, w.cycleNumber);
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

    // Phase flash + atmospheric particles + bloom + vignette
    renderPhaseFlash(rc.buf, w.phaseFlash, w.phaseIndex);

    // Phase-specific atmospheric particles — rendered pre-bloom so they glow
    renderAtmosphericParticles(rc.buf, w.phaseIndex, w.phaseProgress, w.time, w.cycleNumber);

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

    applyVignette(rc.buf, w.phaseIndex, w.phaseProgress);
    applyPhaseColorGrade(rc.buf, w.phaseIndex, w.phaseProgress);

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
