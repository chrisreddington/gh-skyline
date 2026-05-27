/**
 * <Skyline> renders one year's contribution grid with instanced bar layers.
 * As each bar reveals, a grey base contracts while the level-coloured layer
 * grows in its place — a true grey→green transition instead of a hard swap.
 *
 * Design notes (v4):
 *  - Layered instanced meshes: one grey base + four level-colour overlays.
 *    This keeps colour differentiation reliable in Remotion frame rendering,
 *    where per-instance colour attributes can be inconsistent across snapshots.
 *  - Zero-contribution & out-of-year days are EXCLUDED from the instance set
 *    entirely — they were the source of the v3 z-fighting flicker (boxes
 *    pinned to height 0.0001 fighting the baseplate). In-year zero days are
 *    still represented visually by a separate flat tile layer that mimics
 *    the empty squares of the GitHub graph.
 *  - The per-year baseplate has been removed; SkylineFull provides one
 *    shared continuous baseplate spanning ALL years (matches the physical
 *    3D-print STL — no per-year seams).
 *  - `reveal` is now flexible: scalar for whole-year reveals (SkylineFull)
 *    or callback for per-bar reveals along the X axis (SkylineYear).
 */
import React, { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { Text } from "@react-three/drei";
import { useCurrentFrame } from "remotion";
import type { YearData, Theme } from "../schema";
import { layoutBars, gridGeometry, type BarPlacement } from "../utils/grid";
import {
  levelMaterial,
  palette,
  revealColourProgress,
  type BucketLevel,
} from "./theme";
import { MONA_SANS_MEDIUM } from "./typography";

interface SkylineProps {
  year: YearData;
  theme: Theme;
  /** Overall opacity for the year (used during SkylineFull transitions). */
  opacity?: number;
  /** Whether to render the year label on the baseplate. */
  showLabel?: boolean;
  /**
   * Reveal control. Either:
   *  - undefined → all in-year bars fully revealed (static city)
   *  - number    → whole-year scalar reveal 0..1 (used by SkylineFull when
   *                a year "lights up" as the camera reaches its Z slab)
   *  - function  → per-bar reveal 0..1 (used by SkylineYear so bars rise
   *                chronologically along the X / week axis)
   */
  reveal?: number | ((bar: BarPlacement) => number);
  /**
   * Legacy compatibility: if `cameraX` + `buildLeadDistance` are provided,
   * reveal is computed per-bar from the camera's X position. Kept so
   * SkylineYear keeps working untouched. Ignored when `reveal` is set.
   */
  cameraX?: number;
  buildLeadDistance?: number;
  /**
   * Render the in-year zero-contribution flat tile layer? Default true.
   * Set false if the composition's baseplate already provides this look
   * (e.g. the year is empty and we don't want any tiles either).
   */
  showEmptyTiles?: boolean;
  /**
   * Render the per-year baseplate? Default false (SkylineFull provides one
   * continuous baseplate). SkylineYear sets this true so it remains
   * self-contained.
   */
  showBaseplate?: boolean;
  /**
   * 0→1 collapse wave progress (frames 150→180 in SkylineYear).
   * A right-to-left "retraction" wave that collapses bars before cruise begins.
   * 0 = all bars at full height. 1 = all bars collapsed to zero.
   */
  collapseProgress?: number;
  /**
   * 0→1 override floor for `resolveReveal`. When non-zero, every bar is treated
   * as at least `revealBoost` revealed, keeping their colored layer visible even
   * if the cruise camera hasn't reached them yet. Used during the linger window
   * (ENTRY_END → ENTRY_END+40) to prevent the colored→dark pop at cruise start.
   */
  revealBoost?: number;
  /**
   * 0→1 peak-focus progress (ramps during approach 570→660, holds during canyon).
   * Non-highlight bars shrink toward 20% of their height to spotlight the peak.
   */
  focusProgress?: number;
  /**
   * X positions of bars immune to the peak-focus shrink (the highlighted peak bars).
   */
  peakHighlightXs?: ReadonlyArray<number>;
}

const TEMP_OBJECT = new THREE.Object3D();

/**
 * Minimum bar height (in world units) below which a bar is hidden entirely
 * rather than rendered as a flat plate at y≈0. Sits above the EmptyTile top
 * surface (y≈0.06) so the transition from "empty grid cell" to "growing bar"
 * is a clean cut, never a z-fight. Eliminated the mosaic flicker on the
 * unbuilt grid where bars at sub-pixel heights were fighting the baseplate
 * top face for the depth buffer.
 */
const HIDE_THRESHOLD = 0.05;

/**
 * Spring-with-overshoot easing for bar reveals. t in [0,1] → height multiplier
 * that overshoots to ~1.08 around t=0.7 and settles to 1.0 at t=1. Cheap
 * approximation of a damped spring; no React-spring dependency.
 */
function springReveal(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const c1 = 1.05;
  const c2 = c1 + 1;
  const x = t - 1;
  return 1 + c2 * x * x * x + c1 * x * x;
}

/** Monotonic ease-out cubic. t in [0,1] → [0,1]. No overshoot. */
export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - Math.max(0, Math.min(1, t)), 3);
}

