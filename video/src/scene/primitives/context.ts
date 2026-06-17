/**
 * Camera context for the SkylineYear composition.
 *
 * `buildCameraContext` performs every data-derivation the camera grammar needs
 * — grid geometry, the active-bar span, the density speed-remap, the orbit
 * parameters and the peak-focus parameters — exactly once. The camera
 * primitives then read these derived values instead of recomputing them, so the
 * shot grammar is a pure function of `CameraContext`.
 *
 * The derivations here are lifted verbatim from the original `buildKeyframes`
 * monolith; this module is the first parity-preserving step of the primitives
 * refactor.
 */
import type { YearData } from "../../schema";
import {
  peakLiftAtX,
  type DensitySample,
} from "../CameraRig";
import {
  gridGeometry,
  type BarPlacement,
  type GridGeometry,
} from "../../utils/grid";
import {
  ORBIT_H,
  ORBIT_RX_MAX,
  ORBIT_RX_MIN,
  ORBIT_RX_SCALE,
  ORBIT_FOCAL_BIAS,
} from "./constants";
import type { CameraPose, PeakTargetBars } from "./types";

/**
 * Build a piecewise-linear remap of cruise time `u in [0,1]` (uniform) to a
 * density-weighted progress along the year. The camera spends MORE frames in
 * dense stretches (slow-mo through bustling districts) and FEWER frames in
 * sparse stretches (skim across quiet weeks). The curve is normalized so the
 * year always uses its full cruise budget regardless of density distribution.
 *
 * Returns an array of `[u, t]` pairs where `u` is uniform progress through
 * cruise time and `t` is the position along the year's X span. With no
 * density variation (empty year), `t === u` (uniform cruise).
 */
export function buildSpeedRemap(curve: DensitySample[]): Array<[number, number]> {
  const N = curve.length;
  if (N < 2) {
    return [[0, 0], [1, 1]];
  }
  // Weight: dwell-time per sample = (0.4 + density). Sparse weeks get 0.4,
  // dense weeks get 1.4 → ~3.5× speed difference between extremes.
  const weights: number[] = curve.map((s) => 0.4 + s.density);
  let totalW = 0;
  for (const w of weights) totalW += w;
  // Cumulative time (u) per sample, normalized.
  const cumU: number[] = [];
  let acc = 0;
  for (let i = 0; i < N; i++) {
    cumU.push(acc / totalW);
    acc += weights[i];
  }
  cumU.push(1);
  // Map each sample to its spatial position (t in [0,1]).
  const samples: Array<[number, number]> = [];
  for (let i = 0; i < N; i++) {
    const tSpace = i / (N - 1);
    samples.push([cumU[i], tSpace]);
  }
  // Ensure endpoints are exact.
  samples[0] = [0, 0];
  samples[samples.length - 1] = [1, 1];
  return samples;
}

/** Sample the speed remap at uniform cruise progress `u`, returning spatial t. */
export function lerpSpeedRemap(remap: Array<[number, number]>, u: number): number {
  if (u <= remap[0][0]) return remap[0][1];
  if (u >= remap[remap.length - 1][0]) return remap[remap.length - 1][1];
  for (let i = 0; i < remap.length - 1; i++) {
    const [u0, t0] = remap[i];
    const [u1, t1] = remap[i + 1];
    if (u >= u0 && u <= u1) {
      const f = (u - u0) / Math.max(u1 - u0, 1e-9);
      return t0 + (t1 - t0) * f;
    }
  }
  return remap[remap.length - 1][1];
}

/** Geometry + the active-bar span derived from the year's placements. */
export interface ActivitySpan {
  /** Grid geometry for the year. */
  geom: GridGeometry;
  /** World-space distance between adjacent week columns. */
  stride: number;
  /** Total X span of the grid (week 0 → last week). */
  span: number;
  /** Whether any in-year day actually has contributions. */
  hasActive: boolean;
  /** X of the first active (in-year, count>0) column, else originX. */
  firstActiveX: number;
  /** X of the last active column, else originX + span. */
  lastActiveX: number;
  /** Midpoint between first and last active columns. */
  midActiveX: number;
  /** X where the cruise ends (clamped to last active column). */
  cruiseEndX: number;
  /** Distance the cruise travels in X. */
  cruiseSpan: number;
}

