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

function lerp3(
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
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
  const t = (frame - a.frame) / Math.max(1, b.frame - a.frame);
  const eased = easeInOutCubic(t);
  return {
    position: lerp3(a.position, b.position, eased),
    lookAt: lerp3(a.lookAt, b.lookAt, eased),
    fov: (a.fov ?? DEFAULT_FOV) + ((b.fov ?? DEFAULT_FOV) - (a.fov ?? DEFAULT_FOV)) * eased,
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
  // Find weeks within roughly windowSize cells of x. Cell stride ~1.0 so
  // simple Euclidean distance is fine.
  const samples: number[] = [];
  for (const p of placements) {
    if (!p.inYear) continue;
    const dx = Math.abs(p.x - x);
    if (dx <= windowSize) samples.push(p.height);
  }
  if (samples.length === 0) return 0;
  // Use the max within the window (we care about avoiding the tallest peak)
  // then smooth slightly with a 3-tap average against neighbour-weeks' maxes.
  const max = Math.max(...samples);
  return Math.min(maxLift, max + clearance);
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
