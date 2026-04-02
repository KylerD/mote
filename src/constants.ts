// constants.ts — Centralized tuning constants.
// Organized by domain so behavioral parameters are discoverable and tweakable.

// ---- Physics ----
export const GRAVITY = 60;
export const MAX_FALL = 60;
export const WALK_SPEED = 14;
export const JUMP_OVER = 4;

// ---- Spatial ----
export const CELL_SIZE = 20;
export const NEIGHBOR_RADIUS = 28;
export const LOOKAHEAD_DISTANCE = 3;

// ---- Bonding ----
export const BOND_DIST = 20;
export const BOND_TIME = 1.2;
export const MAX_BONDS = 3;
export const BOND_COMFORTABLE_DISTANCE = 0.5;
export const BOND_BREAK_DISTANCE_MULT = 6;
export const BOND_FORMATION_ENERGY_GAIN = 0.03;
export const BOND_TIMER_DECAY_RATE = 0.3;
export const ANCIENT_BOND_AGE = 70;

// ---- Lifecycle ----
export const AGE_MATURE = 8;
export const AGE_ELDER = 20;
export const MATURE_SPEED_MOD = 0.92;
export const ELDER_SPEED_MOD = 0.82;
export const ELDER_BOND_BREAK_MULT = 1.4;

// ---- Movement ----
export const WALK_SPEED_BASE = 0.5;
export const WALK_SPEED_WANDERLUST = 0.8;
export const SAND_SPEED = 0.7;
export const CANOPY_SPEED = 0.85;
export const CAVE_SPEED = 0.6;
export const SHALLOW_WATER_SPEED = 0.5;
export const DIRECTION_CHANGE_RATE = 0.02;

// ---- Social forces ----
export const SOCIAL_ATTRACT_DIST = 12;
export const SOCIAL_ATTRACT_STRENGTH = 4;
export const REPULSION_DIST = 12;
export const REPULSION_STRENGTH = 30;
export const SOCIAL_FORCE_CLAMP = 10;
export const ELDER_ATTRACT_STRENGTH = 2;
export const BONDED_ATTRACT_STRENGTH = 4;

// ---- Energy ----
export const ENERGY_TRANSFER_BASE = 0.05;
export const ENERGY_TRANSFER_SOCIAL = 0.04;
export const NUTRIENT_GAIN_RATE = 0.02;
export const HAZARD_DRAIN_RATE = 0.03;
export const HARDINESS_RESIST = 0.4;
export const ENERGY_DECAY_HARDINESS = 0.4;
export const ENERGY_DECAY_WANDERLUST = 0.3;

// ---- Wanderer frenzy ----
export const FRENZY_ENERGY_THRESHOLD = 0.3;
export const FRENZY_MAX_MULT = 4;

// ---- Dying behavior ----
export const DYING_ENERGY_THRESHOLD = 0.3;
export const DYING_BOND_SEEK_DIST = 5;
export const DYING_BOND_SEEK_FORCE = 20;
export const DYING_SOCIAL_BOOST = 2;

// ---- Flash decay rates ----
export const SPAWN_FLASH_DECAY = 3;
export const BOND_FLASH_DECAY = 3;
export const BOND_BREAK_FLASH_DECAY = 2.5;
export const INHERIT_FLASH_DECAY = 0.65;
export const MOURNING_FLASH_DECAY = 0.5;
export const CLUSTER_MERGE_FLASH_DECAY = 1.8;
export const ANCIENT_BOND_FLASH_DECAY = 0.7;
export const HARDINESS_FLASH_GAIN = 6;
export const HARDINESS_FLASH_DECAY = 4;

// ---- Trail ----
export const TRAIL_AGE_WINDOW = 30;
export const TRAIL_BASE_INTERVAL = 0.08;
export const TRAIL_INTERVAL_RANGE = 0.07;
export const TRAIL_MIN_LENGTH = 12;
export const TRAIL_LENGTH_FACTOR = 33;
export const TRAIL_MIN_LIFETIME = 1.5;
export const TRAIL_LIFETIME_BASE = 1.5;
export const TRAIL_LIFETIME_ELDER = 3.0;

// ---- Hardy flash thresholds ----
export const HARDY_FLASH_TILE_THRESHOLD = -0.1;
export const HARDY_FLASH_MIN_HARDINESS = 0.45;

// ---- Curiosity facing ----
export const CURIOSITY_FACING_MIN_TIMER = 0.1;

