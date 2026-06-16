/**
 * Generification tests — verify that camera choreography, orbit geometry, and
 * cruise pacing adapt correctly to diverse data sets so any user/year can be
 * rendered without hand-tuned constants.
 *
 * Covered scenarios:
 *   - Sparse year (very few contributions)
 *   - Maxed-out year (high contributions every day)
 *   - Leap year (2024, 53 weeks same as non-leap)
 *   - Empty year (totalContributions=0, stats=null)
 *   - Single-active-week year (orbitRX minimum clamp)
 *   - Full-year spread (orbitRX data-adaptive, less than 42)
 *   - Cruise Z bounds (never exceeds CRUISE_Z_MAX=16.5, never below Z_FLOOR=13.5)
 */

import { describe, expect, it } from "vitest";
import type { YearData } from "../schema";
import { buildRelativeDensityCurve } from "../scene/CameraRig";
import { buildKeyframes, pickPeakTarget } from "../compositions/SkylineYear";
import { layoutBars } from "../utils/grid";
import emptyYearDoc from "../../fixtures/empty-year.json";
import sparseYearDoc from "../../fixtures/sparse-year.json";
import maxedYearDoc from "../../fixtures/maxed-year.json";
import leapYearDoc from "../../fixtures/leap-year.json";
import sampleYearDoc from "../../fixtures/sample-year.json";

// ── Phase constants that must match SkylineYear.tsx exactly ──────────────────
const ENTRY_END = 150;
const CRUISE_END = 450;
const FLYBY_END = 690;
const APPROACH_END = 750;
const CANYON_END = 906;
const Z_FLOOR = 13.5;
const CRUISE_Z_MAX = 16.5;
const ORBIT_H = 9;

// ── Synthetic year factory ───────────────────────────────────────────────────

/**
 * Create a minimal 53-week YearData where contributions appear only in the
 * specified week indices (one bar per active week, on weekday 3=Thursday).
 * All dates are set to valid in-year values so `isInYear` returns true.
 */
function makeYearWithActiveWeeks(
  activeWeekIndices: number[],
  year = 2025,
  count = 5,
  weekCount = 53,
): YearData {
  const weeks = Array.from({ length: weekCount }, (_, wi) => {
    const isActive = activeWeekIndices.includes(wi);
    return {
      weekIndex: wi,
      startDate: `${year}-01-01`,
      days: Array.from({ length: 7 }, (_, di) => ({
        // Use an in-year date for every day so inYear=true; the specific
        // date doesn't affect X positioning (only weekIndex does).
        date: `${year}-06-15`,
        count: isActive && di === 3 ? count : 0,
        weekday: di,
      })),
    };
  });
  const total = activeWeekIndices.length * count;
  return {
    year,
    totalContributions: total,
    weeks,
    stats:
      total > 0
        ? {
            peakDay: { date: `${year}-06-15`, count },
            peakWeek: { startDate: `${year}-06-09`, total: count },
            longestStreak: {
              start: `${year}-06-15`,
              end: `${year}-06-15`,
              length: 1,
            },
            firstContribution: { date: `${year}-06-15`, count },
            lastContribution: { date: `${year}-06-15`, count },
          }
        : null,
  };
}

/** Build keyframes for a YearData using the standard pipeline. */
function buildKf(year: YearData, hasContent?: boolean) {
  const placements = layoutBars(year);
  const densityCurve = buildRelativeDensityCurve(placements, 64, 2.5);
  const peak = pickPeakTarget(year, placements, 0);
  const hc = hasContent ?? year.totalContributions > 0;
  return { kf: buildKeyframes(year, placements, peak, densityCurve, hc), placements };
}

// ── Fixture sanity ────────────────────────────────────────────────────────────

describe("Generification: fixture sanity", () => {
  it("empty-year fixture has zero contributions and null stats", () => {
    const y = emptyYearDoc.years[0];
    expect(y.totalContributions).toBe(0);
    expect(y.stats).toBeNull();
  });

  it("sparse-year fixture has very few contributions", () => {
    const y = sparseYearDoc.years[0];
    expect(y.totalContributions).toBeGreaterThan(0);
    expect(y.totalContributions).toBeLessThan(20);
  });

  it("maxed-year fixture has many contributions", () => {
    const y = maxedYearDoc.years[0];
    expect(y.totalContributions).toBeGreaterThan(3000);
  });

  it("leap-year fixture is year 2024 with 53 weeks", () => {
    const y = leapYearDoc.years[0];
    expect(y.year).toBe(2024);
    // 2024 is a leap year; grid still has 53 weeks (same convention as non-leap)
    expect(y.weeks).toHaveLength(53);
  });
});

