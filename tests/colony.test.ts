import { describe, it, expect } from "vitest";
import { chooseSite } from "../src/colony";
import { generateTerrain } from "../src/terrain";
import { getTile } from "../src/terrain-query";
import { Tile } from "../src/types";
import { W } from "../src/config";

describe("chooseSite", () => {
  it("is deterministic for the same terrain", () => {
    const t = generateTerrain(777);
    expect(chooseSite(t)).toEqual(chooseSite(generateTerrain(777)));
  });

  it("never picks water and stays inside margins", () => {
    for (const cycle of [1, 500, 12345, 356614501]) {
      const t = generateTerrain(cycle);
      const s = chooseSite(t);
      expect(s.x).toBeGreaterThanOrEqual(16);
      expect(s.x).toBeLessThanOrEqual(W - 16);
      const tile = getTile(t, s.x, s.y + 1);
      expect(tile).not.toBe(Tile.ShallowWater);
      expect(tile).not.toBe(Tile.DeepWater);
    }
  });

  it("varies across cycles", () => {
    const xs = [1, 2, 3, 4, 5].map(c => chooseSite(generateTerrain(c)).x);
    expect(new Set(xs).size).toBeGreaterThan(1);
  });
});
