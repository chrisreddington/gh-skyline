/**
 * ESTABLISH — the elevated poster reveal (F0..F75).
 *
 * A true hold at the loop-seam pose: two `cut:true` keyframes that freeze the
 * camera completely until the descent commits at F75. The `cut` on the second
 * keyframe zeroes the outgoing Catmull-Rom tangent so the spline can't
 * anticipate the leftward F120 descent with an early rightward bulge (the
 * "tilt right then slam left" artefact).
 */
import type { CameraKeyframe } from "../CameraRig";
import { MARKERS } from "./timeline";
import type { CameraContext } from "./context";

export function buildEstablish(ctx: CameraContext): CameraKeyframe[] {
  const { position, lookAt, fov } = ctx.loopPose;
  return [
    { frame: 0, position, lookAt, fov, cut: true },
    { frame: MARKERS.collapseStart, position, lookAt, fov, cut: true },
  ];
}
