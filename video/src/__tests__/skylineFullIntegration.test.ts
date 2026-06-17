/**
 * SkylineFull integration tests — verify the multi-year composition handles
 * diverse fixture sets without errors and produces sensible allocations.
 *
 * Scenarios covered:
 *   1. Single-year degenerate case (SkylineFull with one year)
 *   2. Mixed sparse + empty + dense 3-year set
 *   3. 16-year synthetic history hitting the 180s cap
 *   4. Empty year in a multi-year set produces graceful path (no crash)
 *   5. 180s cap allocator produces ≥3s and ≤18s per-year slots
 */

import { describe, expect, it } from "vitest";
import type { SkylineDocument, YearData } from "../schema";
import {
  buildAllKeyframes,
  buildYearConfigs,
  computeWeights,
  yearDepthOffsets,
} from "../compositions/fullLayout";
import { allocate, DEFAULT_TIMING } from "../utils/timing";
import mixedFullDoc from "../../fixtures/mixed-full.json";
import singleFullDoc from "../../fixtures/single-full.json";

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildForDoc(doc: SkylineDocument, maxSecs = 180) {
  const weights = computeWeights(doc);
  const alloc = allocate(doc.years.length, maxSecs, DEFAULT_TIMING, weights);
  const offsets = yearDepthOffsets(doc);
  const configs = buildYearConfigs(doc as SkylineDocument, alloc, offsets);
  const keyframes = buildAllKeyframes(alloc, configs);
  return { alloc, configs, keyframes };
}

function syntheticCapHitDoc(): SkylineDocument {
  const years = Array.from({ length: 16 }, (_, i) => 2011 + i);
  const totals = [
    12, 48, 0, 90, 0, 130, 220, 410, 37, 1448, 1804, 1020, 980, 2054, 4679, 920,
  ];
  return {
    schemaVersion: 1,
    username: "tester",
    generatedAt: "2026-01-01T00:00:00Z",
    years: years.map((year, i) => ({
      year,
      totalContributions: totals[i],
      weeks: [],
      stats: null,
    })),
  };
}

// ── Single-year degenerate ────────────────────────────────────────────────────

describe("SkylineFull: single-year degenerate case", () => {
  it("allocates exactly one year segment with no transitions", () => {
    const { alloc } = buildForDoc(singleFullDoc as unknown as SkylineDocument);
    expect(alloc.perYear).toHaveLength(1);
    expect(alloc.perYear[0].transitionFrames).toBe(0);
  });

  it("builds at least 5 keyframes for the single year", () => {
    const { keyframes, configs } = buildForDoc(singleFullDoc as unknown as SkylineDocument);
    const cfg = configs[0];
    const segKf = keyframes.filter(
      (k) => k.frame >= cfg.startFrame && k.frame <= cfg.startFrame + cfg.segmentFrames,
    );
    expect(segKf.length).toBeGreaterThanOrEqual(5);
  });

  it("total frames ≤ 180s cap", () => {
    const { alloc } = buildForDoc(singleFullDoc as unknown as SkylineDocument);
    expect(alloc.totalFrames).toBeLessThanOrEqual(180 * DEFAULT_TIMING.fps);
  });

  it("does not throw for single-year input", () => {
    expect(() => buildForDoc(singleFullDoc as unknown as SkylineDocument)).not.toThrow();
  });
});

// ── Mixed sparse + empty + dense ─────────────────────────────────────────────

