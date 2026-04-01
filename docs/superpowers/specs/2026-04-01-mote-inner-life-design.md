# Mote Inner Life — Design Spec

**Date:** 2026-04-01
**Problem:** Mote behavior is shallow. Three random floats bias a random walk. No memory, no goals, no state. The emotional weight comes from rendering and audio, not the creatures themselves. Motes are the centerpiece of the project but feel the least fleshed out.

**Goal:** Give motes observable inner life — drives, memories, preferences, grief — so that a viewer watching for 2-3 minutes can point to a specific mote and say "that one has a personality."

**Design principle:** The behavior IS the feature. No new rendering effects, no UI for internal state. Personality must be legible purely through movement, spatial choices, and social decisions on a 256x144 canvas.

---

## 1. Drive System

Replace implicit random-walk biasing with three explicit **drives** that fluctuate over time.

| Drive | Meaning | Target when dominant |
|---|---|---|
| **Comfort** | Safety, familiarity, stillness | Favorite position. Reduce speed. |
| **Curiosity** | Novelty, exploration, space | Away from favorite position. Unvisited terrain. |
| **Togetherness** | Specific companionship | Preferred companion. If none, nearest compatible mote. |

### Baseline mapping from temperament

Existing temperament floats (wanderlust, sociability, hardiness) set the resting point for each drive:

- `comfortBaseline = 0.3 + hardiness * 0.4`
- `curiosityBaseline = 0.3 + wanderlust * 0.4`
- `togethernessBaseline = 0.3 + sociability * 0.4`

### Drive fluctuation rules

Drives shift based on state, clamped to [0, 1]:

| Condition | Effect |
|---|---|
| Energy < 0.4 | Comfort += 0.15 * dt (scales with energy deficit) |
| Alone >5s (no neighbor within 28px) | Togetherness += 0.08 * dt |
| Bonded and stable >8s | Curiosity += 0.06 * dt (restlessness) |
| Rare event nearby | Bold motes (hardiness > 0.5): curiosity += 0.3. Timid: comfort += 0.3. |
| Preferred companion dies | Comfort = 1.0, togetherness drops to 0.1 (grief, see Section 4) |

All drives decay toward their baseline at rate `0.04 * dt` when no condition is active.

### Target selection

Each frame, compute a target position as a **weighted blend** of the three drive targets:

```
targetX = (comfort * favX + curiosity * exploreX + togetherness * companionX) / (comfort + curiosity + togetherness)
```

Where:
- `favX/favY` = favorite position memory
- `exploreX` = `m.x + m.direction * 40` (a point 40px ahead in current facing direction; if near edge, flip). This keeps curiosity simple: explore means "keep going forward."
- `companionX` = preferred companion's position if set, otherwise nearest compatible unbonded mote's position, otherwise ignored (weight falls to other drives)

The mote drifts toward targetX with noise from seeded RNG (small random offset each frame). Movement toward target replaces the random direction-flip. Direction is set to face the target rather than flipping randomly.

---

## 2. Memory

Three memory slots per mote. Total per-mote cost: 7 floats + 1 reference.

### Favorite position (`favX`, `favY`)

- Exponential moving average, updated every ~2s
- `favX += 0.15 * (currentX - favX)` (only when energy > 0.4)
- Initialized to spawn position
- Used by comfort drive as movement target
- Persists entire cycle

### Preferred companion (`preferredMote: Mote | null`)

- Set to the mote with the longest continuous bond
- Updates when a new bond outlasts the current preferred's bond age
- When preferred companion dies: triggers grief state
- Cleared on companion's death
- Used by togetherness drive: seek THIS mote over nearer alternatives
- The design-defining moment: a mote crossing the canvas to reach its preferred companion during dissolution

### Avoidance position (`avoidX`, `avoidY`, `avoidTimer`)

- Set when energy drops sharply (>0.15 loss in <2s) or rare event strikes nearby
- Adds repulsion vector steering mote away from this point
- `avoidTimer` counts down from 75s, position ignored after expiry
- Overwritten by more recent bad experiences
- Creates visible caution that contrasts with bolder motes

---

## 3. Compatibility & Bond Gating

### Compatibility formula

```
compat = 1.0
       - abs(m1.wanderlust - m2.sociability) * 0.5
       - abs(m1.hardiness - m2.hardiness) * 0.3
```

Result is ~0.2 to 1.0. Complementary temperaments (explorers + social motes) bond easily.

### Bond formation changes

- Bond timer only advances when `compat > 0.35`
- Above 0.7: bond timer advances at 1.5x (fast friends)
- Below 0.35: no bond forms, even with prolonged proximity

### Rejection behavior

