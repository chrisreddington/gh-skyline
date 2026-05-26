import { describe, it, expect } from "vitest";
import {
  bucketLevel,
  buildLevelThresholds,
  colourForLevel,
  revealColourProgress,
  themes,
} from "../scene/theme";

describe("bucketLevel", () => {
  it("returns 0 for count <= 0 regardless of peak", () => {
    expect(bucketLevel(0, 10)).toBe(0);
    expect(bucketLevel(-5, 10)).toBe(0);
  });

  it("returns 0 when peakInYear is 0 (empty year)", () => {
    expect(bucketLevel(0, 0)).toBe(0);
    expect(bucketLevel(5, 0)).toBe(0);
  });

  it("clamps counts above the high threshold to level 4", () => {
    const t = buildLevelThresholds([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(bucketLevel(100, t)).toBe(4);
    expect(bucketLevel(8, t)).toBe(4);
  });

  it("buckets by year-relative thresholds", () => {
    const t = buildLevelThresholds([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(t).toEqual({ low: 3, medium: 5, high: 7 });
    expect(bucketLevel(1, t)).toBe(1);
    expect(bucketLevel(4, t)).toBe(2);
    expect(bucketLevel(6, t)).toBe(3);
    expect(bucketLevel(8, t)).toBe(4);
  });

  it("handles a peak of 1", () => {
    const t = buildLevelThresholds([1]);
    expect(bucketLevel(1, t)).toBe(4);
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

describe("revealColourProgress", () => {
  it("lags high-intensity bars so they earn colour later in the reveal", () => {
    const mid = 0.5;
    expect(revealColourProgress(mid, 1)).toBeGreaterThan(revealColourProgress(mid, 4));
  });
});
