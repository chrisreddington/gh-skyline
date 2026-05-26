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
      <ambientLight intensity={theme === "dark" ? 0.35 : 0.6} />
      <directionalLight
        position={[10, 14, 8]}
        intensity={theme === "dark" ? 1.1 : 0.9}
        castShadow
      />
      <directionalLight
        position={[-12, 6, -10]}
        intensity={0.35}
        color={p.rim}
      />
    </>
  );
};
