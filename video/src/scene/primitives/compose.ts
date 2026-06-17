/**
 * compose — stitch the six SkylineYear camera primitives into one keyframe
 * track.
 *
 * Each primitive emits the keyframes (including its leading bridge) for its
 * phase window. `composeYearCamera` concatenates them in phase order and sorts
 * by frame, exactly as the original monolith did. The loop seam is guaranteed
 * because ESTABLISH's first keyframe and OUTRO's last keyframe both use
 * `ctx.loopPose`.
 */
import type { CameraKeyframe } from "../CameraRig";
import type { CameraContext } from "./context";
import { buildEstablish } from "./establish";
import { buildApproachCollapse } from "./approachCollapse";
import { buildCruise } from "./cruise";
import { buildPanoramaOrbit } from "./panoramaOrbit";
import { buildPeakFocus } from "./peakFocus";
import { buildOutro } from "./outro";

export function composeYearCamera(ctx: CameraContext): CameraKeyframe[] {
  const k: CameraKeyframe[] = [
    ...buildEstablish(ctx),
    ...buildApproachCollapse(ctx),
    ...buildCruise(ctx),
    ...buildPanoramaOrbit(ctx),
    ...buildPeakFocus(ctx),
    ...buildOutro(ctx),
  ];
  k.sort((a, b) => a.frame - b.frame);
  return k;
}
