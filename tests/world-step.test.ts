import { describe, it, expect } from "vitest";
import { createWorldForCycle, stepWorld } from "../src/world";
import { SIM_DT } from "../src/constants";

function popTimeline(cycle: number, sampleEvery: number, totalSteps: number): number[] {
  const w = createWorldForCycle(cycle);
  const out: number[] = [];
  for (let i = 1; i <= totalSteps; i++) {
    stepWorld(w, SIM_DT);
    if (i % sampleEvery === 0) out.push(w.motes.length);
  }
  return out;
}

describe("fixed-timestep world", () => {
  it("same cycle stepped twice gives identical population timelines", () => {
    const a = popTimeline(1000, 300, 3000);
    const b = popTimeline(1000, 300, 3000);
    expect(a).toEqual(b);
  });

  it("spawn/death totals are tracked", () => {
    const w = createWorldForCycle(1000);
    for (let i = 0; i < 3000; i++) stepWorld(w, SIM_DT);
    expect(w.spawnTotal).toBeGreaterThan(0);
    expect(w.spawnTotal - w.deathTotal).toBe(w.motes.length);
  });

  it("different cycles differ", () => {
    expect(popTimeline(1000, 300, 3000)).not.toEqual(popTimeline(2000, 300, 3000));
  });
});
