// narrative.ts — Ambient story moments. Phase arc, milestones, event drama.

import type { World, PhaseName, Biome, Mote } from "./types";
import { isEventActive, getEventTriggerPoint } from "./events";
import { W, CYCLE_DURATION } from "./config";

// --- Narrative pools ---

/** Generic phase entry texts — biome overrides take precedence when available */
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
    "what was here, was real",
    "the echo of everything",
  ],
};

/**
 * Biome-specific phase entry overrides — all 6 phases, all 5 biomes.
 * When a biome has text for the current phase, use that pool instead of generic.
 */
const BIOME_PHASE_ENTRY: Partial<Record<Biome, Partial<Record<PhaseName, string[]>>>> = {
  temperate: {
    genesis:      ["something stirs in the quiet", "the world opens gently", "neither fire nor ice — just this"],
    exploration:  ["they wander without urgency", "the gentle world spreads wide", "curiosity in all directions"],
    organization: ["they settle where the ground is kind", "a place among other places", "community in the ordinary"],
    complexity:   ["this world holds more than it shows", "deep roots in familiar ground", "the everyday made extraordinary"],
    dissolution:  ["things end as they began — quietly", "the ordinary world lets go", "a gentle unraveling"],
    silence:      ["the quiet world rests", "back to what it was", "familiar, and gone"],
  },
  volcanic: {
    genesis:      ["fire touches the first light", "ash and awakening", "the mountain opens its eye"],
    exploration:  ["they brave the heat", "curiosity stronger than the ash", "the lava fields call them"],
    organization: ["bonds form in the fire", "they cluster against the heat", "the mountain watches them gather"],
    complexity:   ["life at its most defiant", "thriving in the impossible heat", "the caldera's richest hour"],
    dissolution:  ["fire takes what fire made", "the mountain reclaims its own", "returning to ash"],
    silence:      ["embers settle", "the caldera rests", "only the smoke remembers"],
  },
  desert: {
    genesis:      ["heat rises on a waking world", "the silence wakes", "sand remembers nothing"],
    exploration:  ["the vast emptiness calls", "they scatter like wind-seeds", "the dunes offer no shelter"],
    organization: ["they shelter in each other", "clusters against the vast", "the desert allows a few to gather"],
    complexity:   ["more alive than the sand expected", "the most this silence has ever held"],
    dissolution:  ["heat claims the last light", "the sand was always here", "the desert outlasts all of them"],
    silence:      ["the desert outlasts everything", "the dunes shift and forget"],
  },
  tundra: {
    genesis:      ["cold greets the first stir", "frost on the first breath", "ice remembers everything"],
    exploration:  ["the cold does not welcome them", "they seek warmth across open ice"],
    organization: ["warmth found in each other", "the cold drives them together", "shelter in the open white"],
    complexity:   ["thriving in the impossible cold", "the tundra's fullest hour", "more than ice expected of them"],
    dissolution:  ["winter closes over them", "the cold was always patient"],
    silence:      ["only ice endures", "the tundra smooths everything flat"],
  },
  lush: {
    genesis:      ["life wakes hungry for itself", "abundance stirs", "the green world begins"],
    exploration:  ["abundance calls in all directions", "they scatter into the plenty", "too much world to see at once"],
    organization: ["the green world gathers its own", "roots in the overgrowth", "finding home in abundance"],
    complexity:   ["the world overflows", "life beyond counting", "a full and living place"],
    dissolution:  ["even the green things fade", "plenty yields to quiet"],
    silence:      ["green returns to seed", "the forest holds the memory"],
  },
};

/** Fired ~25s before a rare event begins — anticipation without spoilers */
const ANTICIPATION_TEXTS = [
  "something stirs",
  "the air shifts",
  "a change approaches",
  "the world holds its breath",
];

/** Narrative text when an event starts — generic fallback */
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

/**
 * Biome-specific event start overrides.
 * A flood in a desert, a drought in a lush world — these deserve their own words.
 */