/** Monotonic ease-in-out cubic. t in [0,1] → [0,1]. No overshoot. */
export function easeInOutCubic(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2;
}

/** Resolve the right-to-left collapse multiplier for a bar at the given x. */
export function computeCollapseMultiplier(
  barX: number,
  minX: number,
  maxX: number,
  collapseProgress?: number,
  bandwidth = 9,
): number {
  if ((collapseProgress ?? 0) <= 0) {
    return 1;
  }
  const waveFront = maxX + bandwidth * 0.5 -
    (maxX - minX + bandwidth) * easeInOutCubic(collapseProgress ?? 0);
  const u = Math.max(0, Math.min(1, (barX - waveFront) / bandwidth));
  return 1 - easeOutCubic(u);
}

/** Resolve the peak-focus multiplier for a bar at the given x. */
export function computeFocusMultiplier(
  barX: number,
  focusProgress?: number,
  peakHighlightXs?: ReadonlyArray<number>,
): number {
  if ((focusProgress ?? 0) <= 0 || !peakHighlightXs || peakHighlightXs.length === 0) {
    return 1;
  }
  const isHighlight = peakHighlightXs.includes(barX);
  if (isHighlight) {
    return 1;
  }
  return 1 - easeInOutCubic(focusProgress ?? 0) * 0.8;
}

/**
 * Resolve the active set of bars to instance — strictly in-year days with
 * count > 0. Padding days and in-year zero days are returned separately so
 * the composition can render zero days as flat tiles (matching the GitHub
 * graph's "empty squares") without z-fighting against the baseplate.
 */
interface ActiveSet {
  readonly active: BarPlacement[];
  readonly emptyInYear: BarPlacement[];
}

function partitionPlacements(placements: BarPlacement[]): ActiveSet {
  const active: BarPlacement[] = [];
  const emptyInYear: BarPlacement[] = [];
  for (const p of placements) {
    if (!p.inYear) continue;
    if (p.count > 0 && p.height > 0) {
      active.push(p);
    } else {
      emptyInYear.push(p);
    }
  }
  return { active, emptyInYear };
}

/**
 * Single InstancedMesh containing all active (height > 0) bars in the year,
 * with per-instance colour set from a grey→target lerp driven by reveal.
 */