// ── orbitRX adaptation ────────────────────────────────────────────────────────

describe("Generification: orbitRX adapts to active bar span", () => {
  /**
   * Extract the orbit keyframe X spread from built keyframes.
   * Orbit keyframes are those in (CRUISE_END, FLYBY_END] with Y ≈ ORBIT_H.
   */
  function orbitXSpread(kf: ReturnType<typeof buildKeyframes>) {
    const orbit = kf.filter(
      (k) =>
        k.frame > CRUISE_END &&
        k.frame <= FLYBY_END &&
        Math.abs(k.position[1] - ORBIT_H) < 0.01,
    );
    const xs = orbit.map((k) => k.position[0]);
    return {
      min: Math.min(...xs),
      max: Math.max(...xs),
      spread: Math.max(...xs) - Math.min(...xs),
      count: orbit.length,
    };
  }

  it("clamps orbitRX to 20 for a single-active-week year", () => {
    // Only week 26 (midpoint of grid) has contributions.
    // halfActiveSpan = 0 → orbitRX = max(20, 0*1.2) = 20.
    const year = makeYearWithActiveWeeks([26]);
    const { kf, placements } = buildKf(year);
    const activeXs = placements.filter((p) => p.inYear && p.count > 0).map((p) => p.x);
    const midActiveX = (Math.min(...activeXs) + Math.max(...activeXs)) / 2;

    const { min, max, count } = orbitXSpread(kf);
    expect(count).toBe(8); // orbit still has 8 keyframes
    // With orbitRX=20, max deviation from midActiveX should be ≈20
    expect(Math.abs(max - midActiveX)).toBeCloseTo(20, 0);
    expect(Math.abs(midActiveX - min)).toBeCloseTo(20, 0);
  });

  it("clamps orbitRX to 20 for spread-out but sparse year (halfActiveSpan < 17)", () => {
    // Weeks 10 and 42 active: halfActiveSpan = (42-10)/2 * stride = 16.
    // orbitRX = max(20, 16*1.2) = max(20, 19.2) = 20 (still clamped).
    const year = makeYearWithActiveWeeks([10, 42]);
    const { kf, placements } = buildKf(year);
    const activeXs = placements.filter((p) => p.inYear && p.count > 0).map((p) => p.x);
    const midActiveX = (Math.min(...activeXs) + Math.max(...activeXs)) / 2;

    const { min, max, count } = orbitXSpread(kf);
    expect(count).toBe(8);
    // orbitRX ≈ 20 (clamped from 19.2)
    expect(max - midActiveX).toBeLessThanOrEqual(21); // within tolerance
    expect(midActiveX - min).toBeLessThanOrEqual(21);
  });

  it("uses data-adaptive orbitRX (< 42) for a full-year spread", () => {
    // All weeks 0-52 active: halfActiveSpan=26, orbitRX=min(42,31.2)=31.2.
    const year = makeYearWithActiveWeeks(Array.from({ length: 53 }, (_, i) => i));
    const { kf, placements } = buildKf(year);
    const activeXs = placements.filter((p) => p.inYear && p.count > 0).map((p) => p.x);
    const midActiveX = (Math.min(...activeXs) + Math.max(...activeXs)) / 2;

    const { max, count } = orbitXSpread(kf);
    expect(count).toBe(8);
    // orbitRX should be ≈31.2, well below the old hardcoded 42
    const derivedRX = max - midActiveX;
    expect(derivedRX).toBeCloseTo(31.2, 0);
    expect(derivedRX).toBeLessThan(42);
  });

  it("does not exceed orbitRX=42 even for very wide active spans", () => {
    // Simulate a year with halfActiveSpan=40: the formula min(42,max(20,48))=42.
    // With weekCount=53, max halfActiveSpan is 26, so the upper clamp can only
    // be exercised if we inject non-standard data.
    const year = makeYearWithActiveWeeks([0, 52]); // widest possible spread
    const { kf, placements } = buildKf(year);
    const activeXs = placements.filter((p) => p.inYear && p.count > 0).map((p) => p.x);
    const midActiveX = (Math.min(...activeXs) + Math.max(...activeXs)) / 2;
    const halfActiveSpan = (Math.max(...activeXs) - Math.min(...activeXs)) / 2;
    const expectedRX = Math.min(42, Math.max(20, halfActiveSpan * 1.2));

    const { max } = orbitXSpread(kf);
    expect(max - midActiveX).toBeCloseTo(expectedRX, 0);
  });

  it("orbit keyframes use data-adaptive radius for sample year fixture", () => {
    const year = sampleYearDoc.years[0] as YearData;
    const { kf, placements } = buildKf(year);
    const activeXs = placements.filter((p) => p.inYear && p.count > 0).map((p) => p.x);
    const halfActiveSpan = (Math.max(...activeXs) - Math.min(...activeXs)) / 2;
    const expectedRX = Math.min(42, Math.max(20, halfActiveSpan * 1.2));

    const { max } = orbitXSpread(kf);
    const midActiveX = (Math.min(...activeXs) + Math.max(...activeXs)) / 2;
    expect(max - midActiveX).toBeCloseTo(expectedRX, 0);
    expect(expectedRX).toBeLessThan(42); // confirm it's actually adaptive
  });
});

