/**
 * OUTRO — pull back to the "screenshot moment" (F906..F966, hold to F1146).
 *
 * A single arc keyframe at F936 bridges the canyon exit to the loop-seam pose,
 * then one final keyframe at F966 lands on the exact establish pose. No keyframe
 * is added at TOTAL: sampleRig clamps to the last keyframe for all frames ≥ it,
 * giving a rock-solid static hold (adding a duplicate at TOTAL reintroduces
 * drift via a non-zero Catmull-Rom tangent at F966).
 */
import type { CameraKeyframe } from "../CameraRig";
import { MARKERS } from "./timeline";
import type { CameraContext } from "./context";

export function buildOutro(ctx: CameraContext): CameraKeyframe[] {
  const { midActiveX } = ctx.activity;
  const { position, lookAt, fov } = ctx.loopPose;
  return [
    {
      frame: MARKERS.canyonEnd + 30, // 936 — arc midpoint
      position: [midActiveX - 1, 16, 38],
      lookAt: [midActiveX, 3.5, -1],
      fov: 39,
    },
    {
      frame: MARKERS.emergeEnd, // 966 — lands on the loop-seam pose
      position,
      lookAt,
      fov,
    },
  ];
}