const ActiveBars: React.FC<{
  bars: BarPlacement[];
  cellSize: number;
  theme: Theme;
  opacity: number;
  resolveReveal: (bar: BarPlacement) => number;
  collapseProgress?: number;
  focusProgress?: number;
  peakHighlightXs?: ReadonlyArray<number>;
}> = ({
  bars,
  cellSize,
  theme,
  opacity,
  resolveReveal,
  collapseProgress,
  focusProgress,
  peakHighlightXs,
}) => {
  const baseRef = useRef<THREE.InstancedMesh>(null);
  const l1Ref = useRef<THREE.InstancedMesh>(null);
  const l2Ref = useRef<THREE.InstancedMesh>(null);
  const l3Ref = useRef<THREE.InstancedMesh>(null);
  const l4Ref = useRef<THREE.InstancedMesh>(null);
  const p = palette(theme);
  const frame = useCurrentFrame();
  const l1 = useMemo(() => bars.filter((b) => b.level === 1), [bars]);
  const l2 = useMemo(() => bars.filter((b) => b.level === 2), [bars]);
  const l3 = useMemo(() => bars.filter((b) => b.level === 3), [bars]);
  const l4 = useMemo(() => bars.filter((b) => b.level === 4), [bars]);
  const { minX, maxX } = useMemo(() => {
    if (bars.length === 0) {
      return { minX: 0, maxX: 0 };
    }
    return bars.reduce(
      (acc, bar) => ({
        minX: Math.min(acc.minX, bar.x),
        maxX: Math.max(acc.maxX, bar.x),
      }),
      { minX: bars[0].x, maxX: bars[0].x },
    );
  }, [bars]);

  const baseMatSpec = useMemo(
    () => ({
      color: p.levels[0],
      roughness: theme === "dark" ? 0.42 : 0.36,
      metalness: 0.03,
    }),
    [p.levels, theme],
  );

  const l1Spec = useMemo(() => levelMaterial(1, theme), [theme]);
  const l2Spec = useMemo(() => levelMaterial(2, theme), [theme]);
  const l3Spec = useMemo(() => levelMaterial(3, theme), [theme]);
  const l4Spec = useMemo(() => levelMaterial(4, theme), [theme]);

  useLayoutEffect(() => {
    const applyMatrices = (
      mesh: THREE.InstancedMesh | null,
      layerBars: readonly BarPlacement[],
      getLayerHeight: (fullHeight: number, colourT: number, revealT: number) => number,
      getLayerY: (baseHeight: number, layerHeight: number) => number,
      getColourLevel: (bar: BarPlacement) => BucketLevel,
    ) => {
      if (!mesh) return;
      layerBars.forEach((bar, i) => {
        const revealT = Math.min(1, Math.max(0, resolveReveal(bar)));
        const revealMul = springReveal(revealT);
        const collapseMul = computeCollapseMultiplier(
          bar.x,
          minX,
          maxX,
          collapseProgress,
        );
        const focusMul = computeFocusMultiplier(
          bar.x,
          focusProgress,
          peakHighlightXs,
        );
        // Raw effective height before any clamp. If the bar should be
        // invisible at this frame (collapse, pre-reveal, focus shrink), keep
        // it at 0 so the hide branch below parks it offscreen — clamping to
        // a sub-pixel positive value caused z-fighting with the baseplate
        // (y∈[-0.2,0]) and the EmptyTile layer (y=0.04), producing the
        // mosaic flicker on the unbuilt grid.
        const rawH = bar.height * revealMul * collapseMul * focusMul;
        const fullHEffective = rawH;
        const ct = revealColourProgress(revealT, getColourLevel(bar));
        const baseH = fullHEffective * (1 - ct);
        const layerH = getLayerHeight(fullHEffective, ct, revealT);
        // Hide threshold (0.05) sits comfortably above the EmptyTile top
        // surface at y=0.06 — bars only appear once they would have visible
        // mass above that surface, so the transition from "empty cell" to
        // "growing bar" is a clean cut, not a z-fight.
        if (layerH < HIDE_THRESHOLD) {
          TEMP_OBJECT.position.set(bar.x, -1000, bar.z);
          TEMP_OBJECT.scale.set(cellSize, 0.0001, cellSize);
        } else {
          TEMP_OBJECT.position.set(bar.x, getLayerY(baseH, layerH), bar.z);
          TEMP_OBJECT.scale.set(cellSize, layerH, cellSize);
        }
        TEMP_OBJECT.rotation.set(0, 0, 0);
        TEMP_OBJECT.updateMatrix();
        mesh.setMatrixAt(i, TEMP_OBJECT.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.frustumCulled = false;
    };

    // Base layer: hidden completely. With revealBoost removed, bars grow with
    // their proper colors directly from the colored layers — no "grow in dark"
    // intermediate phase is needed. Empty/no-contribution days are still
    // rendered as flat tiles by EmptyTiles separately.
    applyMatrices(
      baseRef.current,
      bars,
      () => 0,
      (_baseH, layerH) => layerH / 2,
      (bar) => bar.level,
    );

    // Colored layers: render the bar at its full effective height directly.
    // fullHEffective already incorporates revealMul × collapseMul × focusMul,
    // so bars grow gradually as the cruise camera reveals them, and shrink/lift
    // during collapse/focus moments — all with their proper level color.
    // The tiny per-level epsilon (0.0015) prevents Z-fighting between layers.
    applyMatrices(
      l1Ref.current,
      l1,
      (fullH) => fullH + 0 * 0.0015,
      (_baseH, layerH) => layerH / 2,
      () => 1,
    );
    applyMatrices(
      l2Ref.current,
      l2,
      (fullH) => fullH + 1 * 0.0015,
      (_baseH, layerH) => layerH / 2,
      () => 2,
    );
    applyMatrices(
      l3Ref.current,
      l3,
      (fullH) => fullH + 2 * 0.0015,
      (_baseH, layerH) => layerH / 2,
      () => 3,
    );
    applyMatrices(
      l4Ref.current,
      l4,
      (fullH) => fullH + 3 * 0.0015,
      (_baseH, layerH) => layerH / 2,
      () => 4,
    );
  }, [
    bars,
    cellSize,
    collapseProgress,
    focusProgress,
    frame,
    l1,
    l2,
    l3,
    l4,
    maxX,
    minX,
    peakHighlightXs,
    resolveReveal,
  ]);

  if (bars.length === 0) return null;

  return (
    <>
      <instancedMesh
        ref={baseRef}
        args={[undefined, undefined, bars.length]}
        castShadow
        receiveShadow={false}
        frustumCulled={false}
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial
          color={baseMatSpec.color}
          roughness={baseMatSpec.roughness}
          metalness={baseMatSpec.metalness}
          transparent={opacity < 1}
          opacity={opacity}
          toneMapped
        />
      </instancedMesh>

      <instancedMesh
        ref={l1Ref}
        args={[undefined, undefined, l1.length]}
        castShadow
        receiveShadow={false}
        frustumCulled={false}
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial
          color={p.levels[1]}
          emissive={l1Spec.emissive}
          emissiveIntensity={l1Spec.emissiveIntensity}
          roughness={l1Spec.roughness}
          metalness={l1Spec.metalness}
          transparent={opacity < 1}
          opacity={opacity}
          toneMapped
        />
      </instancedMesh>

      <instancedMesh
        ref={l2Ref}
        args={[undefined, undefined, l2.length]}
        castShadow
        receiveShadow={false}
        frustumCulled={false}
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial
          color={p.levels[2]}
          emissive={l2Spec.emissive}
          emissiveIntensity={l2Spec.emissiveIntensity}
          roughness={l2Spec.roughness}
          metalness={l2Spec.metalness}
          transparent={opacity < 1}
          opacity={opacity}
          toneMapped
        />
      </instancedMesh>

      <instancedMesh
        ref={l3Ref}
        args={[undefined, undefined, l3.length]}
        castShadow
        receiveShadow={false}
        frustumCulled={false}
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial
          color={p.levels[3]}
          emissive={l3Spec.emissive}
          emissiveIntensity={l3Spec.emissiveIntensity}
          roughness={l3Spec.roughness}
          metalness={l3Spec.metalness}
          transparent={opacity < 1}
          opacity={opacity}
          toneMapped
        />
      </instancedMesh>

      <instancedMesh
        ref={l4Ref}
        args={[undefined, undefined, l4.length]}
        castShadow
        receiveShadow={false}
        frustumCulled={false}
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial
          color={p.levels[4]}
          emissive={l4Spec.emissive}
          emissiveIntensity={l4Spec.emissiveIntensity}
          roughness={l4Spec.roughness}
          metalness={l4Spec.metalness}
          transparent={opacity < 1}
          opacity={opacity}
          toneMapped
        />
      </instancedMesh>
    </>
  );
};

/**
 * Flat tile decoration for in-year zero-contribution days. These sit just
 * above the baseplate at the L0 colour and read as "empty cells of the
 * GitHub graph" — they're what makes a sparse year still feel like a year
 * rather than a featureless slab. Z-fighting is avoided by lifting tiles
 * to y = 0.04 (clear of the baseplate's y in [-0.2, 0]).
 */
const EmptyTiles: React.FC<{
  bars: BarPlacement[];
  cellSize: number;
  theme: Theme;
  opacity: number;
  reveal: (bar: BarPlacement) => number;
}> = ({ bars, cellSize, theme, opacity, reveal }) => {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const p = palette(theme);
  const frame = useCurrentFrame();
  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    bars.forEach((bar, i) => {
      const t = Math.min(1, Math.max(0, reveal(bar)));
      const visible = t > 0.02;
      if (visible) {
        TEMP_OBJECT.position.set(bar.x, 0.04, bar.z);
        TEMP_OBJECT.scale.set(cellSize * 0.92, 0.04, cellSize * 0.92);
      } else {
        TEMP_OBJECT.position.set(bar.x, -1000, bar.z);
        TEMP_OBJECT.scale.set(cellSize, 0.0001, cellSize);
      }
      TEMP_OBJECT.rotation.set(0, 0, 0);
      TEMP_OBJECT.updateMatrix();
      mesh.setMatrixAt(i, TEMP_OBJECT.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
  }, [bars, cellSize, reveal, frame]);
  if (bars.length === 0) return null;
  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, bars.length]}
      castShadow={false}
      receiveShadow
      frustumCulled={false}
    >
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial
        color={p.levels[0]}
        roughness={0.95}
        metalness={0}
        transparent={opacity < 1}
        opacity={opacity * 0.9}
      />
    </instancedMesh>
  );
};

export const Skyline: React.FC<SkylineProps> = ({
  year,
  theme,
  opacity = 1,
  showLabel = true,
  reveal,
  cameraX,
  buildLeadDistance = 8,
  showEmptyTiles = true,
  showBaseplate = false,
  collapseProgress,
  revealBoost,
  focusProgress,
  peakHighlightXs,
}) => {
  const placements = useMemo(() => layoutBars(year), [year]);
  const geom = useMemo(() => gridGeometry(year), [year]);
  const stride = geom.cellSize + geom.gap;
  const baseWidth = (geom.weekCount + 1) * stride;
  const baseDepth = 8 * stride;
  const p = palette(theme);
  const { active, emptyInYear } = useMemo(
    () => partitionPlacements(placements),
    [placements],
  );

  // Resolve the reveal callback into a unified per-bar function.
  // revealBoost (0→1) clamps the result from below during the linger window
  // after ENTRY_END, so bars that the cruise camera hasn't reached yet still
  // show their colored layer (avoids the colored→dark pop at cruise start).
  const resolveReveal = useMemo<(bar: BarPlacement) => number>(() => {
    const boost = revealBoost ?? 0;
    if (typeof reveal === "function") {
      return (bar) => Math.max(reveal(bar), boost);
    }
    if (typeof reveal === "number") {
      const r = Math.max(reveal, boost);
      return () => r;
    }
    if (cameraX !== undefined) {
      const lead = buildLeadDistance;
      return (bar: BarPlacement) => {
        const ahead = bar.x - cameraX;
        // Bars at or behind camera (negative ahead) = built (1).
        // Bars within `lead` ahead = revealing.
        // Bars further ahead = unbuilt (0).
        const base = 1 - Math.min(1, Math.max(0, ahead / lead));
        return Math.max(base, boost);
      };
    }
    return () => Math.max(1, boost);
  }, [reveal, cameraX, buildLeadDistance, revealBoost]);

  return (
    <group>
      {showBaseplate && (
        <mesh position={[0, -0.1, 0]} receiveShadow>
          <boxGeometry args={[baseWidth, 0.2, baseDepth]} />
          <meshStandardMaterial
            color={theme === "dark" ? "#10161f" : "#d0d7de"}
            roughness={0.85}
            metalness={0.0}
            transparent={opacity < 1}
            opacity={opacity}
          />
        </mesh>
      )}
      {showLabel && (
        <Text
          position={[0, 0.02, baseDepth / 2 + 0.4]}
          rotation={[-Math.PI / 2, 0, 0]}
          fontSize={1.2}
          font={MONA_SANS_MEDIUM}
          color={p.captionText}
          anchorX="center"
          anchorY="middle"
          fillOpacity={opacity}
        >
          {String(year.year)}
        </Text>
      )}
      {showEmptyTiles && (
        <EmptyTiles
          bars={emptyInYear}
          cellSize={geom.cellSize}
          theme={theme}
          opacity={opacity}
          reveal={resolveReveal}
        />
      )}
      <ActiveBars
        bars={active}
        cellSize={geom.cellSize}
        theme={theme}
        opacity={opacity}
        resolveReveal={resolveReveal}
        collapseProgress={collapseProgress}
        focusProgress={focusProgress}
        peakHighlightXs={peakHighlightXs}
      />
    </group>
  );
};