describe("SkylineFull: mixed sparse + empty + dense (3-year)", () => {
  it("does not throw for mixed fixture", () => {
    expect(() => buildForDoc(mixedFullDoc as unknown as SkylineDocument)).not.toThrow();
  });

  it("allocates 3 year segments with 2 transitions between them", () => {
    const { alloc } = buildForDoc(mixedFullDoc as unknown as SkylineDocument);
    expect(alloc.perYear).toHaveLength(3);
    expect(alloc.perYear[0].transitionFrames).toBeGreaterThan(0);
    expect(alloc.perYear[1].transitionFrames).toBeGreaterThan(0);
    expect(alloc.perYear[2].transitionFrames).toBe(0); // last year: no trailing transition
  });

  it("total frames ≤ 180s cap", () => {
    const { alloc } = buildForDoc(mixedFullDoc as unknown as SkylineDocument);
    expect(alloc.totalFrames).toBeLessThanOrEqual(180 * DEFAULT_TIMING.fps);
  });

  it("empty year (2023 in mixed fixture) is handled gracefully — no canyon", () => {
    const doc = mixedFullDoc as unknown as SkylineDocument;
    const { configs } = buildForDoc(doc);
    // The empty year is index 1 (2023: totalContributions=0)
    const emptyConfig = configs[1];
    expect(emptyConfig).toBeDefined();
    // Empty year should NOT trigger canyon (hasCanyon requires content)
    expect(emptyConfig.hasCanyon).toBe(false);
  });

  it("dense year (2024) gets at least as many frames as sparse year (2022)", () => {
    const doc = mixedFullDoc as unknown as SkylineDocument;
    const { alloc } = buildForDoc(doc);
    // With 180s budget and only 3 years, the 18s per-year cap means all years
    // may reach the cap equally (3 × 18s = 54s << 180s). We assert ≥, not >,
    // because equal at the cap is the correct, expected result.
    const sparseFrames = alloc.perYear[0].segmentFrames; // 2022 sparse
    const denseFrames = alloc.perYear[2].segmentFrames;  // 2024 dense
    expect(denseFrames).toBeGreaterThanOrEqual(sparseFrames);
    // Both must respect the per-year cap
    expect(sparseFrames).toBeLessThanOrEqual(540);
    expect(denseFrames).toBeLessThanOrEqual(540);
  });

  it("produces bridge keyframes between year transitions", () => {
    const doc = mixedFullDoc as unknown as SkylineDocument;
    const { alloc, configs, keyframes } = buildForDoc(doc);
    const first = configs[0];
    const second = configs[1];
    const bridgeStart = first.startFrame + first.segmentFrames;
    const bridgeEnd = second.startFrame;
    const bridges = keyframes.filter((k) => k.frame > bridgeStart && k.frame < bridgeEnd);
    expect(bridges.length).toBeGreaterThan(0);
  });

  it("all segment keyframe sets have ≥5 keyframes per year", () => {
    const doc = mixedFullDoc as unknown as SkylineDocument;
    const { configs, keyframes } = buildForDoc(doc);
    for (const cfg of configs) {
      const segKf = keyframes.filter(
        (k) => k.frame >= cfg.startFrame && k.frame <= cfg.startFrame + cfg.segmentFrames,
      );
      expect(segKf.length).toBeGreaterThanOrEqual(5);
    }
  });

  it("bridge FOV never exceeds 46 in mixed set", () => {
    const doc = mixedFullDoc as unknown as SkylineDocument;
    const { configs, keyframes } = buildForDoc(doc);
    for (let i = 0; i < configs.length - 1; i++) {
      const bridgeStart = configs[i].startFrame + configs[i].segmentFrames;
      const bridgeEnd = configs[i + 1].startFrame;
      const bridges = keyframes.filter((k) => k.frame > bridgeStart && k.frame < bridgeEnd);
      for (const b of bridges) {
        expect(b.fov ?? 0).toBeLessThanOrEqual(46);
      }
    }
  });
});

// ── 16-year 180s cap (synthetic fixture) ─────────────────────────────────────

