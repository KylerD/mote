// names.ts — Procedural cycle name generator.
// "[ADJECTIVE] [FEATURE] #[CYCLE]"

const ADJECTIVES = [
  "SILENT", "AMBER", "FROZEN", "VERDANT", "ASHEN",
  "GOLDEN", "HOLLOW", "CRIMSON", "PALE", "ANCIENT",
  "SUNKEN", "WILD", "QUIET", "IRON", "DRIFTING",
  "MOSSY", "STARK", "DEEP", "FADING", "BRIGHT",
  "LONELY", "MISTY", "WARM", "COLD", "VAST",
  "HIDDEN", "SCARRED", "GENTLE", "RUINED", "DARK",
  "BURNING", "FORSAKEN", "DREAMING", "WINDSWEPT", "SUNDERED",
  "HALLOWED", "WANDERING", "BARREN", "TWILIGHT", "WEEPING",
  "WEATHERED", "STILL", "DISTANT", "LOST", "SILVER",
];

const FEATURES = [
  "BASIN", "RIDGE", "SHORE", "HOLLOW", "MESA",
  "VALLEY", "CLIFF", "ISLAND", "PLAIN", "CANYON",
  "MARSH", "PEAK", "COVE", "STEPPE", "GROVE",
  "REACH", "EXPANSE", "CROSSING", "FRONTIER", "DRIFT",
  "LEDGE", "DUNE", "REMNANT", "THRESHOLD", "EDGE",
];

export function cycleName(seed: number): string {
  const adj = ADJECTIVES[Math.abs(seed * 2654435761) % ADJECTIVES.length];
  const feat = FEATURES[Math.abs(seed * 340573321) % FEATURES.length];
  return adj + " " + feat + " #" + seed;
}
