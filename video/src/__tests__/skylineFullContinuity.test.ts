/**
 * SkylineFull year-boundary continuity guard.
 *
 * This composition's visible roughness historically came from transitions
 * BETWEEN years, not inside a single year shot. We therefore assert the
 * per-frame change of velocity (|Δv|) stays below the SkylineYear-established
 * ceiling (0.13) across every year boundary window:
 *
 *   [segmentEnd, bridgeMid, nextStart-1, nextStart, nextStart+1]
 *
 * We intentionally ignore cut frames (outro hard cut) and do not enforce a
 * global ceiling here because SkylineFull has deliberately different macro
 * beats than SkylineYear. This guard is scoped to the quality target we care
 * about: smooth year-to-year handoffs.
 */
import { describe, expect, it } from "vitest";
import type { SkylineDocument } from "../schema";
import { sampleRig } from "../scene/CameraRig";
import {
  buildAllKeyframes,
  buildYearConfigs,
  computeWeights,
  yearDepthOffsets,
} from "../compositions/fullLayout";
import { allocate, DEFAULT_TIMING } from "../utils/timing";

import mixedFullDoc from "../../fixtures/mixed-full.json";
import singleFullDoc from "../../fixtures/single-full.json";

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

const FIXTURES: Array<[string, SkylineDocument]> = [
  ["mixed", mixedFullDoc as unknown as SkylineDocument],
  ["single", singleFullDoc as unknown as SkylineDocument],
  ["sample16", syntheticCapHitDoc()],
];

/** Shared with SkylineYear guard: transitions above this read as yanks. */
const YEAR_BOUNDARY_DV_CEILING = 0.13;

function buildForDoc(doc: SkylineDocument) {
  const alloc = allocate(doc.years.length, 180, DEFAULT_TIMING, computeWeights(doc));
  const configs = buildYearConfigs(doc, alloc, yearDepthOffsets(doc));
  const keyframes = buildAllKeyframes(alloc, configs);
  return { alloc, configs, keyframes };
}

function samplePositions(totalFrames: number, keyframes: ReturnType<typeof buildForDoc>["keyframes"]) {
  const pos: Array<[number, number, number]> = [];
  for (let f = 0; f <= totalFrames; f++) pos.push(sampleRig(f, keyframes).position);
  return pos;
}

function deltaV(pos: Array<[number, number, number]>, f: number): number {
  const v0: [number, number, number] = [
    pos[f][0] - pos[f - 1][0],
    pos[f][1] - pos[f - 1][1],
    pos[f][2] - pos[f - 1][2],
  ];
  const v1: [number, number, number] = [
    pos[f + 1][0] - pos[f][0],
    pos[f + 1][1] - pos[f][1],
    pos[f + 1][2] - pos[f][2],
  ];
  return Math.hypot(v1[0] - v0[0], v1[1] - v0[1], v1[2] - v0[2]);
}

describe("SkylineFull year-boundary continuity", () => {
  for (const [name, doc] of FIXTURES) {
    it(`keeps every year transition smooth for ${name}`, () => {
      const { alloc, configs, keyframes } = buildForDoc(doc);
      const cuts = new Set(keyframes.filter((k) => k.cut).map((k) => k.frame));
      const pos = samplePositions(alloc.totalFrames, keyframes);

      for (let i = 0; i < configs.length - 1; i++) {
        const segEnd = configs[i].startFrame + configs[i].segmentFrames;
        const nextStart = configs[i + 1].startFrame;
        const bridgeMid = segEnd + Math.floor((nextStart - segEnd) * 0.52);
        const frames = [segEnd, bridgeMid, nextStart - 1, nextStart, nextStart + 1];
        for (const f of frames) {
          if (f <= 1 || f >= alloc.totalFrames - 1) continue;
          if (cuts.has(f) || cuts.has(f + 1)) continue;
          const dv = deltaV(pos, f);
          expect(
            dv,
            `${name}: transition ${i} frame F${f} Δv ${dv.toFixed(4)} exceeds ${YEAR_BOUNDARY_DV_CEILING}`,
          ).toBeLessThan(YEAR_BOUNDARY_DV_CEILING);
        }
      }
    });
  }
});
