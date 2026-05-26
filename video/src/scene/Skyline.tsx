/**
 * <Skyline> renders one year as a set of instanced meshes — one per bucket
 * level (0..4) — plus a baseplate with the year label.
 *
 * Why per-level meshes? `InstancedMesh.setColorAt` writes per-instance base
 * colour but does NOT support per-instance emissive. To make peak bars glow
 * (the dominant signal that "this day mattered") we need an emissive material
 * per level. Splitting bars by level lets each level configure its own
 * `meshStandardMaterial` once and have all its instances inherit it.
 *
 * Padding days from adjacent years (and zero-count in-year days) all bucket to
 * level 0 with height 0 — they live in the level-0 mesh and render invisibly.
 */
import React, { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { Text } from "@react-three/drei";
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
}

const TEMP_OBJECT = new THREE.Object3D();
const LEVELS = [0, 1, 2, 3, 4] as const;

/** Render a single bucket level as one instanced mesh. */
const LevelMesh: React.FC<{
  level: 0 | 1 | 2 | 3 | 4;
  bars: BarPlacement[];
  cellSize: number;
  theme: Theme;
  opacity: number;
}> = ({ level, bars, cellSize, theme, opacity }) => {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const p = palette(theme);
  const mat = levelMaterial(level, theme);
  const baseColour = p.levels[level];

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    bars.forEach((placement, i) => {
      const h = Math.max(placement.height, 0.0001);
      TEMP_OBJECT.position.set(placement.x, h / 2, placement.z);
      TEMP_OBJECT.scale.set(cellSize, h, cellSize);
      TEMP_OBJECT.rotation.set(0, 0, 0);
      TEMP_OBJECT.updateMatrix();
      mesh.setMatrixAt(i, TEMP_OBJECT.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }, [bars, cellSize]);

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
        />
      ))}
    </group>
  );
};
