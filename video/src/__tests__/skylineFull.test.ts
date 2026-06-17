import { describe, expect, it } from "vitest";
import {
  buildAllKeyframes,
  buildYearConfigs,
  computeWeights,
  revealCameraX,
  yearDepthOffsets,
} from "../compositions/fullLayout";
import type { SkylineDocument, YearData } from "../schema";
import { allocate, DEFAULT_TIMING } from "../utils/timing";

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

function makeWeek(startDate: string, counts: number[]): YearData["weeks"][number] {
  return {
    weekIndex: 0,
    startDate,
    days: counts.map((count, i) => ({
      date: `2025-01-0${i + 1}`,
      count,
      weekday: i,
    })),
  };
}

function storyDoc(): SkylineDocument {
  return {
    schemaVersion: 1,
    username: "octocat",
    generatedAt: "2026-05-26T00:00:00Z",
    years: [
      {
        year: 2024,
        totalContributions: 40,
        weeks: [makeWeek("2023-12-31", [0, 1, 0, 1, 0, 1, 0])],
        stats: null,
      },
      {
        year: 2025,
        totalContributions: 4000,
        weeks: [makeWeek("2024-12-29", [20, 30, 25, 35, 28, 32, 26])],
        stats: null,
      },
    ],
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

describe("buildYearConfigs", () => {
  it("uses stronger sparse-vs-dense framing spread", () => {
    const doc = storyDoc();
    const alloc = allocate(doc.years.length, 180, DEFAULT_TIMING, computeWeights(doc));
    const offsets = yearDepthOffsets(doc);
    const [sparse, dense] = buildYearConfigs(doc, alloc, offsets);
    expect(sparse.framingScale - dense.framingScale).toBeGreaterThanOrEqual(0.5);
    expect(sparse.fovBoost).toBeGreaterThanOrEqual(8);
  });
});

describe("buildAllKeyframes", () => {
  it("adds bridge keyframes during year-to-year transitions", () => {
    const doc = storyDoc();
    const alloc = allocate(doc.years.length, 180, DEFAULT_TIMING, computeWeights(doc));
    const offsets = yearDepthOffsets(doc);
    const configs = buildYearConfigs(doc, alloc, offsets);
    const keyframes = buildAllKeyframes(alloc, configs);
    const first = configs[0];
    const second = configs[1];
    const hasBridge = keyframes.some((k) =>
      k.frame > first.startFrame + first.segmentFrames && k.frame < second.startFrame
    );
    expect(hasBridge).toBe(true);
  });

  it("keeps bridge transitions from zooming excessively wide", () => {
    const doc = storyDoc();
    const alloc = allocate(doc.years.length, 180, DEFAULT_TIMING, computeWeights(doc));
    const offsets = yearDepthOffsets(doc);
    const configs = buildYearConfigs(doc, alloc, offsets);
    const keyframes = buildAllKeyframes(alloc, configs);
    const first = configs[0];
    const second = configs[1];
    const bridge = keyframes.filter((k) =>
      k.frame > first.startFrame + first.segmentFrames && k.frame < second.startFrame
    );
    expect(bridge.length).toBeGreaterThan(0);
    expect(Math.max(...bridge.map((k) => k.fov ?? 0))).toBeLessThanOrEqual(46);
  });

  it("creates a multi-step pan path within each year segment", () => {
    const doc = storyDoc();
    const alloc = allocate(doc.years.length, 180, DEFAULT_TIMING, computeWeights(doc));
    const offsets = yearDepthOffsets(doc);
    const configs = buildYearConfigs(doc, alloc, offsets);
    const keyframes = buildAllKeyframes(alloc, configs);

    for (const cfg of configs) {
      const withinSegment = keyframes.filter((k) =>
        k.frame >= cfg.startFrame && k.frame <= cfg.startFrame + cfg.segmentFrames
      );
      expect(withinSegment.length).toBeGreaterThanOrEqual(5);
    }
  });
});

describe("revealCameraX", () => {
  it("eases reveal speed so segment edges are slower than the middle", () => {
    const doc = storyDoc();
    const alloc = allocate(doc.years.length, 180, DEFAULT_TIMING, computeWeights(doc));
    const offsets = yearDepthOffsets(doc);
    const [cfg] = buildYearConfigs(doc, alloc, offsets);
    const earlyFrame = cfg.startFrame + Math.floor(cfg.segmentFrames * 0.15);
    const midFrame = cfg.startFrame + Math.floor(cfg.segmentFrames * 0.5);
    const lateFrame = cfg.startFrame + Math.floor(cfg.segmentFrames * 0.85);

    const earlyStart = revealCameraX(earlyFrame - 2, cfg);
    const earlyEnd = revealCameraX(earlyFrame + 2, cfg);
    const midStart = revealCameraX(midFrame - 2, cfg);
    const midEnd = revealCameraX(midFrame + 2, cfg);
    const lateStart = revealCameraX(lateFrame - 2, cfg);
    const lateEnd = revealCameraX(lateFrame + 2, cfg);

    const earlyDelta = earlyEnd - earlyStart;
    const midDelta = midEnd - midStart;
    const lateDelta = lateEnd - lateStart;

    expect(midDelta).toBeGreaterThan(earlyDelta);
    expect(midDelta).toBeGreaterThan(lateDelta);
  });
});
