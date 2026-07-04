import { describe, it, expect } from "vitest";
import { createWorldForCycle, stepWorld } from "../src/world";
import { SIM_DT, STEPS_PER_CYCLE } from "../src/constants";

function runFullCycle(cycle: number) {
  const w = createWorldForCycle(cycle);
  const popByProgress: Array<{ progress: number; population: number }> = [];
  for (let i = 0; i < STEPS_PER_CYCLE; i++) {
    stepWorld(w, SIM_DT);
    if (i % 90 === 0) popByProgress.push({ progress: w.cycleProgress, population: w.motes.length });
  }
  return { w, popByProgress };
}

describe.each([1000, 2000, 3000])("full cycle %i — the guaranteed arc", (cycle) => {
  const { w, popByProgress } = runFullCycle(cycle);
  const milestone = (name: string) => w.colony.milestones.find(m => m.name === name);

  it("first bond before 25% progress", () => {
    const m = milestone("first-bond");
    expect(m).toBeDefined();
    expect(m!.progress).toBeLessThan(0.25);
  });

  it("a community of 4+ forms", () => {
    expect(milestone("first-cluster")).toBeDefined();
  });

  it("the colony arrives at the site before dissolution", () => {
    const m = milestone("arrival");
    expect(m).toBeDefined();
    expect(m!.progress).toBeLessThan(0.80);
  });

  it("population peaks at 28-36 during complexity", () => {
    const peak = popByProgress.reduce((a, b) => (b.population > a.population ? b : a));
    expect(peak.population).toBeGreaterThanOrEqual(28);
    expect(peak.population).toBeLessThanOrEqual(36);
    expect(peak.progress).toBeGreaterThanOrEqual(0.55);
    expect(peak.progress).toBeLessThanOrEqual(0.80);
  });

  it("ends with a last survivor, then none", () => {
    expect(milestone("last-survivor")).toBeDefined();
    const tail = popByProgress.filter(s => s.progress >= 0.965 && s.progress <= 0.99);
    expect(tail.length).toBeGreaterThan(0);
    for (const s of tail) expect(s.population).toBe(1);
  });
});
