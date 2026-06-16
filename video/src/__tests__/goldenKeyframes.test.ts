/**
 * Golden keyframe snapshot — PARITY BASELINE for the primitives refactor.
 *
 * This locks the exact `buildKeyframes` output (camera position / lookAt / fov /
 * cut, per frame) for every fixture BEFORE the monolith is decomposed into
 * primitives. During the safety-first migration (extract context → peel
 * primitives → add joins module) these snapshots MUST stay byte-identical.
 *
 * Only when we deliberately re-choreograph (the "open season" phase) do we
 * update these snapshots — and each update must be justified by a visual review.
 *
 * If a snapshot changes unexpectedly during a parity step, the refactor altered
 * behaviour and must be corrected before proceeding.
 */
import { describe, expect, it } from "vitest";
import type { SkylineDocument, YearData } from "../schema";
import { buildRelativeDensityCurve } from "../scene/CameraRig";
import { buildKeyframes, pickPeakTarget } from "../compositions/SkylineYear";
import { layoutBars } from "../utils/grid";
import emptyYearDoc from "../../fixtures/empty-year.json";
import sparseYearDoc from "../../fixtures/sparse-year.json";
import maxedYearDoc from "../../fixtures/maxed-year.json";
import leapYearDoc from "../../fixtures/leap-year.json";
import sampleYearDoc from "../../fixtures/sample-year.json";

/** Round a coordinate triple to 6 dp so snapshots are stable, readable, and
 *  free of float-formatting noise while still catching any real drift. */
function round3(v: readonly [number, number, number]): [number, number, number] {
  return [
    Math.round(v[0] * 1e6) / 1e6,
    Math.round(v[1] * 1e6) / 1e6,
    Math.round(v[2] * 1e6) / 1e6,
  ];
}

/** Build the full keyframe list for a fixture document's first year, mirroring
 *  exactly how the SkylineYear component constructs buildKeyframes inputs. */
function goldenFor(doc: SkylineDocument) {
  const year = doc.years[0] as YearData;
  const placements = layoutBars(year);
  const hasContent = year.totalContributions > 0;
  const densityCurve = buildRelativeDensityCurve(placements, 64, 2.5);
  const peak = pickPeakTarget(year, placements, 0);
  const keyframes = buildKeyframes(year, placements, peak, densityCurve, hasContent);
  return keyframes.map((k) => ({
    frame: k.frame,
    position: round3(k.position),
    lookAt: round3(k.lookAt),
    fov: k.fov === undefined ? undefined : Math.round(k.fov * 1e6) / 1e6,
    cut: k.cut ?? false,
  }));
}

const FIXTURES: Array<[string, SkylineDocument]> = [
  ["sample", sampleYearDoc as unknown as SkylineDocument],
  ["sparse", sparseYearDoc as unknown as SkylineDocument],
  ["maxed", maxedYearDoc as unknown as SkylineDocument],
  ["empty", emptyYearDoc as unknown as SkylineDocument],
  ["leap", leapYearDoc as unknown as SkylineDocument],
];

describe("Golden keyframes (parity baseline for primitives refactor)", () => {
  for (const [name, doc] of FIXTURES) {
    it(`buildKeyframes output is stable for the ${name} fixture`, () => {
      expect(goldenFor(doc)).toMatchSnapshot();
    });
  }
});
