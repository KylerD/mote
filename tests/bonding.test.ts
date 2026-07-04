import { describe, it, expect } from "vitest";
import { createWorldForCycle, stepWorld } from "../src/world";
import { createMote } from "../src/mote";
import { getSurfaceY } from "../src/terrain-query";
import { SIM_DT, PHASE_PARAMS } from "../src/constants";

describe("PHASE_PARAMS (spec 6.1)", () => {
  it("matches the approved population curve", () => {
    expect(PHASE_PARAMS.map(p => p.maxMotes)).toEqual([10, 24, 32, 36, 36, 36]);
    expect(PHASE_PARAMS.map(p => p.spawnRate)).toEqual([2.0, 1.5, 0.8, 0.3, 0, 0]);
    expect(PHASE_PARAMS.map(p => p.energyDecay)).toEqual([0.004, 0.008, 0.010, 0.012, 0.035, 0.06]);
    expect(PHASE_PARAMS.map(p => p.bondStrength)).toEqual([0.2, 0.7, 0.9, 1.0, 0.4, 0.1]);
  });
});

describe("bonding", () => {
  it("two adjacent motes bond within 10 sim-seconds regardless of temperament", () => {
    const w = createWorldForCycle(42);
    // Fast-forward past genesis so bondStrength is meaningful
    for (let i = 0; i < 3600; i++) stepWorld(w, SIM_DT); // 120s -> exploration/organization
    w.motes.length = 0;
    const x = 128;
    const y = getSurfaceY(w.terrain, x) - 1;
    const a = createMote(x, y, 0.8, w.rng);
    const b = createMote(x + 3, y, 0.8, w.rng);
    // Worst-case temperaments for old compat gating: maximally mismatched
    a.temperament = { wanderlust: 1, sociability: 0, hardiness: 1 };
    b.temperament = { wanderlust: 0, sociability: 1, hardiness: 0 };
    w.motes.push(a, b);
    for (let i = 0; i < 300; i++) stepWorld(w, SIM_DT); // 10 sim-seconds
    expect(a.bonds.includes(b)).toBe(true);
  });

  it("bonded motes lose energy slower than loners", () => {
    const w = createWorldForCycle(42);
    for (let i = 0; i < 3600; i++) stepWorld(w, SIM_DT);
    w.motes.length = 0;
    const x = 128;
    const y = getSurfaceY(w.terrain, x) - 1;
    const a = createMote(x, y, 0.8, w.rng);
    const b = createMote(x + 3, y, 0.8, w.rng);
    const loner = createMote(x + 100, getSurfaceY(w.terrain, x + 100) - 1, 0.8, w.rng);
    // Identical temperaments so decay modifiers match
    const t = { wanderlust: 0.5, sociability: 0.5, hardiness: 0.5 };
    a.temperament = { ...t }; b.temperament = { ...t }; loner.temperament = { ...t };
    w.motes.push(a, b, loner);
    for (let i = 0; i < 900; i++) stepWorld(w, SIM_DT); // 30 sim-seconds
    expect((a.energy + b.energy) / 2).toBeGreaterThan(loner.energy);
  });
});