// ---- World / Phases ----
export const PHASE_DURATIONS = [0.10, 0.20, 0.25, 0.25, 0.12, 0.08] as const;
export const RNG_SEED_OFFSET = 7777;
export const SPAWN_ATTEMPTS = 10;
export const SPAWN_ENERGY_MIN = 0.4;
export const SPAWN_ENERGY_RANGE = 0.4;
export const SETTLEMENT_INTERVAL = 3;
export const SETTLEMENT_MIN_CLUSTER = 3;
export const DEATH_RECORD_LIFETIME = 7.5;
export const INHERIT_RADIUS_BASE = 55;
export const INHERIT_RADIUS_AGE_MAX = 25;
export const INHERIT_RADIUS_AGE_MULT = 1.5;
export const CLUSTER_MOURNING_PERIPHERAL = 0.55;
export const WANDERER_TRAIL_THRESHOLD = 0.6;
export const DEATH_COLOR_ENERGY = 0.4;
export const AGE_GOLD_START = 8;
export const AGE_GOLD_WINDOW = 22;
export const AGE_GOLD_STRENGTH = 0.40;
export const MAX_SPEED_MULTIPLIER = 120;

// Phase params table (indexed by phase)
export const PHASE_PARAMS = [
  { spawnRate: 4,  maxMotes: 20, energyDecay: 0.008, bondStrength: 0.3 },
  { spawnRate: 3,  maxMotes: 45, energyDecay: 0.012, bondStrength: 0.5 },
  { spawnRate: 2,  maxMotes: 60, energyDecay: 0.015, bondStrength: 0.8 },
  { spawnRate: 2,  maxMotes: 70, energyDecay: 0.018, bondStrength: 0.9 },
  { spawnRate: 0,  maxMotes: 70, energyDecay: 0.04,  bondStrength: 0.3 },
  { spawnRate: 0,  maxMotes: 70, energyDecay: 0.07,  bondStrength: 0.1 },
] as const;

// ---- Events ----
export const EVENT_FREQUENCY = 12;
export const EVENT_MESSAGE_DISPLAY = 3;
export const EVENT_MESSAGE_FADE = 2;

export const EVENT_DURATIONS: Record<string, number> = {
  flood: 28, bloom: 15, meteor: 8, migration: 22, eclipse: 28,
  earthquake: 12, plague: 32, aurora: 22, drought: 48,
};

export const EVENT_TRIGGER_POINTS: Record<string, number> = {
  flood: 0.40, bloom: 0.50, meteor: 0.60, migration: 0.55, eclipse: 0.65,
  earthquake: 0.45, plague: 0.50, aurora: 0.70, drought: 0.38,
};

// ---- Interaction (inline ones) ----
export const PULSE_INITIAL_RADIUS = 2;
export const RIPPLE_INITIAL_ALPHA = 1;
export const PULSE_FORCE_H = 8;
export const PULSE_FORCE_V = 5;
export const GRAVITY_VERTICAL_REDUCTION = 0.3;

// ---- Drives ----
export const COMFORT_BASELINE_BASE = 0.3;
export const COMFORT_BASELINE_SCALE = 0.4;
export const CURIOSITY_BASELINE_BASE = 0.3;
export const CURIOSITY_BASELINE_SCALE = 0.4;
export const TOGETHERNESS_BASELINE_BASE = 0.3;
export const TOGETHERNESS_BASELINE_SCALE = 0.4;
export const DRIVE_DECAY_RATE = 0.04;
export const COMFORT_LOW_ENERGY_RATE = 0.15;
export const COMFORT_LOW_ENERGY_THRESHOLD = 0.4;
export const TOGETHERNESS_LONELY_RATE = 0.08;
export const LONELY_THRESHOLD_TIME = 5;
export const CURIOSITY_RESTLESS_RATE = 0.06;
export const RESTLESS_THRESHOLD_TIME = 8;
export const EVENT_BOLD_CURIOSITY_SPIKE = 0.3;
export const EVENT_TIMID_COMFORT_SPIKE = 0.3;
export const BOLD_HARDINESS_THRESHOLD = 0.5;

// ---- Memory ----
export const FAV_POSITION_ALPHA = 0.15;
export const FAV_POSITION_INTERVAL = 2;
export const FAV_POSITION_ENERGY_THRESHOLD = 0.4;
export const AVOIDANCE_DURATION = 75;
export const AVOIDANCE_ENERGY_DROP = 0.15;
export const AVOIDANCE_ENERGY_WINDOW = 2;

// ---- Grief ----
export const GRIEF_DURATION = 18;
export const GRIEF_SPEED_MULT = 0.5;
export const GRIEF_COMFORT_OVERRIDE = 1.0;
export const GRIEF_TOGETHERNESS_FLOOR = 0.1;
export const GRIEF_BOND_THRESHOLD = 0.8;
export const GRIEF_TOGETHERNESS_RECOVERY = 0.03;

// ---- Compatibility ----
export const COMPAT_WANDERLUST_SOCIAL_WEIGHT = 0.5;
export const COMPAT_HARDINESS_WEIGHT = 0.3;
export const COMPAT_BOND_THRESHOLD = 0.35;
export const COMPAT_FAST_FRIEND_THRESHOLD = 0.7;
export const COMPAT_FAST_FRIEND_MULT = 1.5;

// ---- Rejection ----
export const REJECTION_TOGETHERNESS_THRESHOLD = 0.3;

// ---- Target selection ----
export const EXPLORE_DISTANCE = 40;
