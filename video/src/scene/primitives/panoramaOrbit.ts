/**
 * PANORAMA — full 360° helicopter orbit (F450..F690).
 *
 * Eight knots sweep a complete circle around a FIXED focal centre (see
 * buildCameraContext), giving a true "circle-the-building" inspection feel.
 * A bridge keyframe at F465 eases the cruise exit (looking at the last bar,
 * Z≈16.5, Y≈5.4) into the first orbit pose (Y=ORBIT_H, Z=orbit seg-1).
 */
import type { CameraKeyframe } from "../CameraRig";
import { MARKERS } from "./timeline";
import { ORBIT_RZ } from "./constants";
import type { CameraContext } from "./context";

/** Number of orbital knots (one full revolution). */
const ORBIT_SEGMENTS = 8;

export function buildPanoramaOrbit(ctx: CameraContext): CameraKeyframe[] {
  const { midActiveX, lastActiveX } = ctx.activity;
  const orbitRX = ctx.orbit.rx;
  const orbitH = ctx.orbit.h;
  const [orbitFocalX, orbitFocalY, orbitFocalZ] = ctx.orbit.focal;
  const orbitFrames = MARKERS.flybyEnd - MARKERS.cruiseEnd; // 240 frames

  const k: CameraKeyframe[] = [];

  // Cruise→orbit bridge at F465. Y=7 is a midpoint between cruise exit (~5.4)
  // and ORBIT_H=9; Z=17.25 between CRUISE_Z_MAX and the seg-1 orbit Z. lookX
  // interpolates from the final bar (≈lastActiveX) to the fixed orbit focal.
  const bridgeLookX0 = lastActiveX;
  const seg1CamX = midActiveX + orbitRX * Math.sin(Math.PI / 4);
  k.push({
    frame: 465,
    position: [(lastActiveX + seg1CamX) / 2, 7, 17.25],
    lookAt: [(bridgeLookX0 + orbitFocalX) / 2, 1.9, 0],
    fov: 45,
  });

  for (let seg = 1; seg <= ORBIT_SEGMENTS; seg++) {
    const theta = (seg / ORBIT_SEGMENTS) * Math.PI * 2;
    const orbitFrame = MARKERS.cruiseEnd + Math.round((seg / ORBIT_SEGMENTS) * orbitFrames);
    const camX = midActiveX + orbitRX * Math.sin(theta);
    const camZ = ORBIT_RZ * Math.cos(theta);
    k.push({
      frame: orbitFrame,
      position: [camX, orbitH, camZ],
      lookAt: [orbitFocalX, orbitFocalY, orbitFocalZ],
      fov: 48,
    });
  }
  return k;
}
