/**
 * Camera rig pure helpers and a small <CameraRig> component that drives a
 * <PerspectiveCamera makeDefault> from absolute composition frames.
 *
 * Frame convention: ALL frames in keyframes are absolute within the
 * composition. The component reads `useCurrentFrame()` at composition root
 * (i.e. NOT inside a <Sequence>) so timing stays predictable.
 *
 * Interpolation model: time-normalised Catmull-Rom spline with no per-segment
 * easing. Applying easeInOutCubic per segment forces the camera to decelerate
 * to zero then re-accelerate at every keyframe — the "next movement" stop-start
 * pattern. Instead, tangents are derived from neighbour positions normalised by
 * their frame-time intervals, guaranteeing C¹ velocity continuity across all
 * keyframe boundaries. The camera follows one long flowing curve, not a chain
 * of micro-movements.
 */
import React, { useMemo } from "react";
import * as THREE from "three";
import { PerspectiveCamera } from "@react-three/drei";
import { useCurrentFrame } from "remotion";
import type { BarPlacement } from "../utils/grid";

export interface CameraKeyframe {
  /** Absolute composition frame. */
  frame: number;
  position: [number, number, number];
  lookAt: [number, number, number];
  fov?: number;
  /** If true, snap to this keyframe instead of interpolating from the previous one. */
  cut?: boolean;
}

export interface RigSample {
  position: [number, number, number];
  lookAt: [number, number, number];
  fov: number;
}

const DEFAULT_FOV = 35;

/**
 * Time-normalised tangent velocity at the midpoint p1 of a three-point chain
 * p0 → p1 → p2 with frame-durations dt01 and dt12.
 *
 * Returns the weighted-average velocity (units/frame) at p1, scaled by
 * `tension`. Multiply by (segment_frames / 3) to obtain the Bezier control
 * point offset. This is the non-uniform Catmull-Rom formulation — it correctly
 * handles keyframes with unequal time spacing, unlike the naive spatial-delta
 * approach that ignores frame intervals.
 */
function timeNorm3(
  p0: [number, number, number],
  p1: [number, number, number],
  p2: [number, number, number],
  dt01: number,
  dt12: number,
  tension: number,
): [number, number, number] {
  const total = dt01 + dt12;
  // Incoming velocity (p0→p1) and outgoing velocity (p1→p2), both in units/frame.
  // Time-weighted average = velocity at p1 that achieves C¹ continuity.
  return [
    ((p1[0] - p0[0]) / dt01 * dt12 + (p2[0] - p1[0]) / dt12 * dt01) / total * tension,
    ((p1[1] - p0[1]) / dt01 * dt12 + (p2[1] - p1[1]) / dt12 * dt01) / total * tension,
    ((p1[2] - p0[2]) / dt01 * dt12 + (p2[2] - p1[2]) / dt12 * dt01) / total * tension,
  ];
}

/** Scalar version of timeNorm3 for FOV interpolation. */
function timeNorm1(
  f0: number,
  f1: number,
  f2: number,
  dt01: number,
  dt12: number,
  tension: number,
): number {
  const total = dt01 + dt12;
  return ((f1 - f0) / dt01 * dt12 + (f2 - f1) / dt12 * dt01) / total * tension;
}

/** Tension for position tangents — 0.85 gives natural momentum without overshoot. */
const POS_TENSION = 0.85;
/** Tension for lookAt tangents — slightly looser so gaze pivots feel intentional. */
const LOOK_TENSION = 0.60;

