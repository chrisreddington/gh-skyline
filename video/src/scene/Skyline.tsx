/**
 * <Skyline> renders one year's contribution grid as a single InstancedMesh
 * with per-instance colour. As each bar "reveals" (grows from 0 to full
 * height) its colour transitions smoothly from the L0 "no contributions"
 * grey to its final bucket colour — bars don't snap into their level, they
 * grade upward as they grow. This is the "colour swells with the city"
 * effect requested in v4.
 *
 * Design notes (v4):
 *  - Single InstancedMesh per year. Per-instance colour via setColorAt.
 *    Uniform moderate emissive so taller bars still read as luminous under
 *    the directional rig, without per-instance shader plumbing.
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
import { palette, levelMaterial } from "./theme";
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
}

const TEMP_OBJECT = new THREE.Object3D();
const TEMP_COLOR_A = new THREE.Color();
const TEMP_COLOR_B = new THREE.Color();
const TEMP_COLOR_OUT = new THREE.Color();

/**
 * Spring-with-overshoot easing for bar reveals. t in [0,1] → height multiplier
 * that overshoots to ~1.08 around t=0.7 and settles to 1.0 at t=1. Cheap
 * approximation of a damped spring; no React-spring dependency.
 */
function springReveal(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const c1 = 1.6;
  const c2 = c1 + 1;
  const x = t - 1;
  return 1 + c2 * x * x * x + c1 * x * x;
}

/**
 * Smooth perceptual colour-grow: as a bar grows from 0 to full reveal, its
 * colour interpolates from the L0 grey to its target level colour. The
 * easing front-loads colour so even short bars get a hint of green by
 * mid-reveal (otherwise sparse years look like dead grey blocks).
 */
function colourGrowT(revealT: number): number {
  if (revealT <= 0) return 0;
  if (revealT >= 1) return 1;
  // Smoothstep biased toward the colour appearing earlier than the height.
  const t = revealT;
  return t * t * (3 - 2 * t);
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
}> = ({ bars, cellSize, theme, opacity, resolveReveal }) => {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const p = palette(theme);
  const frame = useCurrentFrame();

  // Per-level baseline emissive material settings — we average across L1..L4
  // so the single shared material lifts every bar a touch without crushing
  // the L1 lows or blowing out L4 highs. Co-tuned with B5 (ambient 0.18..0.30):
  // total emissive midpoint is in the L2-L3 range to keep the family green.
  const matSpec = useMemo(() => {
    // Take L3 as the "average" emissive reference; intensity at ~0.55 (between
    // L1=0.45 and L4=1.80 per v4 co-tune).
    return levelMaterial(3, theme);
  }, [theme]);

  // Cache colour objects for L0 → L_n lerp.
  const palette5 = useMemo(() => {
    return p.levels.map((hex) => new THREE.Color(hex));
  }, [p.levels]);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const grey = palette5[0];
    bars.forEach((bar, i) => {
      const revealT = Math.min(1, Math.max(0, resolveReveal(bar)));
      const revealMul = springReveal(revealT);
      const fullH = bar.height;
      const h = fullH * revealMul;
      if (h < 1e-4) {
        // Hide the instance well below the baseplate. Keeps the instance
        // slot stable while preventing any visible flicker (the v3 trick of
        // h=0.0001 was the actual culprit — boxes at the same Y as the
        // baseplate fight for the same pixels).
        TEMP_OBJECT.position.set(bar.x, -1000, bar.z);
        TEMP_OBJECT.scale.set(cellSize, 0.0001, cellSize);
      } else {
        TEMP_OBJECT.position.set(bar.x, h / 2, bar.z);
        TEMP_OBJECT.scale.set(cellSize, h, cellSize);
      }
      TEMP_OBJECT.rotation.set(0, 0, 0);
      TEMP_OBJECT.updateMatrix();
      mesh.setMatrixAt(i, TEMP_OBJECT.matrix);

      // Per-instance colour: lerp grey → target level colour. The target is
      // the bar's bucketed level; reveal drives the lerp progress.
      const target = palette5[bar.level];
      const ct = colourGrowT(revealT);
      TEMP_COLOR_A.copy(grey);
      TEMP_COLOR_B.copy(target);
      TEMP_COLOR_OUT.copy(TEMP_COLOR_A).lerp(TEMP_COLOR_B, ct);
      mesh.setColorAt(i, TEMP_COLOR_OUT);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    // Bounding sphere does not auto-update from matrix changes; disable
    // frustum culling so the year never silently disappears when its
    // hidden instances pull the bounding sphere to Y=-1000.
    mesh.frustumCulled = false;
  }, [bars, cellSize, resolveReveal, frame, palette5]);

  if (bars.length === 0) return null;

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, bars.length]}
      castShadow
      receiveShadow={false}
      frustumCulled={false}
    >
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial
        vertexColors
        emissive={matSpec.emissive}
        emissiveIntensity={matSpec.emissiveIntensity * 0.6}
        roughness={matSpec.roughness}
        metalness={matSpec.metalness}
        transparent={opacity < 1}
        opacity={opacity}
        toneMapped
      />
    </instancedMesh>
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
  const resolveReveal = useMemo<(bar: BarPlacement) => number>(() => {
    if (typeof reveal === "function") return reveal;
    if (typeof reveal === "number") {
      const r = reveal;
      return () => r;
    }
    if (cameraX !== undefined) {
      const lead = buildLeadDistance;
      return (bar: BarPlacement) => {
        const ahead = bar.x - cameraX;
        // Bars at or behind camera (negative ahead) = built (1).
        // Bars within `lead` ahead = revealing.
        // Bars further ahead = unbuilt (0).
        return 1 - Math.min(1, Math.max(0, ahead / lead));
      };
    }
    return () => 1;
  }, [reveal, cameraX, buildLeadDistance]);

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
      />
    </group>
  );
};
