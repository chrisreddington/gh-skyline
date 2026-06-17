/**
 * APPROACH + COLLAPSE — drop from helicopter to street (F75..F150).
 *
 * One continuous LEFT-and-DOWN arc. The F120 intermediate prevents Catmull-Rom
 * overshoot on the 75-frame descent (no banana, no direction reversal). The
 * F150 arrival starts far enough left (originX - BUILD_LEAD - 2) that every bar
 * is still AHEAD of the camera when the cruise reveal begins, avoiding a
 * pre-revealed pop.
 */
import type { CameraKeyframe } from "../CameraRig";
import { MARKERS } from "./timeline";
import { BUILD_LEAD, Z_FLOOR } from "./constants";
import type { CameraContext } from "./context";

export function buildApproachCollapse(ctx: CameraContext): CameraKeyframe[] {
  const { geom, midActiveX } = ctx.activity;
  return [
    {
      frame: 120,
      position: [midActiveX - BUILD_LEAD / 2, 9, 15],
      lookAt: [geom.originX + 4, 2.2, 0],
      fov: 39,
    },
    {
      frame: MARKERS.entryEnd,
      position: [geom.originX - BUILD_LEAD - 2, 4.5, Z_FLOOR + 2.5],
      lookAt: [geom.originX + 2, 1.8, 0],
      fov: 42,
    },
  ];
}