function add3(
  a: [number, number, number],
  b: [number, number, number],
): [number, number, number] {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function sub3(
  a: [number, number, number],
  b: [number, number, number],
): [number, number, number] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function scale3(
  a: [number, number, number],
  s: number,
): [number, number, number] {
  return [a[0] * s, a[1] * s, a[2] * s];
}

function bezier3(
  p0: [number, number, number],
  p1: [number, number, number],
  p2: [number, number, number],
  p3: [number, number, number],
  t: number,
): [number, number, number] {
  const u = 1 - t;
  const a = scale3(p0, u * u * u);
  const b = scale3(p1, 3 * u * u * t);
  const c = scale3(p2, 3 * u * t * t);
  const d = scale3(p3, t * t * t);
  return add3(add3(a, b), add3(c, d));
}

function catmullRom1D(
  p0: number,
  p1: number,
  p2: number,
  p3: number,
  t: number,
): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 *
    ((2 * p1) +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

/**
 * Sample camera state at `frame` given a sorted keyframe list. Behaviour:
 *  - frame ≤ first.frame → first keyframe (clamped)
 *  - frame ≥ last.frame → last keyframe (clamped)
 *  - `cut: true` on keyframe B → hold A's values until B, then snap
 *  - otherwise: time-normalised cubic Bezier with C¹-continuous tangents
 *
 * No per-segment easing is applied. Easing would force the camera to
 * decelerate to zero then re-accelerate at every keyframe, producing the
 * "next movement" stop-start pattern. Time-normalised Catmull-Rom tangents
 * guarantee smooth velocity through every internal keyframe instead.
 */
export function sampleRig(frame: number, keyframes: CameraKeyframe[]): RigSample {
  if (keyframes.length === 0) {
    return { position: [0, 6, 12], lookAt: [0, 0, 0], fov: DEFAULT_FOV };
  }
  if (keyframes.length === 1 || frame <= keyframes[0].frame) {
    const k = keyframes[0];
    return { position: k.position, lookAt: k.lookAt, fov: k.fov ?? DEFAULT_FOV };
  }
  const last = keyframes[keyframes.length - 1];
  if (frame >= last.frame) {
    return { position: last.position, lookAt: last.lookAt, fov: last.fov ?? DEFAULT_FOV };
  }
  let i = 0;
  while (i < keyframes.length - 1 && keyframes[i + 1].frame <= frame) i++;
  const a = keyframes[i];
  const b = keyframes[i + 1];
  if (b.cut) {
    return {
      position: a.position,
      lookAt: a.lookAt,
      fov: a.fov ?? DEFAULT_FOV,
    };
  }
  const t = (frame - a.frame) / Math.max(1, b.frame - a.frame);
  const dt = Math.max(1, b.frame - a.frame);

  // Neighbour keyframes for tangent computation. Null when at sequence
  // boundaries or blocked by a cut (which resets velocity to zero).
  const prevKf = i > 0 && !a.cut ? keyframes[i - 1] : null;
  const nextKf = i + 2 < keyframes.length && !keyframes[i + 2].cut
    ? keyframes[i + 2]
    : null;

  // Tangent at 'a': zero at the sequence start (or after a cut) so the camera
  // begins at rest and eases in naturally from the Bezier shape.
  let posC1: [number, number, number];
  let lookC1: [number, number, number];
  if (prevKf === null) {
    posC1 = a.position;
    lookC1 = a.lookAt;
  } else {
    const dtIn = Math.max(1, a.frame - prevKf.frame);
    const posVelA = timeNorm3(prevKf.position, a.position, b.position, dtIn, dt, POS_TENSION);
    const lookVelA = timeNorm3(prevKf.lookAt, a.lookAt, b.lookAt, dtIn, dt, LOOK_TENSION);
    posC1 = add3(a.position, scale3(posVelA, dt / 3));
    lookC1 = add3(a.lookAt, scale3(lookVelA, dt / 3));
  }

  // Tangent at 'b': zero at the sequence end so the camera arrives at rest.
  let posC2: [number, number, number];
  let lookC2: [number, number, number];
  if (nextKf === null) {
    posC2 = b.position;
    lookC2 = b.lookAt;
  } else {
    const dtOut = Math.max(1, nextKf.frame - b.frame);
    const posVelB = timeNorm3(a.position, b.position, nextKf.position, dt, dtOut, POS_TENSION);
    const lookVelB = timeNorm3(a.lookAt, b.lookAt, nextKf.lookAt, dt, dtOut, LOOK_TENSION);
    posC2 = sub3(b.position, scale3(posVelB, dt / 3));
    lookC2 = sub3(b.lookAt, scale3(lookVelB, dt / 3));
  }

  const fovA = a.fov ?? DEFAULT_FOV;
  const fovB = b.fov ?? DEFAULT_FOV;
  // FOV cubic Bezier — same C¹ tangent logic as position so FOV transitions
  // flow without kinks at keyframe boundaries.
  let fovC1: number, fovC2: number;
  if (prevKf === null) {
    fovC1 = fovA;
  } else {
    const dtIn = Math.max(1, a.frame - prevKf.frame);
    const fovVelA = timeNorm1(prevKf.fov ?? DEFAULT_FOV, fovA, fovB, dtIn, dt, POS_TENSION);
    fovC1 = fovA + fovVelA * dt / 3;
  }
  if (nextKf === null) {
    fovC2 = fovB;
  } else {
    const dtOut = Math.max(1, nextKf.frame - b.frame);
    const fovVelB = timeNorm1(fovA, fovB, nextKf.fov ?? DEFAULT_FOV, dt, dtOut, POS_TENSION);
    fovC2 = fovB - fovVelB * dt / 3;
  }
  const u = 1 - t;
  const fov = u * u * u * fovA + 3 * u * u * t * fovC1 + 3 * u * t * t * fovC2 + t * t * t * fovB;
  return {
    position: bezier3(a.position, posC1, posC2, b.position, t),
    lookAt: bezier3(a.lookAt, lookC1, lookC2, b.lookAt, t),
    fov,
  };
}

/**
 * Compute a Y-lift over bars near `x`, smoothed over a small window. Used to
 * raise the camera over peak weeks during the fly-through so it doesn't
 * crash into them.
 */
export function peakLiftAtX(
  x: number,
  placements: BarPlacement[],
  windowSize = 5,
  clearance = 1.8,
  maxLift = 6,
): number {
  const weightedHeights: number[] = [];
  for (const p of placements) {
    if (!p.inYear) continue;
    const dx = Math.abs(p.x - x);
    if (dx > windowSize) continue;
    const w = 1 - dx / Math.max(windowSize, 1e-6);
    weightedHeights.push(p.height * w);
  }
  if (weightedHeights.length === 0) return 0;
  weightedHeights.sort((a, b) => b - a);
  const top = weightedHeights.slice(0, Math.min(3, weightedHeights.length));
  const mean = top.reduce((sum, h) => sum + h, 0) / top.length;
  return Math.min(maxLift, mean + clearance);
}

/**
 * Fraction of bars within `windowSize` of `x` that have meaningful height.
 * Returns 0 for sparse stretches (empty weeks, weekend valleys) and ~1 for
 * dense weeks. The composition uses this to dive Z (canyon) when crowded and
 * pull back when sparse, producing the city/canyon camera grammar.
 */
export function crowdDensityAtX(
  x: number,
  placements: BarPlacement[],
  windowSize = 2,
): number {
  let inWindow = 0;
  let active = 0;
  for (const p of placements) {
    if (!p.inYear) continue;
    if (Math.abs(p.x - x) <= windowSize) {
      inWindow++;
      if (p.height > 0.15) active++;
    }
  }
  if (inWindow === 0) return 0;
  return active / inWindow;
}

/**
 * Year-relative density curve: for each X sample along the year, return a
 * normalized [0,1] density value where 0 = the year's quietest stretch and
 * 1 = the year's busiest stretch. This is the adaptive workhorse that lets
 * the camera/speed grammar feel right for any developer:
 *
 *  - Always-active contributor: small absolute variation gets stretched so
 *    the camera still swells/ebbs between their relatively-busy and
 *    relatively-quiet weeks.
 *  - Bursty contributor: peaks land hard against flat stretches.
 *  - Quiet contributor: even tiny bursts get visual emphasis.
 *  - Empty year: returns all zeros (composition uses this to skip canyon).
 */
export interface DensitySample {
  readonly x: number;
  readonly density: number;
}

export function buildRelativeDensityCurve(
  placements: BarPlacement[],
  sampleCount = 64,
  windowSize = 2.5,
): DensitySample[] {
  const inYear = placements.filter((p) => p.inYear);
  if (inYear.length === 0) {
    return [];
  }
  let minX = inYear[0].x;
  let maxX = inYear[0].x;
  for (const p of inYear) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
  }
  const span = Math.max(maxX - minX, 1);
  // Compute mean height in window per sample.
  const raw: DensitySample[] = [];
  for (let i = 0; i < sampleCount; i++) {
    const x = minX + (i / (sampleCount - 1)) * span;
    let sum = 0;
    let n = 0;
    for (const p of inYear) {
      if (Math.abs(p.x - x) <= windowSize) {
        sum += p.height;
        n++;
      }
    }
    raw.push({ x, density: n > 0 ? sum / n : 0 });
  }
  // Normalize against this curve's own min/max so the year always has
  // visual range. If the whole year is flat (e.g. empty), every sample is
  // 0 and the composition treats it as "quiet year" and skips canyon.
  let lo = Infinity;
  let hi = -Infinity;
  for (const s of raw) {
    if (s.density < lo) lo = s.density;
    if (s.density > hi) hi = s.density;
  }
  if (hi <= lo + 1e-6) {
    return raw.map((s) => ({ x: s.x, density: 0 }));
  }
  return raw.map((s) => ({ x: s.x, density: (s.density - lo) / (hi - lo) }));
}

/** Linear-interpolate a DensitySample curve at arbitrary x. */
export function densityAt(curve: DensitySample[], x: number): number {
  if (curve.length === 0) return 0;
  const first = curve[0];
  const last = curve[curve.length - 1];
  if (x <= first.x) return first.density;
  if (x >= last.x) return last.density;
  // Binary search would be faster but N=64 keeps this trivially cheap.
  for (let i = 0; i < curve.length - 1; i++) {
    const a = curve[i];
    const b = curve[i + 1];
    if (x >= a.x && x <= b.x) {
      const t = (x - a.x) / Math.max(b.x - a.x, 1e-9);
      return a.density + (b.density - a.density) * t;
    }
  }
  return last.density;
}

interface CameraRigProps {
  keyframes: CameraKeyframe[];
}

export const CameraRig: React.FC<CameraRigProps> = ({ keyframes }) => {
  const frame = useCurrentFrame();
  const sample = useMemo(() => sampleRig(frame, keyframes), [frame, keyframes]);
  const lookAt = useMemo(
    () => new THREE.Vector3(sample.lookAt[0], sample.lookAt[1], sample.lookAt[2]),
    [sample.lookAt],
  );
  return (
    <PerspectiveCamera
      makeDefault
      position={sample.position}
      fov={sample.fov}
      near={0.1}
      far={200}
      onUpdate={(cam) => cam.lookAt(lookAt)}
    />
  );
};
