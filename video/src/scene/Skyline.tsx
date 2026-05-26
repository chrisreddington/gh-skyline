/**
 * <Skyline> renders one year as an instanced mesh of bars plus a baseplate
 * with the year label. Padding days from adjacent years stay in the mesh at
 * zero height so per-instance addressing remains weekIndex*7 + weekday.
 */
import React, { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { Text } from "@react-three/drei";
import type { YearData, Theme } from "../schema";
import { layoutBars, gridGeometry } from "../utils/grid";
import { colourForLevel, palette } from "./theme";

interface SkylineProps {
  year: YearData;
  theme: Theme;
  /** Overall opacity for the year (used during SkylineFull transitions). */
  opacity?: number;
  /** Whether to render the year label on the baseplate. */
  showLabel?: boolean;
}

const TEMP_OBJECT = new THREE.Object3D();
const TEMP_COLOR = new THREE.Color();

export const Skyline: React.FC<SkylineProps> = ({
  year,
  theme,
  opacity = 1,
  showLabel = true,
}) => {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const placements = useMemo(() => layoutBars(year), [year]);
  const geom = useMemo(() => gridGeometry(year), [year]);
  const stride = geom.cellSize + geom.gap;
  const baseWidth = (geom.weekCount + 1) * stride;
  const baseDepth = 8 * stride;
  const p = palette(theme);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    for (const placement of placements) {
      const h = Math.max(placement.height, 0.0001);
      TEMP_OBJECT.position.set(placement.x, h / 2, placement.z);
      TEMP_OBJECT.scale.set(geom.cellSize, h, geom.cellSize);
      TEMP_OBJECT.rotation.set(0, 0, 0);
      TEMP_OBJECT.updateMatrix();
      mesh.setMatrixAt(placement.instanceIndex, TEMP_OBJECT.matrix);
      const colour =
        placement.height > 0
          ? colourForLevel(placement.level, theme)
          : p.levels[0];
      TEMP_COLOR.set(colour);
      mesh.setColorAt(placement.instanceIndex, TEMP_COLOR);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [placements, geom, theme, p.levels]);

  return (
    <group>
      <mesh position={[0, -0.1, 0]} receiveShadow>
        <boxGeometry args={[baseWidth, 0.2, baseDepth]} />
        <meshStandardMaterial
          color={theme === "dark" ? "#1f2733" : "#d0d7de"}
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
      <instancedMesh
        ref={meshRef}
        args={[undefined, undefined, placements.length]}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial
          vertexColors={false}
          transparent={opacity < 1}
          opacity={opacity}
        />
      </instancedMesh>
    </group>
  );
};
