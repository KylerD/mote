# mote

A living canvas.

Small things emerge, find each other, and dissolve.
Sound rises from their movement. Your presence is a gentle force.
Each cycle is different. None are saved.

CC0 / public domain.

---

## What this is

Mote is a procedurally generated pixel world running on a 256x144 canvas. Every 5 minutes, a new landscape appears — seeded from UTC, so everyone watching sees the same world at the same time. Tiny autonomous creatures spawn on the terrain, walk the hills, form bonds with each other, build settlements, and eventually fade. Then it begins again.

There are no sprites, no images, no assets. Every pixel is placed by code. The sound is generated the same way — an 8-voice synthesizer where each voice is a cluster of bonded creatures, humming at a pitch determined by their position in the world.

Nothing is saved between cycles.

## The creatures

Each mote has three continuous temperament axes:

- **Wanderlust** (0–1) — how far and fast it roams
- **Sociability** (0–1) — how strongly it's drawn toward others
- **Hardiness** (0–1) — how slowly it burns energy

Motes walk the terrain, avoid water, turn around at cliffs too steep to climb, and reverse direction at random. When two motes spend enough time near each other, they form a bond — up to three bonds each. Bonded motes stay close, share energy between them, and glow slightly brighter. When a bond stretches too far, it breaks.

Stable clusters of three or more bonded motes leave a mark on the ground: a settlement tile that persists for the rest of the cycle.

Energy depletes constantly. When it hits zero, the mote's bonds dissolve and it disappears.

## The cycle

Each 300-second cycle moves through six phases with different parameters:

| Phase | Duration | What happens |
|---|---|---|
| **Genesis** | 30s | Rapid spawning, low energy decay. The world populates. |
| **Exploration** | 60s | Motes spread out. Bonds begin forming. |
| **Organization** | 75s | Bond strength peaks. Clusters stabilize. Settlements appear. |
| **Complexity** | 75s | Maximum population. Dense networks. The world is full. |
| **Dissolution** | 36s | No new spawns. Energy drains fast. Bonds weaken. |
| **Silence** | 24s | The last motes fade. Near-empty world. Then it resets. |

Every cycle gets a procedural name — an adjective and a landform. `FROZEN RIDGE #8841902`. `AMBER COVE #8841903`.

## The terrain

Simplex noise generates a heightmap each cycle. A seeded RNG picks one of five biomes — temperate, desert, tundra, volcanic, or lush — each with its own palette mapping from the same 16 colors. On top of the heightmap, features get placed: trees (trunk + canopy), rock clusters, cave openings in steep cliffs, and occasionally ancient ruins on flat plateaus.

Water fills below a generated water level. Motes won't spawn on water and turn away from it.

## The sound

Audio initializes on first interaction. An 8-voice Web Audio synthesizer runs at ~15fps, decoupled from the render loop.

The largest bonded clusters become voices. Each voice gets:
- **Pitch** from the cluster's Y position, quantized to a scale that changes per phase — pentatonic minor in genesis, major pentatonic in exploration, natural minor during organization, broader chromatic during complexity, thinning back to pentatonic as things dissolve, and just root + fifth in silence.
- **Waveform** from cluster size — sine for small groups, triangle for medium, sawtooth for large.
- **Filter cutoff** from the cluster's average energy.
- **Stereo detune** from horizontal position.

Lone unbonded motes emit occasional high-pitched pings.

A procedurally generated impulse response provides reverb. A compressor keeps it from getting harsh.

## Rare events

About 2% of cycles trigger a rare event, determined by hashing the cycle number. Events fire during the organization phase when things are most interesting:

- **Flood** — water rises over 25 seconds, submerging low terrain, then recedes.
- **Bloom** — massive spawn burst + all existing motes gain energy.
- **Meteor** — a golden streak falls from the upper right, carves a crater in the terrain, and blasts nearby motes outward.
- **Migration** — a directional force sweeps all motes to one side, then reverses.
- **Eclipse** — the world darkens, color shifts toward blue.

## Interaction

Your cursor is a force in the world:
- **Hover** attracts nearby motes gently toward it.
- **Fast swipe** scatters them away.
- **Click** sends an energy pulse — motes near the click gain energy and get pushed outward.
- **Still presence** (holding still for 1+ second) calms nearby motes, damping their velocity.

Touch works the same way.

## Technical

Zero runtime dependencies. TypeScript + Vite. Canvas 2D with a raw `ImageData` pixel buffer — no higher-level drawing API. A 3x5 bitmap font baked into code as bit-packed integers. A spatial hash grid for efficient neighbor queries. Seeded Mulberry32 PRNG for determinism.

16 colors. 256x144 pixels. `image-rendering: pixelated`.

```
src/
├── main.ts          # Frame loop, rendering, vignette
├── world.ts         # Cycle clock, phase management, spawning
├── mote.ts          # Creature behavior, bonding, temperament
├── terrain.ts       # Procedural landscape, tile map, biomes
├── physics.ts       # Spatial hash grid, cluster detection
├── sound.ts         # Web Audio synthesis, cluster-to-voice mapping
├── events.ts        # Rare event triggering & effects
├── interaction.ts   # Cursor force, click pulse, calm mode
├── render.ts        # Canvas 2D pixel buffer
├── palette.ts       # 16-color palette, 5 biome palettes
├── noise.ts         # Seeded Simplex noise
├── names.ts         # Procedural cycle naming
├── font.ts          # 3×5 bitmap font
└── style.css        # Layout, glass frame, specimen display
```

```bash
npm ci
npm run dev          # local dev server
npm run build        # production build
```

## Evolution

Mote has a daily evolution system. An AI reads the [evolution journal](public/evolution-log.json), reflects on what exists, and makes one focused change — deepening existing systems rather than bolting on new ones. The journal is append-only and [readable in the app](journal.html).

## License

CC0 — public domain. Do whatever you want with it.
