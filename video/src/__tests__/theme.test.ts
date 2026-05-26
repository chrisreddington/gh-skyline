import { describe, it, expect } from "vitest";
import { bucketLevel, colourForLevel, themes } from "../scene/theme";

describe("bucketLevel", () => {
  it("returns 0 for count <= 0 regardless of peak", () => {
    expect(bucketLevel(0, 10)).toBe(0);
    expect(bucketLevel(-5, 10)).toBe(0);
  });

  it("returns 0 when peakInYear is 0 (empty year)", () => {
    expect(bucketLevel(0, 0)).toBe(0);
    expect(bucketLevel(5, 0)).toBe(0);
  });

  it("clamps counts exceeding peak to level 4", () => {
    expect(bucketLevel(100, 10)).toBe(4);
    expect(bucketLevel(10, 10)).toBe(4);
  });

  it("buckets via quartiles of peak", () => {
    const peak = 100;
    // ratio <= 0.25 -> 1
    expect(bucketLevel(1, peak)).toBe(1);
    expect(bucketLevel(25, peak)).toBe(1);
    // ratio 0.25 < r <= 0.5 -> 2
    expect(bucketLevel(26, peak)).toBe(2);
    expect(bucketLevel(50, peak)).toBe(2);
    // 0.5 < r <= 0.75 -> 3
    expect(bucketLevel(51, peak)).toBe(3);
    expect(bucketLevel(75, peak)).toBe(3);
    // 0.75 < r < 1 -> 4
    expect(bucketLevel(76, peak)).toBe(4);
    expect(bucketLevel(99, peak)).toBe(4);
  });

  it("handles a peak of 1", () => {
    expect(bucketLevel(1, 1)).toBe(4);
  });
});

describe("colourForLevel", () => {
  it("returns dark palette colours", () => {
    expect(colourForLevel(0, "dark")).toBe(themes.dark.levels[0]);
    expect(colourForLevel(4, "dark")).toBe(themes.dark.levels[4]);
  });
  it("returns light palette colours", () => {
    expect(colourForLevel(0, "light")).toBe("#ebedf0");
    expect(colourForLevel(4, "light")).toBe("#216e39");
  });
});