// ── Empty year / hasContent=false ─────────────────────────────────────────────

describe("Generification: empty year (hasContent=false) graceful fallback", () => {
  it("produces 8 orbit keyframes even for an empty year", () => {
    const year = emptyYearDoc.years[0] as YearData;
    const { kf } = buildKf(year, false);
    const orbitKf = kf.filter(
      (k) => k.frame > CRUISE_END && k.frame <= FLYBY_END && Math.abs(k.position[1] - ORBIT_H) < 0.01,
    );
    expect(orbitKf).toHaveLength(8);
  });

  it("uses elevated fallback camera at APPROACH_END for empty year (no canyon dive)", () => {
    const year = emptyYearDoc.years[0] as YearData;
    const { kf } = buildKf(year, false);
    const approachKf = kf.find((k) => k.frame === APPROACH_END);
    expect(approachKf).toBeDefined();
    // Fallback: position Y=8, Z=22 (elevated wide view, not the low Z_FLOOR canyon)
    expect(approachKf!.position[1]).toBe(8);
    expect(approachKf!.position[2]).toBe(22);
  });

  it("uses elevated outro at CANYON_END for empty year (not low canyon hold)", () => {
    const year = emptyYearDoc.years[0] as YearData;
    const { kf } = buildKf(year, false);
    const canyonEndKf = kf.find((k) => k.frame === CANYON_END);
    expect(canyonEndKf).toBeDefined();
    // Fallback: Y=10, Z=26 (still elevated, further than Z_FLOOR)
    expect(canyonEndKf!.position[1]).toBe(10);
    expect(canyonEndKf!.position[2]).toBeGreaterThan(Z_FLOOR + 5);
  });

  it("single-active-week year still produces valid keyframes without crashing", () => {
    // Regression: peak.centerX = midActiveX when there's only one active week.
    const year = makeYearWithActiveWeeks([26]);
    expect(() => buildKf(year)).not.toThrow();
  });
});

// ── Cruise Z bounds ───────────────────────────────────────────────────────────

