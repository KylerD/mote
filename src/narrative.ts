// narrative.ts — Ambient story moments. Phase arc, milestones, event drama.

import type { World, PhaseName } from "./types";
import { isEventActive, getEventTriggerPoint } from "./events";
import { CYCLE_DURATION } from "./config";

// --- Narrative pools ---

/** One text fires when each phase begins — picked deterministically per cycle */
const PHASE_ENTRY: Record<PhaseName, string[]> = {
  genesis: [
    "a world begins to breathe",
    "the first light falls",
    "something ancient wakes",
    "emptiness stirs",
  ],
  exploration: [
    "they wander into the unknown",
    "curious sparks scatter",
    "each one finds its own path",
    "the world waits to be found",
  ],
  organization: [
    "they begin to find each other",
    "bonds reach across the distance",
    "warmth gathers at the center",
    "something like a village forms",
  ],
  complexity: [
    "everything alive at once",
    "the world at its fullest",
    "life in its richest hour",
    "at the height of all things",
  ],
  dissolution: [
    "the light begins to fade",
    "one by one, they let go",
    "nothing holds forever",
    "the long unraveling begins",
  ],
  silence: [
    "silence falls",
    "the world rests",
    "the cycle closes",
    "soon, again",
  ],
};

/** Fired ~25s before a rare event begins — anticipation without spoilers */
const ANTICIPATION_TEXTS = [
  "something stirs",
  "the air shifts",
  "a change approaches",
  "the world holds its breath",
];

/** Narrative text shown in the HTML element when an event starts */
const EVENT_START_TEXTS: Partial<Record<string, string>> = {
  flood:      "the waters rise",
  bloom:      "life erupts",
  meteor:     "fire from above",
  migration:  "they move as one",
  eclipse:    "darkness descends",
  earthquake: "the ground trembles",
  plague:     "a sickness spreads",
  aurora:     "the sky comes alive",
  drought:    "the land grows parched",
};

/** Fired after a rare event ends — reflection, not recap */
const EVENT_AFTERMATH: Partial<Record<string, string[]>> = {
  flood:      ["the waters remember", "land reclaims the shore"],
  bloom:      ["color lingers", "the world breathes fuller"],
  meteor:     ["the scar endures", "the crater holds its silence"],
  migration:  ["they have gone where they must", "the path grows quiet"],
  eclipse:    ["light returns, changed", "the shadow remembers"],
  earthquake: ["the land has spoken", "stone reshapes the path"],
  plague:     ["the ones who endured", "hardship leaves its mark"],
  aurora:     ["beauty needs no reason", "the light knew"],
  drought:    ["the thirst passes", "memory of water"],
};

/** Fired when a phase transition happens while an event is still active */
const EVENT_CASCADE_TEXTS: Partial<Record<string, string>> = {
  flood:      "still the waters rise",
  bloom:      "life continues to pour forth",
  meteor:     "the crater holds its silence",
  migration:  "still they move as one",
  eclipse:    "the darkness persists",
  earthquake: "the earth still trembles",
  plague:     "the sickness endures",
  aurora:     "the lights still dance",
  drought:    "no relief yet",
};

/** Fired when mote count first peaks at 60+ during complexity */
const PEAK_POPULATION_TEXTS = [
  "all of them, alive at once",
  "the world at its fullest",
  "never more than this",
  "the peak of everything",
];

/** Fired on the first mote death during dissolution — the unraveling begins */
const DISSOLUTION_FIRST_DEATH_TEXTS = [
  "the first farewell",
  "the first to let go",
  "one light goes out",
  "it begins",
];

/** Fired when bond count drops below half peak during dissolution */
const DISSOLUTION_BONDS_BREAKING_TEXTS = [
  "the bonds begin to fray",
  "they drift apart",
  "communities unraveling",
  "the ties grow thin",
];

/** Fired when only one mote remains */
const LAST_MOTE_TEXTS = [
  "one light remains",
  "the last wanderer",
  "alone at the end",
  "only one",
];

// --- State ---

interface NarrativeEvent {
  text: string;
  time: number;
  duration: number;
}

export interface NarrativeState {
  queue: NarrativeEvent[];
  lastTime: number;
  lastBondCount: number;
  lastPhaseIndex: number;
  phaseNarrated: boolean[];         // [6] — one flag per phase
  narratedFirstElder: boolean;
  narratedFirstBond: boolean;
  narratedPeakCluster: boolean;
  peakClusterSize: number;
  eventAnticipated: boolean;
  eventStartNarrated: boolean;
  eventWasActive: boolean;
  eventAftermathNarrated: boolean;
  eventCascadeNarrated: boolean;
  narratedPeakPopulation: boolean;
  narratedFirstDeath: boolean;
  narratedBondsBreaking: boolean;
  narratedLastMote: boolean;
  peakMoteCount: number;
  peakBondCount: number;
  el: HTMLElement | null;
}

