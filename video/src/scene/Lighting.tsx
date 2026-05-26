/**
 * Theme-aware lighting rig. Ambient + key directional + a coloured rim light
 * sitting opposite the camera dolly so bars get a subtle accent from behind.
 */
import React from "react";
import type { Theme } from "../schema";
import { palette } from "./theme";

interface LightingProps {
  theme: Theme;
}

export const Lighting: React.FC<LightingProps> = ({ theme }) => {
  const p = palette(theme);
  return (
    <>
      <ambientLight intensity={theme === "dark" ? 0.55 : 0.7} />
      <directionalLight
        position={[10, 14, 8]}
        intensity={theme === "dark" ? 1.1 : 0.9}
        castShadow
      />
      {/* Front-fill so camera-facing bar faces aren't ambient-only during the
          fly-through. The camera spends most of its time looking from +Z, so
          this light needs to come from a similar direction. */}
      <directionalLight
        position={[0, 5, 18]}
        intensity={theme === "dark" ? 0.55 : 0.4}
      />
      <directionalLight
        position={[-12, 6, -10]}
        intensity={0.4}
        color={p.rim}
      />
    </>
  );
};