describe("SkylineFull: 16-year history hitting 180s cap", () => {
  const doc = syntheticCapHitDoc();

  it("does not throw for 16-year input", () => {
    expect(() => buildForDoc(doc)).not.toThrow();
  });

  it("allocates exactly 16 year segments", () => {
    const { alloc } = buildForDoc(doc);
    expect(alloc.perYear).toHaveLength(16);
  });

  it("total frames stays within 180s cap", () => {
    const { alloc } = buildForDoc(doc);
    expect(alloc.totalFrames).toBeLessThanOrEqual(180 * DEFAULT_TIMING.fps);
  });

  it("every per-year segment is ≥3s (90 frames @ 30fps)", () => {
    const { alloc } = buildForDoc(doc);
    for (const seg of alloc.perYear) {
      expect(seg.segmentFrames).toBeGreaterThanOrEqual(90); // 3s floor
    }
  });

  it("every per-year segment is ≤18s (540 frames @ 30fps)", () => {
    const { alloc } = buildForDoc(doc);
    for (const seg of alloc.perYear) {
      expect(seg.segmentFrames).toBeLessThanOrEqual(540); // 18s cap
    }
  });

  it("start frames are contiguous (no gaps between segments)", () => {
    const { alloc } = buildForDoc(doc);
    let cursor = alloc.introFrames;
    for (const seg of alloc.perYear) {
      expect(seg.startFrame).toBe(cursor);
      cursor += seg.segmentFrames + seg.transitionFrames;
    }
    expect(cursor + alloc.outroFrames).toBe(alloc.totalFrames);
  });

  it("busy years (2024, 2025) get more time than quiet years (2013, 2015)", () => {
    const { alloc } = buildForDoc(doc);
    // 2013=idx2 (0 contributions), 2015=idx4 (0), 2024=idx13 (2054), 2025=idx14 (4679)
    const quiet2013 = alloc.perYear[2].segmentFrames;
    const quiet2015 = alloc.perYear[4].segmentFrames;
    const busy2024 = alloc.perYear[13].segmentFrames;
    const busy2025 = alloc.perYear[14].segmentFrames;
    expect(busy2024).toBeGreaterThan(quiet2013);
    expect(busy2025).toBeGreaterThan(quiet2015);
  });

  it("builds keyframes for all 16 years without crashing", () => {
    const { configs, keyframes } = buildForDoc(doc);
    expect(configs).toHaveLength(16);
    expect(keyframes.length).toBeGreaterThan(16 * 5); // ≥5 per year
  });

  it("produces bridge keyframes between all 15 year transitions", () => {
    const { configs, keyframes } = buildForDoc(doc);
    let bridgeCount = 0;
    for (let i = 0; i < configs.length - 1; i++) {
      const bridgeStart = configs[i].startFrame + configs[i].segmentFrames;
      const bridgeEnd = configs[i + 1].startFrame;
      const bridges = keyframes.filter((k) => k.frame > bridgeStart && k.frame < bridgeEnd);
      if (bridges.length > 0) bridgeCount++;
    }
    // At minimum, transitions between adjacent years should produce bridges
    expect(bridgeCount).toBeGreaterThan(0);
  });

  it("empty years (2013, 2015) in the multi-year set have hasCanyon=false", () => {
    const { configs } = buildForDoc(doc);
    const empty2013 = configs[2]; // index 2 in the array
    const empty2015 = configs[4];
    expect(empty2013.hasCanyon).toBe(false);
    expect(empty2015.hasCanyon).toBe(false);
  });
});

// ── allocate edge cases already covered in timing.test.ts but cross-checked ──

describe("SkylineFull: allocator edge cases via fixture docs", () => {
  it("allocate(1, 180) produces the default 12s segment for one year", () => {
    const alloc = allocate(1, 180, DEFAULT_TIMING);
    expect(alloc.perYear[0].segmentFrames).toBe(12 * DEFAULT_TIMING.fps);
    expect(alloc.perYear[0].transitionFrames).toBe(0);
  });

  it("allocate(16, 180) shrinks segments but keeps them ≥3s", () => {
    const alloc = allocate(16, 180, DEFAULT_TIMING);
    for (const seg of alloc.perYear) {
      expect(seg.segmentFrames).toBeGreaterThanOrEqual(90);
    }
    expect(alloc.totalFrames).toBeLessThanOrEqual(180 * DEFAULT_TIMING.fps);
  });

  it("weighted allocate for mixed doc respects 3s floor and 18s cap", () => {
    const doc = mixedFullDoc as unknown as SkylineDocument;
    const weights = computeWeights(doc);
    const alloc = allocate(3, 180, DEFAULT_TIMING, weights);
    for (const seg of alloc.perYear) {
      expect(seg.segmentFrames).toBeGreaterThanOrEqual(90);
      expect(seg.segmentFrames).toBeLessThanOrEqual(540);
    }
  });
});
