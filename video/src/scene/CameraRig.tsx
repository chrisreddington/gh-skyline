/**
 * Camera rig pure helpers and a small <CameraRig> component that drives a
 * <PerspectiveCamera makeDefault> from absolute composition frames.
 *
 * Frame convention: ALL frames in keyframes are absolute within the
 * composition. The component reads `useCurrentFrame()` at composition root
 * (i.e. NOT inside a <Sequence>) so timing stays predictable.
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

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

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
 *  - frame ≤ first.frame → first keyframe
 *  - frame ≥ last.frame → last keyframe
 *  - otherwise: cubic ease between bracketing keyframes
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
  const eased = easeInOutCubic(t);
  const prev = i > 0 && !a.cut ? keyframes[i - 1] : a;
  const next = i + 2 < keyframes.length && !keyframes[i + 2].cut
    ? keyframes[i + 2]
    : b;
  const posTangentIn = scale3(sub3(b.position, prev.position), 0.12);
  const posTangentOut = scale3(sub3(next.position, a.position), 0.12);
  const posC1 = add3(a.position, posTangentIn);
  const posC2 = sub3(b.position, posTangentOut);

  const lookTangentIn = scale3(sub3(b.lookAt, prev.lookAt), 0.08);
  const lookTangentOut = scale3(sub3(next.lookAt, a.lookAt), 0.08);
  const lookC1 = add3(a.lookAt, lookTangentIn);
  const lookC2 = sub3(b.lookAt, lookTangentOut);

  const fovA = a.fov ?? DEFAULT_FOV;
  const fovB = b.fov ?? DEFAULT_FOV;
  const fovPrev = prev.fov ?? fovA;
  const fovNext = next.fov ?? fovB;
  return {
    position: bezier3(a.position, posC1, posC2, b.position, eased),
    lookAt: bezier3(a.lookAt, lookC1, lookC2, b.lookAt, eased),
    fov: catmullRom1D(fovPrev, fovA, fovB, fovNext, eased),
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
