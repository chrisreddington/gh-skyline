/**
 * CRUISE — low forward flight "riding the weave" (F150..F450).
 *
 * The camera flies L→R along the week axis. A density-weighted speed remap
 * makes it dwell in busy districts and skim quiet stretches; it rises over
 * dense weeks (peak-lift), dips toward the bars, and ramps its look-ahead to
 * zero in the final 20% so it never looks past the last bar.
 */
import type { CameraKeyframe } from "../CameraRig";
import { densityAt, peakLiftAtX } from "../CameraRig";
import { MARKERS } from "./timeline";
import { Z_FLOOR, CRUISE_Z_MAX } from "./constants";
import { lerpSpeedRemap, type CameraContext } from "./context";

/** Number of interior cruise knots sampled along the year span. */
const CRUISE_SAMPLES = 5;

export function buildCruise(ctx: CameraContext): CameraKeyframe[] {
  const { geom, cruiseSpan } = ctx.activity;
  const { densityCurve, placements, speedRemap } = ctx;

  const k: CameraKeyframe[] = [];
  let smoothedDensity = densityAt(densityCurve, geom.originX);
  for (let i = 1; i <= CRUISE_SAMPLES; i++) {
    const u = i / CRUISE_SAMPLES;
    const t = lerpSpeedRemap(speedRemap, u);
    const x = geom.originX + t * cruiseSpan;
    const rawDensity = densityAt(densityCurve, x);
    smoothedDensity = smoothedDensity * 0.75 + rawDensity * 0.25;
    const lift = peakLiftAtX(x, placements);
    // Cap cruise Z at 16.5 (entry Z = Z_FLOOR+2.5 = 16) — prevents camera from
    // zooming further out than its arrival position on sparse sections.
    const z = Math.max(Z_FLOOR, CRUISE_Z_MAX - smoothedDensity * (CRUISE_Z_MAX - Z_FLOOR));
    const y = Math.max(5.0, 5.4 + (lift - 2.4) * 0.45);
    const fov = 42 - smoothedDensity * 4;
    const lookY = smoothedDensity > 0.4 ? 1.2 + smoothedDensity * 1.0 : 0.8;
    // Ramp look-ahead from 4 → 0 in the final 20% of cruise.
    const endRamp = Math.max(0, (u - 0.8) / 0.2);
    const lookAhead = 4 * (1 - endRamp);
    const frame = MARKERS.entryEnd + Math.round(u * (MARKERS.cruiseEnd - MARKERS.entryEnd));
    k.push({ frame, position: [x, y, z], lookAt: [x + lookAhead, lookY, 0], fov });
  }
  return k;
}
