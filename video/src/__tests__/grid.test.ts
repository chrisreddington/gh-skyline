import { describe, it, expect } from "vitest";
import {
  isInYear,
  peakCountInYear,
  layoutBars,
  placementForDate,
  placementsForWeekStart,
} from "../utils/grid";
import type { YearData } from "../schema";

function makeYear(): YearData {
  // Year 2025: 2 weeks. Week 0 starts 2024-12-29 (padding Sun..Tue),
  // includes 2025-01-01..2025-01-04. Week 1 fully in-year.
  return {
    year: 2025,
    totalContributions: 12,
    weeks: [
      {
        weekIndex: 0,
        startDate: "2024-12-29",
        days: [
          { date: "2024-12-29", count: 99, weekday: 0 }, // padding (prev year)
          { date: "2024-12-30", count: 0, weekday: 1 },
          { date: "2024-12-31", count: 0, weekday: 2 },
          { date: "2025-01-01", count: 5, weekday: 3 },
          { date: "2025-01-02", count: 1, weekday: 4 },
          { date: "2025-01-03", count: 0, weekday: 5 },
          { date: "2025-01-04", count: 2, weekday: 6 },
        ],
      },
      {
        weekIndex: 1,
        startDate: "2025-01-05",
        days: [
          { date: "2025-01-05", count: 0, weekday: 0 },
          { date: "2025-01-06", count: 4, weekday: 1 },
          { date: "2025-01-07", count: 0, weekday: 2 },
          { date: "2025-01-08", count: 0, weekday: 3 },
          { date: "2025-01-09", count: 0, weekday: 4 },
          { date: "2025-01-10", count: 0, weekday: 5 },
          { date: "2025-01-11", count: 0, weekday: 6 },
        ],
      },
    ],
    stats: null,
  };
}

describe("isInYear", () => {
  it("treats string prefix as authoritative (no timezone parsing)", () => {
    expect(isInYear("2025-01-01", 2025)).toBe(true);
    expect(isInYear("2024-12-31", 2025)).toBe(false);
    expect(isInYear("2026-01-01", 2025)).toBe(false);
  });
});

describe("peakCountInYear", () => {
  it("ignores padding days even if they have higher counts", () => {
    const y = makeYear();
    // Padding day (2024-12-29) has 99 contributions; in-year peak is 5.
    expect(peakCountInYear(y)).toBe(5);
  });

  it("returns 0 for an all-zero year", () => {
    const y = makeYear();
    for (const w of y.weeks) for (const d of w.days) (d as { count: number }).count = 0;
    expect(peakCountInYear(y)).toBe(0);
  });
});

describe("layoutBars", () => {
  it("keeps padding days as zero-height instances", () => {
    const placements = layoutBars(makeYear());
    expect(placements).toHaveLength(2 * 7);
    const padding = placements.find((p) => p.date === "2024-12-29")!;
    expect(padding.inYear).toBe(false);
    expect(padding.height).toBe(0);
    expect(padding.level).toBe(0);
  });

  it("assigns stable instance indices = weekIndex*7 + weekday", () => {
    const placements = layoutBars(makeYear());
    for (const p of placements) {
      expect(p.instanceIndex).toBe(p.weekIndex * 7 + p.weekday);
    }
  });

  it("buckets in-year days using local peak (not padding peak)", () => {
    const placements = layoutBars(makeYear());
    const jan1 = placements.find((p) => p.date === "2025-01-01")!;
    // 2025 non-zero thresholds for this fixture map count=5 to level 4.
    expect(jan1.level).toBe(4);
  });

  it("spreads active days across multiple levels for skewed years", () => {
    const skewed: YearData = {
      year: 2025,
      totalContributions: 136,
      weeks: [
        {
          weekIndex: 0,
          startDate: "2024-12-29",
          days: [
            { date: "2025-01-01", count: 1, weekday: 3 },
            { date: "2025-01-02", count: 2, weekday: 4 },
            { date: "2025-01-03", count: 3, weekday: 5 },
            { date: "2025-01-04", count: 4, weekday: 6 },
            { date: "2024-12-29", count: 0, weekday: 0 },
            { date: "2024-12-30", count: 0, weekday: 1 },
            { date: "2024-12-31", count: 0, weekday: 2 },
          ],
        },
        {
          weekIndex: 1,
          startDate: "2025-01-05",
          days: [
            { date: "2025-01-05", count: 5, weekday: 0 },
            { date: "2025-01-06", count: 6, weekday: 1 },
            { date: "2025-01-07", count: 7, weekday: 2 },
            { date: "2025-01-08", count: 8, weekday: 3 },
            { date: "2025-01-09", count: 100, weekday: 4 },
            { date: "2025-01-10", count: 0, weekday: 5 },
            { date: "2025-01-11", count: 0, weekday: 6 },
          ],
        },
      ],
      stats: null,
    };
    const levels = new Set(
      layoutBars(skewed)
        .filter((p) => p.inYear && p.count > 0)
        .map((p) => p.level),
    );
    expect(levels).toEqual(new Set([1, 2, 3, 4]));
  });
});

describe("placement lookups", () => {
  it("placementForDate finds by exact date", () => {
    const placements = layoutBars(makeYear());
    const p = placementForDate(placements, "2025-01-06");
    expect(p?.count).toBe(4);
  });

  it("placementsForWeekStart returns only in-year days in that week", () => {
    const placements = layoutBars(makeYear());
    const week = placementsForWeekStart(placements, "2024-12-29");
    // Week 0 has 4 in-year days (Wed..Sat).
    expect(week).toHaveLength(4);
    expect(week.every((p) => p.weekIndex === 0)).toBe(true);
    expect(week.every((p) => p.inYear)).toBe(true);
  });
});