export function createNarrative(): NarrativeState {
  return {
    queue: [],
    lastTime: -99,
    lastBondCount: 0,
    lastPhaseIndex: -1,
    phaseNarrated: [false, false, false, false, false, false],
    narratedFirstElder: false,
    narratedFirstBond: false,
    narratedPeakCluster: false,
    peakClusterSize: 0,
    eventAnticipated: false,
    eventStartNarrated: false,
    eventWasActive: false,
    eventAftermathNarrated: false,
    eventCascadeNarrated: false,
    narratedPeakPopulation: false,
    narratedFirstDeath: false,
    narratedBondsBreaking: false,
    narratedLastMote: false,
    peakMoteCount: 0,
    peakBondCount: 0,
    el: document.getElementById("narrative"),
  };
}

export function updateNarrative(ns: NarrativeState, w: World): void {
  if (!ns.el) return;

  // Reset on new cycle
  if (w.time < 1) {
    ns.phaseNarrated = [false, false, false, false, false, false];
    ns.narratedFirstElder = false;
    ns.narratedFirstBond = false;
    ns.narratedPeakCluster = false;
    ns.peakClusterSize = 0;
    ns.lastBondCount = 0;
    ns.lastPhaseIndex = -1;
    ns.eventAnticipated = false;
    ns.eventStartNarrated = false;
    ns.eventWasActive = false;
    ns.eventAftermathNarrated = false;
    ns.eventCascadeNarrated = false;
    ns.narratedPeakPopulation = false;
    ns.narratedFirstDeath = false;
    ns.narratedBondsBreaking = false;
    ns.narratedLastMote = false;
    ns.peakMoteCount = 0;
    ns.peakBondCount = 0;
    ns.queue = [];
    ns.el.textContent = "";
    ns.el.style.opacity = "0";
    return;
  }

  const now = w.time;

  // --- Phase entry narration (fires on phase change; bypasses cooldown) ---
  if (w.phaseIndex !== ns.lastPhaseIndex) {
    ns.lastPhaseIndex = w.phaseIndex;
    if (!ns.phaseNarrated[w.phaseIndex]) {
      ns.phaseNarrated[w.phaseIndex] = true;

      const pool = PHASE_ENTRY[w.phaseName];
      // Deterministic pick: cycle seed + phase offset
      const pick = Math.abs((w.cycleNumber * 1000003 + w.phaseIndex * 97) % pool.length);
      let text = pool[pick];

      // Genesis: weave in weather if notable
      if (w.phaseName === "genesis" && w.weather.type !== "clear") {
        const weatherGenesis: Partial<Record<string, string>> = {
          rain:     "rain falls on a waking world",
          storm:    "a storm greets the waking world",
          snow:     "snow settles on new ground",
          overcast: "clouds gather as the world stirs",
          fog:      "fog shrouds the first breath",
        };
        text = weatherGenesis[w.weather.type] ?? text;
      }

      pushNarrative(ns, text, now, true);
    }

    // Event cascade: if a rare event is actively ongoing during this phase transition,
    // acknowledge it — the event has outlasted the phase that witnessed it
    if (
      w.event &&
      w.eventTriggered &&
      isEventActive(w.event, w.time) &&
      !ns.eventCascadeNarrated
    ) {
      ns.eventCascadeNarrated = true;
      const cascadeText = EVENT_CASCADE_TEXTS[w.event.type];
      if (cascadeText) {
        // Push directly so it queues after the phase entry text
        ns.queue.push({ text: cascadeText, time: now, duration: 5 });
      }
    }
  }

  // --- Milestone narration (respect 6s cooldown) ---
  const canNarrate = now - ns.lastTime >= 6;
  if (!canNarrate) {
    displayNarrative(ns, now);
    return;
  }

  let bondCount = 0;
  for (const m of w.motes) bondCount += m.bonds.length;
  bondCount = Math.floor(bondCount / 2);

  // Track peaks
  if (w.motes.length > ns.peakMoteCount) ns.peakMoteCount = w.motes.length;
  if (bondCount > ns.peakBondCount) ns.peakBondCount = bondCount;

  // First bond
  if (!ns.narratedFirstBond && bondCount > 0) {
    ns.narratedFirstBond = true;
    pushNarrative(ns, "the first bond forms", now);
  }

  // First elder
  if (!ns.narratedFirstElder) {
    for (const m of w.motes) {
      if (m.age > 20) {
        ns.narratedFirstElder = true;
        pushNarrative(ns, "an elder endures", now);
        break;
      }
    }
  }

  // Peak cluster milestone — "a great gathering" when cluster ≥ 6
  let maxCluster = 0;
  for (const c of w.clusters) if (c.length > maxCluster) maxCluster = c.length;
  if (maxCluster > ns.peakClusterSize) ns.peakClusterSize = maxCluster;

  if (
    !ns.narratedPeakCluster &&
    ns.peakClusterSize >= 6 &&
    w.phaseName !== "dissolution" &&
    w.phaseName !== "silence"
  ) {
    ns.narratedPeakCluster = true;
    pushNarrative(ns, "a great gathering", now);
  }

  // Peak population — narrate when mote count first hits 60 during complexity
  if (
    !ns.narratedPeakPopulation &&
    w.motes.length >= 60 &&
    w.phaseName === "complexity"
  ) {
    ns.narratedPeakPopulation = true;
    const pick = Math.abs((w.cycleNumber * 999937) % PEAK_POPULATION_TEXTS.length);
    pushNarrative(ns, PEAK_POPULATION_TEXTS[pick], now);
  }

  // Dissolution: narrate the first mote death — the unraveling's opening beat
  if (
    !ns.narratedFirstDeath &&
    (w.phaseName === "dissolution" || w.phaseName === "silence") &&
    w.deaths.length > 0
  ) {
    ns.narratedFirstDeath = true;
    const pick = Math.abs((w.cycleNumber * 999931) % DISSOLUTION_FIRST_DEATH_TEXTS.length);
    pushNarrative(ns, DISSOLUTION_FIRST_DEATH_TEXTS[pick], now);
  }

  // Dissolution: narrate when bonds drop below half their peak (community fragmenting)
  if (
    !ns.narratedBondsBreaking &&
    ns.peakBondCount > 4 &&
    bondCount < Math.floor(ns.peakBondCount * 0.45) &&
    w.phaseName === "dissolution"
  ) {
    ns.narratedBondsBreaking = true;
    const pick = Math.abs((w.cycleNumber * 999929) % DISSOLUTION_BONDS_BREAKING_TEXTS.length);
    pushNarrative(ns, DISSOLUTION_BONDS_BREAKING_TEXTS[pick], now);
  }

  // Last mote — the final witness
  if (
    !ns.narratedLastMote &&
    w.motes.length === 1 &&
    (w.phaseName === "dissolution" || w.phaseName === "silence")
  ) {
    ns.narratedLastMote = true;
    const pick = Math.abs((w.cycleNumber * 999923) % LAST_MOTE_TEXTS.length);
    pushNarrative(ns, LAST_MOTE_TEXTS[pick], now);
  }

  // --- Event anticipation (~25s before trigger) ---
  if (w.event && !w.eventTriggered && !ns.eventAnticipated) {
    const triggerProgress = getEventTriggerPoint(w.event.type);
    const timeUntilTrigger = (triggerProgress - w.cycleProgress) * CYCLE_DURATION;
    if (timeUntilTrigger > 0 && timeUntilTrigger < 28) {
      ns.eventAnticipated = true;
      const pick = Math.abs((w.cycleNumber * 999983) % ANTICIPATION_TEXTS.length);
      pushNarrative(ns, ANTICIPATION_TEXTS[pick], now);
    }
  }

  // --- Event start narration ---
  if (w.event && w.eventTriggered && isEventActive(w.event, w.time) && !ns.eventStartNarrated) {
    const elapsed = w.time - w.event.startTime;
    if (elapsed >= 0 && elapsed < 1) {
      ns.eventStartNarrated = true;
      ns.eventWasActive = true;
      const text = EVENT_START_TEXTS[w.event.type];
      if (text) pushNarrative(ns, text, now);
    }
  }

  // --- Event aftermath narration ---
  if (
    ns.eventWasActive &&
    !ns.eventAftermathNarrated &&
    w.event &&
    w.eventTriggered &&
    !isEventActive(w.event, w.time)
  ) {
    ns.eventAftermathNarrated = true;
    const pool = EVENT_AFTERMATH[w.event.type];
    if (pool) {
      const pick = Math.abs((w.cycleNumber * 999979) % pool.length);
      pushNarrative(ns, pool[pick], now);
    }
  }

  ns.lastBondCount = bondCount;
  displayNarrative(ns, now);
}

// --- Helpers ---

function pushNarrative(
  ns: NarrativeState,
  text: string,
  now: number,
  force = false,
): void {
  if (!force && now - ns.lastTime < 6) return;
  // Avoid duplicating the last queued text
  if (ns.queue.length > 0 && ns.queue[ns.queue.length - 1].text === text) return;
  ns.queue.push({ text, time: now, duration: 5 });
  ns.lastTime = now;
}

function displayNarrative(ns: NarrativeState, now: number): void {
  if (!ns.el || ns.queue.length === 0) return;
  const current = ns.queue[0];
  const age = now - current.time;

  if (age > current.duration) {
    ns.queue.shift();
    ns.el.style.opacity = "0";
    // Reset the next item's start time so it always gets its full display window
    if (ns.queue.length > 0) {
      ns.queue[0].time = now;
    }
  } else if (age < 0.8) {
    ns.el.textContent = current.text;
    ns.el.style.opacity = String(Math.min(1, age / 0.8));
  } else if (age > current.duration - 1) {
    ns.el.style.opacity = String(Math.max(0, current.duration - age));
  } else {
    ns.el.style.opacity = "1";
  }
}
