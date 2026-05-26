import { describe, expect, it } from "vitest";
import { peakLiftAtX, sampleRig, type CameraKeyframe } from "../scene/CameraRig";
import type { BarPlacement } from "../utils/grid";

const keyframes: CameraKeyframe[] = [
  { frame: 0, position: [0, 4, 12], lookAt: [0, 1, 0], fov: 42 },
  { frame: 60, position: [8, 5, 10], lookAt: [10, 1, 0], fov: 28 },
  { frame: 120, position: [12, 4, 14], lookAt: [6, 1, 0], fov: 40 },
];

describe("sampleRig", () => {
  it("keeps lookAt velocity smooth around keyframe boundaries", () => {
    const before = sampleRig(58, keyframes);
    const at = sampleRig(60, keyframes);
    const after = sampleRig(62, keyframes);

    const leftVelocity = at.lookAt[0] - before.lookAt[0];
    const rightVelocity = after.lookAt[0] - at.lookAt[0];

    expect(Math.abs(rightVelocity - leftVelocity)).toBeLessThan(0.06);
  });

  it("keeps fov velocity smooth around keyframe boundaries", () => {
    const before = sampleRig(58, keyframes).fov;
    const at = sampleRig(60, keyframes).fov;
    const after = sampleRig(62, keyframes).fov;

    const leftVelocity = at - before;
    const rightVelocity = after - at;

    expect(Math.abs(rightVelocity - leftVelocity)).toBeLessThan(0.15);
  });
});

describe("peakLiftAtX", () => {
  it("smooths isolated outliers instead of snapping to a raw local max", () => {
    const placements: BarPlacement[] = [
      {
        instanceIndex: 0,
        weekIndex: 0,
        weekday: 0,
        x: -0.8,
        z: 0,
        height: 1,
        level: 1,
        count: 1,
        inYear: true,
        date: "2025-01-01",
      },
      {
        instanceIndex: 1,
        weekIndex: 1,
        weekday: 0,
        x: 0,
        z: 0,
        height: 6,
        level: 4,
        count: 42,
        inYear: true,
        date: "2025-01-02",
      },
      {
        instanceIndex: 2,
        weekIndex: 2,
        weekday: 0,
        x: 0.8,
        z: 0,
        height: 1,
        level: 1,
        count: 1,
        inYear: true,
        date: "2025-01-03",
      },
    ];

    const lift = peakLiftAtX(0, placements, 1, 1.8, 6);
    expect(lift).toBeLessThan(5.2);
  });
});
