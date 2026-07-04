import { describe, it, expect } from "vitest";
import { mulberry32 } from "../src/rng";

describe("mulberry32", () => {
  it("same seed produces the same stream", () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    for (let i = 0; i < 1000; i++) expect(a()).toBe(b());
  });

  it("different seeds diverge", () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    const same = Array.from({ length: 100 }, () => a() === b());
    expect(same.every(Boolean)).toBe(false);
  });
});