/** Parameters describing the helicopter orbit shot. */
export interface OrbitParams {
  /** Data-adaptive X radius: clamp(halfActiveSpan * SCALE, MIN, MAX). */
  rx: number;
  /** Orbit height above the skyline base. */
  h: number;
  /** Fixed focal centre the orbit looks at from every angle. */
  focal: [number, number, number];
}

/** Parameters describing the peak-focus / canyon shot. */
export interface PeakParams {
  /** X position of the peak district (peak.centerX). */
  px: number;
  /** Bar peak-lift at px. */
  peakLift: number;
  /** Camera Y for the canyon hold, clamped to a cinematic band. */
  peakY: number;
}

/**
 * Everything the SkylineYear camera grammar needs, derived once from the data.
 */
export interface CameraContext {
  year: YearData;
  placements: BarPlacement[];
  peak: PeakTargetBars;
  densityCurve: DensitySample[];
  /** True when the year has any contributions (totalContributions > 0). */
  hasContent: boolean;
  /** Density-weighted cruise time→space remap. */
  speedRemap: Array<[number, number]>;
  activity: ActivitySpan;
  orbit: OrbitParams;
  peakShot: PeakParams;
  /**
   * The shared loop-seam pose. F0 (establish) and the final outro keyframe use
   * this exact pose so the composition loops with zero visual pop.
   */
  loopPose: CameraPose;
}

/**
 * Derive the full {@link CameraContext} from a year's data. Pure; no side
 * effects. All numeric derivations mirror the original monolith exactly.
 */
export function buildCameraContext(
  year: YearData,
  placements: BarPlacement[],
  peak: PeakTargetBars,
  densityCurve: DensitySample[],
  hasContent: boolean,
): CameraContext {
  const geom = gridGeometry(year);
  const stride = geom.cellSize + geom.gap;
  const span = (geom.weekCount - 1) * stride;
  const speedRemap = buildSpeedRemap(densityCurve);

  const activeXs = placements
    .filter((p) => p.inYear && p.count > 0)
    .map((p) => p.x);
  const hasActive = activeXs.length > 0;
  const firstActiveX = hasActive ? Math.min(...activeXs) : geom.originX;
  const lastActiveX = hasActive ? Math.max(...activeXs) : geom.originX + span;
  const midActiveX = (firstActiveX + lastActiveX) / 2;
  const cruiseEndX = hasActive
    ? Math.min(geom.originX + span, lastActiveX)
    : geom.originX + span;
  const cruiseSpan = cruiseEndX - geom.originX;

  // Hero-card "home" / outro pose (v25): F0 and F1146 share this exact pose so
  // the loop seam closes with zero visual pop.
  const loopPose: CameraPose = {
    position: [midActiveX, 22, 50],
    lookAt: [midActiveX, 5, 0],
    fov: 30,
  };

  // Orbit: rx is data-adaptive (20% beyond the active half-span), clamped so
  // the orbit never gets too tight or too wide. The focal centre is fixed —
  // midActiveX biased toward the peak column, on the skyline's front face.
  const halfActiveSpan = (lastActiveX - firstActiveX) / 2;
  const orbitRX = Math.min(
    ORBIT_RX_MAX,
    Math.max(ORBIT_RX_MIN, halfActiveSpan * ORBIT_RX_SCALE),
  );
  const peakX = hasContent ? peak.centerX : midActiveX;
  const orbitFocalX = midActiveX + ORBIT_FOCAL_BIAS * (peakX - midActiveX);

  // Peak focus: canyon dive centred on the busiest district.
  const px = peak.centerX;
  const peakLift = peakLiftAtX(px, placements);
  const peakY = Math.max(2.4, Math.min(peakLift * 0.55 + 1.0, 5.5));

  return {
    year,
    placements,
    peak,
    densityCurve,
    hasContent,
    speedRemap,
    activity: {
      geom,
      stride,
      span,
      hasActive,
      firstActiveX,
      lastActiveX,
      midActiveX,
      cruiseEndX,
      cruiseSpan,
    },
    orbit: {
      rx: orbitRX,
      h: ORBIT_H,
      focal: [orbitFocalX, 3.0, 0],
    },
    peakShot: { px, peakLift, peakY },
    loopPose,
  };
}
