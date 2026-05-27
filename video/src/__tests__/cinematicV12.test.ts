import { describe, expect, it } from "vitest";
import sampleYearDoc from "../../fixtures/sample-year.json";
import type { YearData } from "../schema";
import { buildRelativeDensityCurve } from "../scene/CameraRig";
import {
  buildKeyframes,
  fmtWeekRange,
  pickPeakTarget,
} from "../compositions/SkylineYear";
import {
  computeCollapseMultiplier,
  computeFocusMultiplier,
} from "../scene/Skyline";
import { layoutBars } from "../utils/grid";

const year = sampleYearDoc.years[0] as YearData;

describe("SkylineYear cinematic v12 choreography", () => {
  it("builds structured peak-week captions with a formatted range", () => {
    const placements = layoutBars(year);
    const peak = pickPeakTarget(year, placements, 0);

    expect(peak.caption).toEqual({
      count: year.stats?.peakWeek?.total,
      label: "PEAK WEEK",
      dateRange: fmtWeekRange(year.stats!.peakWeek!.startDate),
    });
  });

  it("ends at the elevated overhead outro position at the loop point", () => {
    const placements = layoutBars(year);
    const densityCurve = buildRelativeDensityCurve(placements, 64, 2.5);
    const peak = pickPeakTarget(year, placements, 0);
    const keyframes = buildKeyframes(year, placements, peak, densityCurve, true);
    const activeXs = placements.filter((p) => p.inYear && p.count > 0).map((p) => p.x);
    const midActiveX = (Math.min(...activeXs) + Math.max(...activeXs)) / 2;

    // Frame 0: side-view hero card angle (title card)
    expect(keyframes[0]).toMatchObject({
      frame: 0,
      position: [midActiveX + 14, 10, 20],
      lookAt: [midActiveX - 2, 1.8, 0],
      fov: 38,
      cut: true,
    });
    // Frame 966: v21 horizon outro — camera raised + look-down per partnership
    // iteration with cinematographer. pos Y 20, lookAt Y 3 gives a 16.6°
    // depression (vs v18d's 10.9°) — skyline silhouette lifts into the
    // lower-middle band of the frame, filling the gap between "Your skyline."
    // and "Let's build.". FOV 30° (~45mm) preserved for telephoto compression.
    expect(keyframes.at(-1)).toMatchObject({
      frame: 966,
      position: [midActiveX, 20, 57],
      lookAt: [midActiveX, 3, 0],
      fov: 30,
    });
  });

  it("starts the helicopter orbit after cruise without duplicating frame 480", () => {
    const placements = layoutBars(year);
    const densityCurve = buildRelativeDensityCurve(placements, 64, 2.5);
    const peak = pickPeakTarget(year, placements, 0);
    const keyframes = buildKeyframes(year, placements, peak, densityCurve, true);

    // Orbit keyframes are in range (450, 690] with orbitH=9 camera height.
    const orbitKeyframes = keyframes.filter(
      (kf) =>
        kf.frame > 450 &&
        kf.frame <= 690 &&
        Math.abs(kf.position[1] - 9) < 0.01,
    );

    expect(orbitKeyframes).toHaveLength(8);
    expect(orbitKeyframes[0]?.frame).toBe(480);
    expect(orbitKeyframes.at(-1)?.frame).toBe(690);
  });
});

describe("Skyline v12 bar multipliers", () => {
  it("collapses bars from right to left during the wave-down", () => {
    const leftStanding = computeCollapseMultiplier(0, 0, 30, 0.5, 9);
    const midRetracting = computeCollapseMultiplier(20, 0, 30, 0.5, 9);
    const rightCollapsed = computeCollapseMultiplier(30, 0, 30, 0.5, 9);

    expect(leftStanding).toBeCloseTo(1, 5);
    expect(midRetracting).toBeLessThan(leftStanding);
    expect(midRetracting).toBeGreaterThan(rightCollapsed);
    expect(rightCollapsed).toBe(0);
  });

  it("keeps highlighted peak bars full-height while shrinking other bars to 20%", () => {
    expect(computeFocusMultiplier(12, 1, [12, 14])).toBe(1);
    expect(computeFocusMultiplier(10, 1, [12, 14])).toBeCloseTo(0.2, 5);
  });
});
