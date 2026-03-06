// main.ts — Entry point. Thin orchestrator: init + frame loop.

import { createRenderContext, present } from "./render";
import { H } from "./config";
import { renderTerrain } from "./terrain";
import { createWorld, updateWorld } from "./world";
import { cycleName } from "./names";
import { createSoundEngine, initAudio, updateSound, updateWeatherSound, playDeath, playEventSound } from "./sound";
import { createInteraction, applyInteraction } from "./interaction";
import { isEventActive, isEclipseActive } from "./events";
import {
  renderCelestial, renderClouds, renderParticles,
  renderLightning, renderFog, applyWeatherDarkening,
} from "./weather";
import { createNarrative, updateNarrative } from "./narrative";
import { computeMoteColor, renderMoteTrails, renderMotes } from "./render-motes";
import {
  renderAuroraCurtains, renderEclipse, applyAuroraBoost,
  renderMeteorVisual, renderCraterGlow, renderPhaseFlash,
  applyVignette, applyPhaseColorGrade, createMeteorState,
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
  setInterval(() => {
    updateSound(sound, world.ref.motes, world.ref.phaseIndex, world.ref.phaseProgress, world.ref.terrain.biome);
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
    renderClouds(rc.buf, w.weather, w.time);
    applyWeatherDarkening(rc.buf, w.weather);

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

    // Phase flash + vignette
    renderPhaseFlash(rc.buf, w.phaseFlash, w.phaseIndex);
    applyVignette(rc.buf, w.phaseIndex);
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
