/**
 * <HighlightMoment> renders a glowing overlay over one or more bars and a
 * caption. Used for SkylineYear's peakDay / peakWeek / longestStreak beats.
 *
 * Per-instance emissive isn't supported by `meshStandardMaterial.setColorAt`,
 * so instead of recolouring the base instanced mesh we render an additional
 * small instanced mesh on top of the highlighted bars with an emissive
 * material. This stays cheap (≤7 instances) and keeps the base mesh static.
 */
import React, { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { interpolate, useCurrentFrame } from "remotion";
import type { BarPlacement } from "../utils/grid";
import type { Theme } from "../schema";
import { palette } from "./theme";

interface HighlightMomentProps {
  /** In-year bars to highlight (1 for peakDay, ≤7 for peakWeek, ≥2 for streak). */
  bars: BarPlacement[];
  /** Frames of the beat; opacity ramps in/out across this window. */
  durationFrames: number;
  theme: Theme;
}

const TEMP_OBJECT = new THREE.Object3D();
const HIGHLIGHT_SCALE = 1.06;

export const HighlightMoment: React.FC<HighlightMomentProps> = ({
  bars,
  durationFrames,
  theme,
}) => {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const frame = useCurrentFrame();
  const p = palette(theme);

  // Ease in over first 20%, hold, ease out over last 20%.
  // Peak intensity capped at 0.45 so the bars read as "lit landmarks" rather
  // than flooding the frame when the camera is inside the bar bounding box.
  const intensity = useMemo(() => {
    const inEnd = durationFrames * 0.2;
    const outStart = durationFrames * 0.8;
    if (frame <= inEnd) {
      return interpolate(frame, [0, inEnd], [0, 0.45], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });
    }
    if (frame >= outStart) {
      return interpolate(frame, [outStart, durationFrames], [0.45, 0], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });
    }
    return 0.45;
  }, [frame, durationFrames]);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    bars.forEach((bar, i) => {
      const h = Math.max(bar.height, 0.05) * HIGHLIGHT_SCALE;
      TEMP_OBJECT.position.set(bar.x, h / 2, bar.z);
      TEMP_OBJECT.scale.set(
        HIGHLIGHT_SCALE * 0.95,
        h,
        HIGHLIGHT_SCALE * 0.95,
      );
      TEMP_OBJECT.rotation.set(0, 0, 0);
      TEMP_OBJECT.updateMatrix();
      mesh.setMatrixAt(i, TEMP_OBJECT.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }, [bars]);

  if (bars.length === 0) return null;

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, bars.length]}
      castShadow={false}
    >
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial
        color={p.highlight}
        emissive={p.highlight}
        emissiveIntensity={intensity}
        roughness={0.25}
        metalness={0.05}
        transparent
        opacity={Math.min(0.85, intensity * 0.6 + 0.3)}
      />
    </instancedMesh>
  );
};
