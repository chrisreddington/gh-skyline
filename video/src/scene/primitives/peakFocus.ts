/**
 * PEAK FOCUS — canyon dive into the busiest district (F690..F906).
 *
 * For years with content: a bridge at F720 (keeps the orbital X-velocity from
 * outrunning the lookAt during the 60-frame gap), an approach at F750, two
 * canyon holds, and a gentle upward drift at F906 so the camera already has
 * lift velocity when the outro arc begins.
 *
 * For empty years (no peak target): a gentle pull-back over the active centre
 * instead, so there's no dead-air spotlight on nothing.
 */
import type { CameraKeyframe } from "../CameraRig";
import { MARKERS } from "./timeline";
import { Z_FLOOR, ORBIT_RZ } from "./constants";
import type { CameraContext } from "./context";

export function buildPeakFocus(ctx: CameraContext): CameraKeyframe[] {
  const { midActiveX } = ctx.activity;
  const { px, peakY } = ctx.peakShot;
  const orbitH = ctx.orbit.h;
  const [orbitFocalX, orbitFocalY] = ctx.orbit.focal;

  if (ctx.hasContent) {
    return [
      {
        frame: 720,
        position: [(midActiveX + (px - 4)) / 2, (orbitH + peakY + 1.4) / 2, (ORBIT_RZ + Z_FLOOR + 4.0) / 2],
        lookAt: [(orbitFocalX + px) / 2, (orbitFocalY + peakY * 0.55) / 2, 0],
        fov: 40,
      },
      {
        frame: MARKERS.approachEnd,
        position: [px - 4, peakY + 1.4, Z_FLOOR + 4.0],
        lookAt: [px, peakY * 0.55, 0],
        fov: 32,
      },
      // ---- Canyon HOLD ----
      {
        frame: MARKERS.approachEnd + 40,
        position: [px - 1.0, peakY + 0.7, Z_FLOOR + 3.5],
        lookAt: [px + 0.8, peakY * 0.5, 0],
        fov: 29,
      },
      {
        frame: MARKERS.approachEnd + 80,
        position: [px + 0.8, peakY + 0.5, Z_FLOOR + 3.4],
        lookAt: [px + 1.5, peakY * 0.48, 0],
        fov: 28,
      },
      // Gentle drift so the camera already has upward velocity at CANYON_END.
      {
        frame: MARKERS.canyonEnd - 20,
        position: [px + 2.5, peakY + 1.0, Z_FLOOR + 3.8],
        lookAt: [px + 1.5, peakY * 0.5, 0],
        fov: 30,
      },
      {
        frame: MARKERS.canyonEnd,
        position: [px + 2.5, peakY + 3.5, Z_FLOOR + 5.5],
        lookAt: [px + 1.5, peakY * 0.55 + 0.8, 0.5],
        fov: 32,
      },
    ];
  }

  // Empty-year fallback: drift back over the active centre.
  return [
    {
      frame: MARKERS.approachEnd,
      position: [midActiveX, 8, 22],
      lookAt: [midActiveX, 1.5, 0],
      fov: 44,
    },
    {
      frame: MARKERS.canyonEnd,
      position: [midActiveX, 10, 26],
      lookAt: [midActiveX, 1.5, 0],
      fov: 48,
    },
  ];
}