const BIOME_EVENT_START: Partial<Record<Biome, Partial<Record<string, string>>>> = {
  desert: {
    flood:   "the desert drinks deep",
    bloom:   "impossible — and beautiful",
    drought: "the last water dreams of sky",
    aurora:  "the sky burns twice",
  },
  volcanic: {
    bloom:   "life defies the ash",
    flood:   "lava meets the tide",
    aurora:  "fire and sky conspire",
    plague:  "something in the smoke",
    drought: "even the lava pools dry",
  },
  tundra: {
    bloom:   "color cracks the frozen ground",
    drought: "the cold wind takes the last moisture",
    aurora:  "the sky is speaking",
    flood:   "the ice breaks open",
  },
  lush: {
    drought: "the green things wither",
    flood:   "the river remembers its width",
    plague:  "sickness moves through the abundance",
    eclipse: "even paradise goes dark",
  },
};

/**
 * Weather + event overlap lines.
 * When weather is notable at the moment an event triggers, this extra line
 * is queued after the event start text.
 */
const WEATHER_EVENT_OVERLAP: Partial<Record<string, Partial<Record<string, string>>>> = {
  storm: {
    flood:      "storm and flood — the world drowns",
    earthquake: "sky and earth break together",
    eclipse:    "darkness and lightning both",
    migration:  "they march into the storm",
  },
  rain: {
    drought:    "even the rain cannot save it",
    bloom:      "the rain feeds everything",
    plague:     "sickness rides the rain",
  },
  snow: {
    bloom:      "flowers push through the snow",
    drought:    "cold and dry — a strange thirst",
    eclipse:    "white world, dark sky",
  },
  fog: {
    migration:  "they vanish into the fog",
    eclipse:    "darkness within the darkness",
    plague:     "the sickness hides in the fog",
  },
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

/**
 * Silence-phase opener when the cycle had a defining event.
 * These replace the generic silence lines so the world remembers what happened.
 */
const EVENT_SILENCE_EPITAPHS: Partial<Record<string, string[]>> = {
  plague:     ["the sick and the saved, both quiet now", "survival is its own silence"],
  bloom:      ["the colors still breathe, somewhere", "abundance returned to seed"],
  meteor:     ["the crater holds the memory", "silence shaped by fire"],
  eclipse:    ["the light came back — then this", "even darkness passes"],
  flood:      ["the tide went where tides go", "the waterline has forgotten"],
  drought:    ["the thirst passed with them", "the dry land settles"],
  earthquake: ["the ground is still now", "the breaking is over"],
  aurora:     ["the lights knew how to leave", "beauty passes without apology"],
  migration:  ["they went — this is what remains", "the path empties both ways"],
};

/**
 * Biome-specific event aftermath overrides.
 * What lingers after each event shifts per landscape — a flood in desert
 * feels nothing like a flood in tundra.
 */
const BIOME_EVENT_AFTERMATH: Partial<Record<Biome, Partial<Record<string, string>>>> = {
  desert: {
    flood:     "the sand drinks the last of it",
    bloom:     "the petals dry quickly here",
    drought:   "the desert reclaims itself",
    meteor:    "the dune will swallow the crater",
    plague:    "the wind scatters what remained",
  },
  volcanic: {
    flood:     "the lava hardens around the memory",
    bloom:     "ash and petal, together",
    drought:   "the fire remembers the dryness",
    meteor:    "one fire met another",
    aurora:    "fire and sky conspired, then parted",
  },
  tundra: {
    flood:     "the ice cracks hold the waterline",
    bloom:     "petals freeze where they fell",
    drought:   "cold and dry — a strange thirst remains",
    aurora:    "the light folded back into the sky",
    meteor:    "the crater fills with frost",
  },
  lush: {
    drought:   "the green slowly remembers",
    plague:    "the forest is quieter now",
    flood:     "the river knows its banks again",
    bloom:     "more than enough — always",
  },
};

/** Fired when mote count drops to ≤50% of peak during dissolution — the mid-arc reckoning */
const DISSOLUTION_HALF_GONE_TEXTS = [
  "half are gone",
  "the world grows quieter",
  "fewer now",
  "the balance tips toward silence",
];

/** Fired if peak cluster reached 4–5 but never 6 — they almost made something great */
const NEAR_MISS_TEXTS = [
  "so close to something more",
  "almost a great gathering",
  "they were almost enough",
  "nearly — but not quite",
];

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

/** Fired when the first cluster of 3+ forms — settlement becoming possible */
const FIRST_CLUSTER_TEXTS = [
  "roots take hold",
  "a place becomes home",
  "the first hearth",
  "here — they choose here",
];

/** Fired when the last mote dies and the world falls empty */
const EMPTY_WORLD_TEXTS = [
  "gone, all of them",
  "the world holds its breath",
  "what was here, was real",
  "the silence is complete",
];

/**
 * Fired when the same cluster of 3+ motes persists for 30+ seconds.
 * Text varies by centroid position (west / center / east).
 */
function clusterEnduranceText(centroidX: number, cycleNumber: number): string {
  const pos = centroidX / W;
  if (pos < 0.35) {
    const pool = ["to the west, they hold", "the western few endure", "something holds in the west"];
    return pool[Math.abs(cycleNumber * 7919) % pool.length];
  } else if (pos > 0.65) {
    const pool = ["to the east, they hold", "the eastern few endure", "something holds in the east"];
    return pool[Math.abs(cycleNumber * 8191) % pool.length];
  } else {
    const pool = ["the center holds", "they refuse to let go", "together still", "something persists"];
    return pool[Math.abs(cycleNumber * 9001) % pool.length];
  }
}

/**
 * Fired during dissolution when the named cluster (that held for 30s+) finally breaks apart.
 * Uses the same positional logic as clusterEnduranceText — the farewell mirrors the welcome.
 */
function clusterFarewellText(pos: "west" | "center" | "east", cycleNumber: number): string {
  if (pos === "west") {
    const pool = ["the western few have gone", "the west has let go", "what held in the west is scattered"];
    return pool[Math.abs(cycleNumber * 6271) % pool.length];
  } else if (pos === "east") {
    const pool = ["the eastern few have gone", "the east has let go", "what held in the east is scattered"];
    return pool[Math.abs(cycleNumber * 7331) % pool.length];
  } else {
    const pool = ["the center could not hold", "what gathered there is gone", "the heart of it empties"];
    return pool[Math.abs(cycleNumber * 8221) % pool.length];
  }
}

/** Silence opener when no bonds ever formed — a lonely cycle */
const SILENCE_LONELY_TEXTS = [
  "a world that never bonded",
  "each one passed alone",
  "they were here, but never together",
  "the silence of strangers",
];

/** Silence opener when many motes survived into the ending */
const SILENCE_SURVIVORS_TEXTS = [
  "so many outlasted the ending",
  "the cycle found them still here",
  "they held on longer than most",
  "a stubborn world",
];

/** Silence opener when an elder mote is still alive */
const SILENCE_ELDER_TEXTS = [
  "an elder saw it all",
  "there is one who remembers",
  "the last witness endures",
  "the oldest one carries it forward",
];

/**
 * Second silence beat — fires ~8 seconds after silence entry.
 * Generic fallback; biome overrides take precedence.
 */
const SILENCE_SECOND_BEAT = [
  "this, too, will be the past",
  "the world holds the shape of what was",
  "it was enough",
  "something is always left",
];

/** Per-biome second beat — the silence has settled; what does the world notice? */
const BIOME_SILENCE_SECOND_BEAT: Partial<Record<Biome, string[]>> = {
  temperate: [
    "the quiet keeps its own time",
    "this is what remains of it",
    "the ordinary holds its shape",
  ],
  volcanic: [
    "the caldera is still",
    "only smoke remembers",
    "the ash will settle flat",
  ],
  desert: [
    "the sand has always been here",
    "the dunes will not remember them",
    "silence deeper than the heat",
  ],
  tundra: [
    "the ice keeps what the warm could not",
    "cold is the last record",
    "the frost holds nothing",
  ],
  lush: [
    "seeds in the silence",
    "the green will return to this",
    "the forest is already forgetting",
  ],
};

/** Biome-aware half-gone lines — what takes them differs per landscape */
const BIOME_DISSOLUTION_HALF_GONE: Partial<Record<Biome, string[]>> = {
  volcanic: ["ash takes the rest", "the caldera empties", "fire claims the last of them"],
  tundra:   ["the cold takes them one by one", "winter outpaces them now"],
  desert:   ["the sun outpaces them", "the vast silence wins"],
  lush:     ["even abundance empties", "the green world thins"],
};

/** Biome-aware bonds-breaking lines */
const BIOME_DISSOLUTION_BONDS_BREAKING: Partial<Record<Biome, string[]>> = {
  volcanic: ["the heat undoes everything", "fire claims what fire made"],
  tundra:   ["cold drives them apart", "ice accepts no bonds"],
  desert:   ["the vast undoes the close", "distance returns"],
  lush:     ["even the green world unravels", "abundance cannot hold them"],
};

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
  narratedFirstCluster: boolean;
  narratedEmptyWorld: boolean;
  narratedHalfGone: boolean;
  narratedNearMiss: boolean;
  peakMoteCount: number;
  peakBondCount: number;
  // Cluster identity tracking
  trackedClusterMotes: Mote[] | null;
  trackedClusterStart: number;
  narratedClusterIdentity: boolean;
  clusterFarewellPos: "west" | "center" | "east" | null;
  narratedClusterFarewell: boolean;
  narratedSilenceSecondBeat: boolean;
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
    narratedFirstCluster: false,
    narratedEmptyWorld: false,
    narratedHalfGone: false,
    narratedNearMiss: false,
    peakMoteCount: 0,
    peakBondCount: 0,
    trackedClusterMotes: null,
    trackedClusterStart: 0,
    narratedClusterIdentity: false,
    clusterFarewellPos: null,
    narratedClusterFarewell: false,
    narratedSilenceSecondBeat: false,
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
    ns.narratedFirstCluster = false;
    ns.narratedEmptyWorld = false;
    ns.narratedHalfGone = false;
    ns.narratedNearMiss = false;
    ns.peakMoteCount = 0;
    ns.peakBondCount = 0;
    ns.trackedClusterMotes = null;
    ns.trackedClusterStart = 0;
    ns.narratedClusterIdentity = false;
    ns.clusterFarewellPos = null;
    ns.narratedClusterFarewell = false;
    ns.narratedSilenceSecondBeat = false;
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

      // Biome-specific override takes precedence over generic pool
      const biomePool = BIOME_PHASE_ENTRY[w.terrain.biome]?.[w.phaseName];
      const pool = biomePool ?? PHASE_ENTRY[w.phaseName];
      const pick = Math.abs((w.cycleNumber * 1000003 + w.phaseIndex * 97) % pool.length);
      let text = pool[pick];

      // Weather overlay for genesis — only if we fell back to generic pool
      if (!biomePool && w.phaseName === "genesis" && w.weather.type !== "clear") {
        const weatherGenesis: Partial<Record<string, string>> = {
          rain:     "rain falls on a waking world",
          storm:    "a storm greets the waking world",
          snow:     "snow settles on new ground",
          overcast: "clouds gather as the world stirs",
          fog:      "fog shrouds the first breath",
        };
        text = weatherGenesis[w.weather.type] ?? text;
      }

      // Silence opener: event epitaph first, then cycle-quality variants, then biome/generic
      if (w.phaseName === "silence") {
        if (w.event && w.eventTriggered) {
          const epitaphPool = EVENT_SILENCE_EPITAPHS[w.event.type];
          if (epitaphPool) {
            const epitaphPick = Math.abs((w.cycleNumber * 999977) % epitaphPool.length);
            text = epitaphPool[epitaphPick];
          }
        } else if (ns.peakBondCount === 0 && ns.peakMoteCount >= 5) {
          // No bonds ever formed — lonely cycle
          const pick2 = Math.abs((w.cycleNumber * 999971) % SILENCE_LONELY_TEXTS.length);
          text = SILENCE_LONELY_TEXTS[pick2];
        } else if (
          w.motes.length >= Math.max(3, Math.floor(ns.peakMoteCount * 0.25)) &&
          ns.peakMoteCount >= 10
        ) {
          // Many motes survived into silence
          const pick3 = Math.abs((w.cycleNumber * 999967) % SILENCE_SURVIVORS_TEXTS.length);
          text = SILENCE_SURVIVORS_TEXTS[pick3];
        } else if (w.motes.some(m => m.age > 25)) {
          // An elder is still alive at silence
          const pick4 = Math.abs((w.cycleNumber * 999961) % SILENCE_ELDER_TEXTS.length);
          text = SILENCE_ELDER_TEXTS[pick4];
        }
        // else: use the biome/generic pool text already selected
      }

      pushNarrative(ns, text, now, true);
    }

    // Event cascade: if a rare event is actively ongoing during this phase transition
    if (
      w.event &&
      w.eventTriggered &&
      isEventActive(w.event, w.time) &&
      !ns.eventCascadeNarrated
    ) {
      ns.eventCascadeNarrated = true;
      const cascadeText = EVENT_CASCADE_TEXTS[w.event.type];
      if (cascadeText) {
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

  // Cluster tracking
  let maxCluster = 0;
  for (const c of w.clusters) if (c.length > maxCluster) maxCluster = c.length;
  if (maxCluster > ns.peakClusterSize) ns.peakClusterSize = maxCluster;

  // First cluster of 3 — roots taking hold, a settlement could form
  if (
    !ns.narratedFirstCluster &&
    maxCluster >= 3 &&
    (w.phaseName === "organization" || w.phaseName === "complexity")
  ) {
    ns.narratedFirstCluster = true;
    const pick = Math.abs((w.cycleNumber * 999911) % FIRST_CLUSTER_TEXTS.length);
    pushNarrative(ns, FIRST_CLUSTER_TEXTS[pick], now);
  }

  // Peak cluster milestone — "a great gathering" when cluster ≥ 6
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

  // Cluster identity: track the same large cluster over time
  // Fires when a cluster of 3+ holds together for 30+ seconds
  if (
    !ns.narratedClusterIdentity &&
    (w.phaseName === "organization" || w.phaseName === "complexity")
  ) {
    // Find the largest cluster of 3+
    let largest: Mote[] | null = null;
    for (const c of w.clusters) {
      if (c.length >= 3 && (!largest || c.length > largest.length)) largest = c;
    }

    if (largest) {
      if (!ns.trackedClusterMotes) {
        // Start tracking a new large cluster
        ns.trackedClusterMotes = largest;
        ns.trackedClusterStart = now;
      } else {
        // Measure continuity: how many motes from the tracked cluster are still here?
        const prevSet = new Set(ns.trackedClusterMotes);
        let overlap = 0;
        for (const m of largest) if (prevSet.has(m)) overlap++;
        const continuity = overlap / Math.min(largest.length, ns.trackedClusterMotes.length);

        if (continuity >= 0.6) {
          // Same cluster — update membership, keep start time
          ns.trackedClusterMotes = largest;
          // Fire if it's been 30 seconds
          if (now - ns.trackedClusterStart >= 30) {
            ns.narratedClusterIdentity = true;
            let cx = 0;
            for (const m of largest) cx += m.x;
            cx /= largest.length;
            // Record position for the farewell line when this cluster eventually breaks
            const fpos = cx / W;
            ns.clusterFarewellPos = fpos < 0.35 ? "west" : fpos > 0.65 ? "east" : "center";
            pushNarrative(ns, clusterEnduranceText(cx, w.cycleNumber), now);
          }
        } else {
          // Different cluster — restart tracking
          ns.trackedClusterMotes = largest;
          ns.trackedClusterStart = now;
        }
      }
    } else {
      // No large cluster — clear tracking
      ns.trackedClusterMotes = null;
    }
  }

  // Dissolution: first death — the unraveling's opening beat
  if (
    !ns.narratedFirstDeath &&
    (w.phaseName === "dissolution" || w.phaseName === "silence") &&
    w.deaths.length > 0
  ) {
    ns.narratedFirstDeath = true;
    const pick = Math.abs((w.cycleNumber * 999931) % DISSOLUTION_FIRST_DEATH_TEXTS.length);
    pushNarrative(ns, DISSOLUTION_FIRST_DEATH_TEXTS[pick], now);
  }

  // Dissolution: bonds fragmenting
  if (
    !ns.narratedBondsBreaking &&
    ns.peakBondCount > 4 &&
    bondCount < Math.floor(ns.peakBondCount * 0.45) &&
    w.phaseName === "dissolution"
  ) {
    ns.narratedBondsBreaking = true;
    const biomeBonds = BIOME_DISSOLUTION_BONDS_BREAKING[w.terrain.biome];
    if (biomeBonds) {
      const pick = Math.abs((w.cycleNumber * 999929) % biomeBonds.length);
      pushNarrative(ns, biomeBonds[pick], now);
    } else {
      const pick = Math.abs((w.cycleNumber * 999929) % DISSOLUTION_BONDS_BREAKING_TEXTS.length);
      pushNarrative(ns, DISSOLUTION_BONDS_BREAKING_TEXTS[pick], now);
    }
  }

  // Dissolution: half gone — the world has lost half its peak population
  if (
    !ns.narratedHalfGone &&
    ns.peakMoteCount >= 8 &&
    w.motes.length > 0 &&
    w.motes.length <= Math.floor(ns.peakMoteCount * 0.5) &&
    w.phaseName === "dissolution"
  ) {
    ns.narratedHalfGone = true;
    const biomeHalfGone = BIOME_DISSOLUTION_HALF_GONE[w.terrain.biome];
    if (biomeHalfGone) {
      const pick = Math.abs((w.cycleNumber * 999901) % biomeHalfGone.length);
      pushNarrative(ns, biomeHalfGone[pick], now);
    } else {
      const pick = Math.abs((w.cycleNumber * 999901) % DISSOLUTION_HALF_GONE_TEXTS.length);
      pushNarrative(ns, DISSOLUTION_HALF_GONE_TEXTS[pick], now);
    }
  }

  // Near-miss: peak cluster was 4–5 but never reached 6 — acknowledge the almost
  if (
    !ns.narratedNearMiss &&
    ns.peakClusterSize >= 4 &&
    ns.peakClusterSize < 6 &&
    !ns.narratedPeakCluster &&
    w.phaseName === "dissolution" &&
    w.motes.length < ns.peakMoteCount * 0.7
  ) {
    ns.narratedNearMiss = true;
    const pick = Math.abs((w.cycleNumber * 999889) % NEAR_MISS_TEXTS.length);
    pushNarrative(ns, NEAR_MISS_TEXTS[pick], now);
  }

  // Cluster farewell — when the named cluster (30s+ endurance) finally breaks apart
  if (
    !ns.narratedClusterFarewell &&
    ns.narratedClusterIdentity &&
    ns.clusterFarewellPos !== null &&
    w.phaseName === "dissolution" &&
    maxCluster < 3
  ) {
    ns.narratedClusterFarewell = true;
    pushNarrative(ns, clusterFarewellText(ns.clusterFarewellPos, w.cycleNumber), now);
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

  // Empty world — the world has fully emptied
  if (
    !ns.narratedEmptyWorld &&
    w.motes.length === 0 &&
    (w.phaseName === "dissolution" || w.phaseName === "silence")
  ) {
    ns.narratedEmptyWorld = true;
    const pick = Math.abs((w.cycleNumber * 999907) % EMPTY_WORLD_TEXTS.length);
    pushNarrative(ns, EMPTY_WORLD_TEXTS[pick], now);
  }

  // Second silence beat — ~8 seconds after silence entry, the world settles into itself
  if (
    !ns.narratedSilenceSecondBeat &&
    w.phaseName === "silence" &&
    w.phaseProgress >= 0.33
  ) {
    ns.narratedSilenceSecondBeat = true;
    const biomePool = BIOME_SILENCE_SECOND_BEAT[w.terrain.biome];
    const pool = biomePool ?? SILENCE_SECOND_BEAT;
    const pick = Math.abs((w.cycleNumber * 999859) % pool.length);
    pushNarrative(ns, pool[pick], now);
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
      // Biome-specific override, then generic
      const biomeText = BIOME_EVENT_START[w.terrain.biome]?.[w.event.type];
      const text = biomeText ?? EVENT_START_TEXTS[w.event.type];
      if (text) pushNarrative(ns, text, now);

      // Weather-event overlap — queue an extra line if weather makes this more dramatic
      const overlapText = WEATHER_EVENT_OVERLAP[w.weather.type]?.[w.event.type];
      if (overlapText) {
        ns.queue.push({ text: overlapText, time: now, duration: 5 });
      }
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
    // Biome-specific aftermath takes precedence over generic pool
    const biomeAftermath = BIOME_EVENT_AFTERMATH[w.terrain.biome]?.[w.event.type];
    if (biomeAftermath) {
      pushNarrative(ns, biomeAftermath, now);
    } else {
      const pool = EVENT_AFTERMATH[w.event.type];
      if (pool) {
        const pick = Math.abs((w.cycleNumber * 999979) % pool.length);
        pushNarrative(ns, pool[pick], now);
      }
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
