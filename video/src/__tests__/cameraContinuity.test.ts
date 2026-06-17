/**
 * Camera continuity guard for the SkylineYear primitives.
 *
 * The keyframe spline is C¹ by construction (sampleRig uses a time-normalised
 * Catmull-Rom), so a "jerk" the viewer notices shows up as a spike in the
 * per-frame change of velocity Δv(f) = v(f+1) − v(f) — i.e. acceleration. This
 * test samples every fixture frame-by-frame and asserts that:
 *
 *   1. No frame anywhere exceeds GLOBAL_DV_CEILING (catches a gross new jerk).
 *   2. Every non-cut phase join stays under JOIN_DV_CEILING (catches a bad
 *      keyframe whose implied velocity contradicts its neighbours).
 *
 * The thresholds sit just above the values the current, user-approved
 * choreography produces across all five fixtures (measured global max ≈ 0.115,
 * worst non-cut join — the intentional dive at F120/F150 — ≈ 0.099). Any
 * open-season change that makes the camera SMOOTHER keeps this green; a change
 * that reintroduces a yank fails it.
 */
import { describe, expect, it } from "vitest";
import type { SkylineDocument, YearData } from "../schema";
import { buildRelativeDensityCurve, sampleRig } from "../scene/CameraRig";
import { buildKeyframes, pickPeakTarget } from "../compositions/SkylineYear";
import { layoutBars } from "../utils/grid";
import { SKYLINE_YEAR_TOTAL_FRAMES } from "../scene/primitives";

import sampleYearDoc from "../../fixtures/sample-year.json";
import sparseYearDoc from "../../fixtures/sparse-year.json";
import maxedYearDoc from "../../fixtures/maxed-year.json";
import emptyYearDoc from "../../fixtures/empty-year.json";
import leapYearDoc from "../../fixtures/leap-year.json";

const FIXTURES: Array<[string, SkylineDocument]> = [
  ["sample", sampleYearDoc as unknown as SkylineDocument],
  ["sparse", sparseYearDoc as unknown as SkylineDocument],
  ["maxed", maxedYearDoc as unknown as SkylineDocument],
  ["empty", emptyYearDoc as unknown as SkylineDocument],
  ["leap", leapYearDoc as unknown as SkylineDocument],
];

/** Non-cut phase joins (F0 and F75 are deliberate cuts, excluded). */
const JOIN_FRAMES = [120, 150, 210, 270, 330, 390, 450, 465, 690, 720, 750, 906, 936, 966];

/** Worst observed Δv anywhere is ≈0.115 (the dive); ceiling leaves headroom. */
const GLOBAL_DV_CEILING = 0.13;
/** Worst observed non-cut join Δv is ≈0.099 (intentional F120/F150 dive). */
const JOIN_DV_CEILING = 0.11;

const TOTAL = SKYLINE_YEAR_TOTAL_FRAMES;

function keyframesFor(doc: SkylineDocument) {
  const year = doc.years[0] as YearData;
  const placements = layoutBars(year);
  const hasContent = year.totalContributions > 0;
  const densityCurve = buildRelativeDensityCurve(placements, 64, 2.5);
  const peak = pickPeakTarget(year, placements, 0);
  return buildKeyframes(year, placements, peak, densityCurve, hasContent);
}

/** Per-frame sampled camera positions [0..TOTAL]. */
function sampledPositions(doc: SkylineDocument): Array<[number, number, number]> {
  const kf = keyframesFor(doc);
  const pos: Array<[number, number, number]> = [];
  for (let f = 0; f <= TOTAL; f++) pos.push(sampleRig(f, kf).position);
  return pos;
}

/** Velocity (units/frame) entering frame f. */
function velocity(
  pos: Array<[number, number, number]>,
  f: number,
): [number, number, number] {
  return [pos[f][0] - pos[f - 1][0], pos[f][1] - pos[f - 1][1], pos[f][2] - pos[f - 1][2]];
}

/** |Δv| across frame f = magnitude of the change in velocity at f. */
function deltaV(pos: Array<[number, number, number]>, f: number): number {
  const a = velocity(pos, f);
  const b = velocity(pos, f + 1);
  return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
}

describe("SkylineYear camera continuity (C¹ smoothness guard)", () => {
  for (const [name, doc] of FIXTURES) {
    it(`has no gross acceleration spike for the ${name} fixture`, () => {
      const pos = sampledPositions(doc);
      let worst = 0;
      let worstFrame = -1;
      for (let f = 2; f < TOTAL; f++) {
        const dv = deltaV(pos, f);
        if (dv > worst) {
          worst = dv;
          worstFrame = f;
        }
      }
      expect(
        worst,
        `${name}: worst Δv ${worst.toFixed(4)} at F${worstFrame} exceeds ceiling`,
      ).toBeLessThan(GLOBAL_DV_CEILING);
    });

    it(`keeps every non-cut join smooth for the ${name} fixture`, () => {
      const pos = sampledPositions(doc);
      for (const j of JOIN_FRAMES) {
        const dv = deltaV(pos, j);
        expect(
          dv,
          `${name}: join F${j} Δv ${dv.toFixed(4)} exceeds ceiling`,
        ).toBeLessThan(JOIN_DV_CEILING);
      }
    });
  }
});