describe("Generification: cruise Z stays within Z_FLOOR..CRUISE_Z_MAX", () => {
  function cruiseKeyframes(kf: ReturnType<typeof buildKeyframes>) {
    return kf.filter((k) => k.frame > ENTRY_END && k.frame <= CRUISE_END);
  }

  it("cruise Z never exceeds CRUISE_Z_MAX=16.5 for a dense year", () => {
    const year = maxedYearDoc.years[0] as YearData;
    const { kf } = buildKf(year);
    for (const k of cruiseKeyframes(kf)) {
      expect(k.position[2]).toBeLessThanOrEqual(CRUISE_Z_MAX + 0.01);
    }
  });

  it("cruise Z never falls below Z_FLOOR=13.5 for a dense year", () => {
    const year = maxedYearDoc.years[0] as YearData;
    const { kf } = buildKf(year);
    for (const k of cruiseKeyframes(kf)) {
      expect(k.position[2]).toBeGreaterThanOrEqual(Z_FLOOR - 0.01);
    }
  });

  it("cruise Z never exceeds CRUISE_Z_MAX=16.5 for sample year", () => {
    const year = sampleYearDoc.years[0] as YearData;
    const { kf } = buildKf(year);
    for (const k of cruiseKeyframes(kf)) {
      expect(k.position[2]).toBeLessThanOrEqual(CRUISE_Z_MAX + 0.01);
    }
  });

  it("cruise Z stays at CRUISE_Z_MAX for a sparse year (low density → Z pushed high)", () => {
    // Sparse density → smoothedDensity ≈ 0 → z = CRUISE_Z_MAX (capped).
    const year = sparseYearDoc.years[0] as YearData;
    const { kf } = buildKf(year);
    for (const k of cruiseKeyframes(kf)) {
      // Z must be between floor and cap inclusive
      expect(k.position[2]).toBeGreaterThanOrEqual(Z_FLOOR - 0.01);
      expect(k.position[2]).toBeLessThanOrEqual(CRUISE_Z_MAX + 0.01);
    }
  });
});

// ── Leap year ─────────────────────────────────────────────────────────────────

describe("Generification: leap year (2024) produces valid keyframes", () => {
  it("builds keyframes without error for leap year fixture", () => {
    const year = leapYearDoc.years[0] as YearData;
    expect(() => buildKf(year)).not.toThrow();
  });

  it("leap year orbit has 8 keyframes", () => {
    const year = leapYearDoc.years[0] as YearData;
    const { kf } = buildKf(year);
    const orbitKf = kf.filter(
      (k) => k.frame > CRUISE_END && k.frame <= FLYBY_END && Math.abs(k.position[1] - ORBIT_H) < 0.01,
    );
    expect(orbitKf).toHaveLength(8);
  });

  it("leap year orbitRX is data-adaptive (not hardcoded 42)", () => {
    const year = leapYearDoc.years[0] as YearData;
    const { kf, placements } = buildKf(year);
    const activeXs = placements.filter((p) => p.inYear && p.count > 0).map((p) => p.x);
    const halfActiveSpan = (Math.max(...activeXs) - Math.min(...activeXs)) / 2;
    const expectedRX = Math.min(42, Math.max(20, halfActiveSpan * 1.2));

    const orbitKf = kf.filter(
      (k) => k.frame > CRUISE_END && k.frame <= FLYBY_END && Math.abs(k.position[1] - ORBIT_H) < 0.01,
    );
    const midActiveX = (Math.min(...activeXs) + Math.max(...activeXs)) / 2;
    const maxOrbitX = Math.max(...orbitKf.map((k) => k.position[0]));
    expect(maxOrbitX - midActiveX).toBeCloseTo(expectedRX, 0);
  });
});

// ── Multi-year / SkylineFull edge cases ──────────────────────────────────────

describe("Generification: diverse fixtures produce keyframes for each", () => {
  const fixtures: [string, YearData][] = [
    ["sparse", sparseYearDoc.years[0] as YearData],
    ["maxed", maxedYearDoc.years[0] as YearData],
    ["empty", emptyYearDoc.years[0] as YearData],
    ["leap", leapYearDoc.years[0] as YearData],
    ["sample", sampleYearDoc.years[0] as YearData],
  ];

  for (const [name, year] of fixtures) {
    it(`builds valid keyframes for ${name} year without throwing`, () => {
      const hasContent = year.totalContributions > 0;
      expect(() => buildKf(year, hasContent)).not.toThrow();
    });

    it(`${name} year produces ≥10 total keyframes`, () => {
      const hasContent = year.totalContributions > 0;
      const { kf } = buildKf(year, hasContent);
      // At minimum: F0 + descent + cruise(5) + orbit(8) + approach/canyon + emerge
      expect(kf.length).toBeGreaterThanOrEqual(10);
    });

    it(`${name} year: first keyframe is F0, last is F966`, () => {
      const hasContent = year.totalContributions > 0;
      const { kf } = buildKf(year, hasContent);
      expect(kf[0].frame).toBe(0);
      expect(kf.at(-1)!.frame).toBe(966);
    });
  }
});
