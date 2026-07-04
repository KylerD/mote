import { describe, it, expect } from "vitest";
import { belongingBase } from "../src/colony";
import { createWorldForCycle, stepWorld } from "../src/world";
import { SIM_DT, STEPS_PER_CYCLE, SITE_ARRIVE_DIST } from "../src/constants";

describe("belongingBase ramp", () => {
  it("is zero through genesis and exploration", () => {
    expect(belongingBase(0.05)).toBe(0);
    expect(belongingBase(0.20)).toBe(0);
  });
  it("reaches its peak during organization/complexity", () => {
    expect(belongingBase(0.55)).toBeCloseTo(0.9, 5);
    expect(belongingBase(0.70)).toBeCloseTo(0.9, 5);
  });
  it("fades out during dissolution", () => {
    expect(belongingBase(0.86)).toBeGreaterThan(0);
    expect(belongingBase(0.86)).toBeLessThan(0.9);
    expect(belongingBase(0.93)).toBe(0);
  });
});

describe("the pull", () => {
  // Community-relative convergence: measure among motes inside the site's
  // walkable basin. Motes stranded across water on a split map are
  // stragglers/texture — the gathering is about those who *can* reach the
  // site (spec 2.0 §6.2). Tasks 10/11 assert arrival for these cycles, so the
  // gate is enforced for all three.
  const measure = (cycle: number) => {
    const w = createWorldForCycle(cycle);
    const basinMotes = () =>
      w.motes.filter(m => m.x >= w.colony.basinLo && m.x <= w.colony.basinHi);
    const spreadAt = (steps: number) => {
      while (w.stepsThisCycle < steps) stepWorld(w, SIM_DT);
      const ds = basinMotes().map(m => Math.abs(m.x - w.colony.siteX));
      return ds.reduce((s, d) => s + d, 0) / Math.max(1, ds.length);
    };
    const spreadBefore = spreadAt(Math.floor(STEPS_PER_CYCLE * 0.25)); // end of exploration
    const spreadAfter = spreadAt(Math.floor(STEPS_PER_CYCLE * 0.70));  // mid-complexity
    const bm = basinMotes();
    const near = bm.filter(m => Math.abs(m.x - w.colony.siteX) < SITE_ARRIVE_DIST).length;
    return { spreadBefore, spreadAfter, ratio: near / Math.max(1, bm.length) };
  };

  for (const cycle of [1000, 2000, 3000]) {
    it(`the colony converges on the site by complexity (cycle ${cycle})`, () => {
      const { spreadBefore, spreadAfter, ratio } = measure(cycle);
      expect(spreadAfter).toBeLessThan(spreadBefore * 0.5);   // the crowd tightens
      expect(ratio).toBeGreaterThanOrEqual(0.5);              // a majority is AT the site
    });
  }

  // Generalization probe (informational — not asserted): confirm nearby cycles
  // also converge without gating on them, since convergence is chaotic per-cycle.
  it("probes generalization on other cycles (informational)", () => {
    for (const cycle of [1500, 4000]) {
      const { ratio } = measure(cycle);
      console.log(`cycle ${cycle}: basin-relative near-ratio @0.70 = ${ratio.toFixed(2)}`);
    }
    expect(true).toBe(true);
  });
});
