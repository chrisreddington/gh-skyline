/**
 * Theme-aware lighting rig. Ambient + key directional + a coloured rim light
 * sitting opposite the camera dolly so bars get a subtle accent from behind.
 */
import React from "react";
import type { Theme } from "../schema";
import { palette } from "./theme";

interface LightingProps {
  theme: Theme;
  ambientIntensity?: number;
  rimIntensity?: number;
}

export const Lighting: React.FC<LightingProps> = ({
  theme,
  ambientIntensity,
  rimIntensity = 0.24,
}) => {
  const p = palette(theme);
  const ambient = ambientIntensity ?? (theme === "dark" ? 0.30 : 0.55);
  return (
    <>
      {/* Lighting deliberately lean so per-level base-colour differentiation
          isn't washed out. L1-L4 hex differences only read if the directional
          contribution stays moderate. */}
      <ambientLight intensity={ambient} />
      <directionalLight
        position={[-8, 16, 10]}
        intensity={theme === "dark" ? 0.58 : 0.68}
        color="#fff4e0"
        castShadow
      />
      <directionalLight
        position={[0, 5, 18]}
        intensity={theme === "dark" ? 0.30 : 0.30}
      />
      <directionalLight
        position={[8, 6, -10]}
        intensity={rimIntensity}
        color={theme === "dark" ? "#a8c8ff" : p.rim}
      />
    </>
  );
};
