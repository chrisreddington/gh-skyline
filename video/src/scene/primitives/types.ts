/**
 * Shared types for the SkylineYear camera primitives.
 *
 * A "primitive" is one cinematographic shot (establish, approach+collapse,
 * cruise, panorama, peak-focus, outro). Each is a pure function of a derived
 * `CameraContext` plus a `FrameWindow`, and emits keyframes the existing
 * `sampleRig` consumes unchanged.
 */
import type { CameraKeyframe } from "../CameraRig";
import type { BarPlacement } from "../../utils/grid";
import type { FrameWindow } from "./timeline";

export type { FrameWindow } from "./timeline";

/** A camera pose at a single instant. Mirrors CameraKeyframe minus the frame. */
export interface CameraPose {
  position: [number, number, number];
  lookAt: [number, number, number];
  fov: number;
  /** When true, the boundary holds the previous pose then snaps (no interp). */
  cut?: boolean;
}

/** Per-channel velocity (units/frame) used to reason about C¹ join continuity. */
export interface PoseVelocity {
  position: [number, number, number];
  lookAt: [number, number, number];
  fov: number;
}

/**
 * The handoff state at the boundary of a primitive. `pose` is where the camera
 * is; the optional velocities describe how it is moving so `compose` can insert
 * a bridge keyframe that keeps the Catmull-Rom tangent from kinking.
 */
export interface BoundaryState {
  frame: number;
  pose: CameraPose;
  /** Implied velocity arriving at this boundary (from the interior). */
  vIn?: PoseVelocity;
  /** Implied velocity departing this boundary (into the next primitive). */
  vOut?: PoseVelocity;
}

export type PrimitiveId =
  | "establish"
  | "approachCollapse"
  | "cruise"
  | "panoramaOrbit"
  | "peakFocus"
  | "outro";

/**
 * The output of a primitive: an explicit entry/exit boundary plus the keyframes
 * strictly interior to its window. `compose` stitches these together.
 */
export interface PrimitiveResult {
  id: PrimitiveId;
  entry: BoundaryState;
  interior: CameraKeyframe[];
  exit: BoundaryState;
}

/** The signature every primitive builder implements. */
export type Primitive = (
  ctx: import("./context").CameraContext,
  window: FrameWindow,
) => PrimitiveResult;

// ── Peak-target types (moved here so context + primitives can share them) ─────

export interface PeakCaption {
  /** The large numeric metric (e.g. 497). */
  count: number;
  /** "PEAK WEEK" or "PEAK DAY" */
  label: string;
  /** Formatted date range, e.g. "Apr 20 – Apr 26" */
  dateRange: string;
}

export interface PeakTargetBars {
  /** Bars to glow during the canyon moment (peakWeek column if available). */
  highlight: BarPlacement[];
  /** Caption to surface during the canyon moment. */
  caption: PeakCaption | null;
  /** X position to centre the canyon dive on. */
  centerX: number;
}
