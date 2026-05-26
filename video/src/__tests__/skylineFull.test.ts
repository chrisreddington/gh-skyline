import { describe, expect, it } from "vitest";
import { yearDepthOffsets } from "../compositions/fullLayout";
import type { SkylineDocument } from "../schema";

function docWithYears(years: number[]): SkylineDocument {
  return {
    schemaVersion: 1,
    username: "octocat",
    generatedAt: "2026-05-26T00:00:00Z",
    years: years.map((year) => ({
      year,
      totalContributions: 0,
      weeks: [],
      stats: null,
    })),
  };
}

describe("yearDepthOffsets", () => {
  it("places the newest year at the front and older years behind it", () => {
    const offsets = yearDepthOffsets(docWithYears([2023, 2024, 2025]));
    expect(offsets).toEqual([14, 7, 0]);
  });

  it("uses the STL-derived seven-day depth stride", () => {
    const offsets = yearDepthOffsets(docWithYears([2011, 2012, 2013, 2014]));
    expect(offsets[0] - offsets[1]).toBe(7);
    expect(offsets[1] - offsets[2]).toBe(7);
    expect(offsets[2] - offsets[3]).toBe(7);
  });
});