When togetherness drive < 0.3 and an unbonded mote approaches within BOND_DIST:
- Add repulsion vector (same magnitude as current social attraction, reversed)
- Mote visibly turns away

This is the single most personality-defining behavior: negative choices are more legible than positive ones at this resolution.

---

## 4. Grief as Behavior

### Trigger

Preferred companion's energy reaches 0 (death).

### Behavioral changes (duration: 18 seconds)

- Movement speed multiplied by 0.5
- Comfort drive forced to 1.0 (mote returns to favorite position)
- Togetherness drive drops to 0.1
- Bond formation requires `compat > 0.8` (nearly impossible to bond while grieving)
- `grieving` timer counts down from 18s

### Recovery

After grief timer expires:
- Speed modifier returns to 1.0
- Comfort drive released (decays toward baseline)
- Togetherness drive recovers at 0.03/s toward baseline over ~30s
- Bond threshold returns to normal 0.35

### Interaction with existing systems

- Existing color flashes (inheritFlash, mourningFlash) stay as visual reinforcement
- Cluster mourning stays (the brief flash for cluster members)
- The behavioral grief is for the preferred companion relationship only

---

## 5. File Changes

### types.ts — Mote interface additions

```typescript
// Drives (fluctuating 0-1)
comfort: number;
curiosity: number;
togetherness: number;

// Memory: favorite position
favX: number;
favY: number;

// Memory: preferred companion
preferredMote: Mote | null;

// Memory: avoidance
avoidX: number;
avoidY: number;
avoidTimer: number;

// State
grieving: number;       // countdown timer, 0 = not grieving
lonelyTimer: number;    // seconds since last neighbor within 28px
stableTimer: number;    // seconds bonded without change
lastEnergy: number;     // for detecting sharp energy drops
lastEnergyTime: number; // timestamp of lastEnergy sample
```

### mote.ts — updateMote restructuring

1. **Drive update** (~30 lines): Apply fluctuation rules, decay toward baseline
2. **Memory update** (~25 lines): Favorite position EMA, preferred companion tracking, avoidance detection
3. **Target selection** (~15 lines): Weighted blend of drive targets
4. **Movement** (~10 lines changed): Replace random direction-flip with target-seeking drift
5. **Social forces** (~5 lines added): Rejection repulsion for low-togetherness motes
6. **Bond formation** (~10 lines changed): Add compatibility gate
7. **Grief modifiers** (~10 lines): Speed reduction, drive overrides during grief

**Net addition:** ~100-120 lines. Some existing random-walk code is replaced, not just added to.

### world.ts — death processing

- When a mote dies: find all motes whose `preferredMote` references the dead mote
- Set their `grieving = 18`, `preferredMote = null`
- Existing death handling (inheritFlash, mourningFlash, etc.) unchanged

### render-motes.ts — minimal

- Optional: grieving motes render at 85% brightness (subtle dimming)
- No new effects required

### Unchanged files

physics.ts, sound.ts, terrain-*, render-bonds.ts, render-effects.ts, render-ui.ts, config.ts, main.ts, palette.ts, weather-*, interaction.ts, font.ts, noise.ts, rng.ts, names.ts

---

## 6. Explicitly Out of Scope

- **No behavior trees or state machines.** Drives produce emergent states.
- **No group dynamics beyond pairs.** Clusters stay as-is. Two-body interactions are the legibility limit at this resolution.
- **No learning or adaptation.** Personality is fixed at spawn. Drives and memories change; temperament doesn't.
- **No UI for internal state.** No thought bubbles, no drive meters, no debug overlay for drives (though `?debug` could show them later).
- **No new rendering effects.** The behavior is the feature.
- **No sound.ts changes.** Sound responds to clusters and positions, which already reflect the new behavior.
- **Magic number consolidation** is a separate task.
- **sound.ts refactoring** is a separate task.

---

## 7. Determinism

All drive updates are pure functions of (current state, dt, seeded rng). Memory updates are state-triggered, not wall-clock-triggered. Motes are processed in array order (stable from seeded spawning). The exponential moving average uses a fixed alpha. No randomness outside the seeded PRNG. Same cycle number produces the same memories, drives, and behaviors for every viewer.

---

## 8. The Emotional Test

The design succeeds if these moments emerge naturally:

1. **"That one has a personality"** — A viewer can distinguish a comfort-seeking mote from a curious explorer within 60 seconds of watching
2. **"It chose that one"** — A mote passes nearby unbonded motes to reach its preferred companion
3. **"It said no"** — A mote visibly turns away from an approaching stranger
4. **"It remembers"** — A mote returns to the same hillside after wandering
5. **"It's grieving"** — After its partner dies, a mote slows, withdraws, returns to their shared place
6. **"The long walk"** — During dissolution, a mote crosses the canvas to reach its dying partner
