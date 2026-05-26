/**
 * <Skyline> renders one year as a set of instanced meshes — one per bucket
 * level (0..4) — plus a baseplate with the year label.
 *
 * Per-level meshes exist because Three.js InstancedMesh cannot set per-instance
 * emissive. Splitting by level lets each level configure its emissive once.
 *
 * The bars optionally "build" chronologically: as the camera's X coordinate
 * passes through a bar's column, that bar rises from zero to its full height
 * with spring-eased overshoot. This is the storytelling unlock — the year is
 * literally being constructed in front of the viewer as time advances.
 *
 * If `buildProgressAtX` is undefined (e.g. the year-label render or any caller
 * that doesn't want the build animation), all bars are drawn at full height.
 */
import React, { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { Text } from "@react-three/drei";
import { useCurrentFrame } from "remotion";
import type { YearData, Theme } from "../schema";
import { layoutBars, gridGeometry, type BarPlacement } from "../utils/grid";
import { palette, levelMaterial } from "./theme";

interface SkylineProps {
  year: YearData;
  theme: Theme;
  /** Overall opacity for the year (used during SkylineFull transitions). */
  opacity?: number;
  /** Whether to render the year label on the baseplate. */
  showLabel?: boolean;
  /**
   * If provided, a function returning a per-frame world-X position. Bars at
   * x ≤ buildLeadX get full height; bars further ahead rise progressively
   * with `buildLeadDistance` controlling how far ahead the wave extends.
   * If undefined, bars are drawn at full height (static city).
   */
  cameraX?: number;
  /** Distance ahead of cameraX over which bars finish rising. Default 8. */
  buildLeadDistance?: number;
}

const TEMP_OBJECT = new THREE.Object3D();
const LEVELS = [0, 1, 2, 3, 4] as const;

/**
 * Spring-with-overshoot easing for bar reveals. t in [0,1] → height multiplier
 * that overshoots to ~1.08 around t=0.7 and settles to 1.0 at t=1. Cheap
 * approximation of a damped spring; no React-spring dependency.
 */
function springReveal(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  // Easing curve: out-back ish. Peak at ~0.72, then settle.
  const c1 = 1.6;
  const c2 = c1 + 1;
  const x = t - 1;
  return 1 + c2 * x * x * x + c1 * x * x;
}

/** Render a single bucket level as one instanced mesh, height-driven by reveal. */
const LevelMesh: React.FC<{
  level: 0 | 1 | 2 | 3 | 4;
  bars: BarPlacement[];
  cellSize: number;
  theme: Theme;
  opacity: number;
  cameraX: number | undefined;
  buildLeadDistance: number;
}> = ({ level, bars, cellSize, theme, opacity, cameraX, buildLeadDistance }) => {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const p = palette(theme);
  const mat = levelMaterial(level, theme);
  const baseColour = p.levels[level];
  const frame = useCurrentFrame();

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    bars.forEach((placement, i) => {
      let revealT: number;
      if (cameraX === undefined) {
        revealT = 1;
      } else {
        // Bars at or behind the camera are fully built. Bars within
        // buildLeadDistance ahead are rising. Bars further ahead are at 0.
        // Negative arg = behind camera (already built).
        const ahead = placement.x - cameraX;
        revealT = 1 - Math.min(1, Math.max(0, ahead / buildLeadDistance));
      }
      const fullH = Math.max(placement.height, 0.0001);
      const revealMul = springReveal(revealT);
      const h = Math.max(fullH * revealMul, 0.0001);
      TEMP_OBJECT.position.set(placement.x, h / 2, placement.z);
      TEMP_OBJECT.scale.set(cellSize, h, cellSize);
      TEMP_OBJECT.rotation.set(0, 0, 0);
      TEMP_OBJECT.updateMatrix();
      mesh.setMatrixAt(i, TEMP_OBJECT.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    // Re-run on every frame change so the reveal animates. The dependency on
    // `frame` is the actual driver; the others are dependencies for sanity.
  }, [bars, cellSize, cameraX, buildLeadDistance, frame]);

  if (bars.length === 0) return null;

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, bars.length]}
      castShadow={level > 0}
      receiveShadow={level === 0}
    >
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial
        color={baseColour}
        emissive={mat.emissive}
        emissiveIntensity={mat.emissiveIntensity}
        roughness={mat.roughness}
        metalness={mat.metalness}
        transparent={opacity < 1}
        opacity={opacity}
        toneMapped={true}
      />
    </instancedMesh>
  );
};

export const Skyline: React.FC<SkylineProps> = ({
  year,
  theme,
  opacity = 1,
  showLabel = true,
  cameraX,
  buildLeadDistance = 8,
}) => {
  const placements = useMemo(() => layoutBars(year), [year]);
  const geom = useMemo(() => gridGeometry(year), [year]);
  const stride = geom.cellSize + geom.gap;
  const baseWidth = (geom.weekCount + 1) * stride;
  const baseDepth = 8 * stride;
  const p = palette(theme);

  // Group placements by bucket level once per year change.
  const byLevel = useMemo(() => {
    const buckets: BarPlacement[][] = [[], [], [], [], []];
    for (const placement of placements) {
      buckets[placement.level].push(placement);
    }
    return buckets;
  }, [placements]);

  return (
    <group>
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
      {showLabel && (
        <Text
          position={[0, 0.02, baseDepth / 2 + 0.4]}
          rotation={[-Math.PI / 2, 0, 0]}
          fontSize={1.2}
          color={p.captionText}
          anchorX="center"
          anchorY="middle"
          fillOpacity={opacity}
        >
          {String(year.year)}
        </Text>
      )}
      {LEVELS.map((level) => (
        <LevelMesh
          key={`level-${level}`}
          level={level}
          bars={byLevel[level]}
          cellSize={geom.cellSize}
          theme={theme}
          opacity={opacity}
          cameraX={cameraX}
          buildLeadDistance={buildLeadDistance}
        />
      ))}
    </group>
  );
};
