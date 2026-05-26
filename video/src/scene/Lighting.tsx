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
      {/* Lighting deliberately lean so per-level base-colour differentiation
          isn't washed out. L1-L4 hex differences only read if the directional
          contribution stays moderate. */}
      <ambientLight intensity={theme === "dark" ? 0.30 : 0.55} />
      <directionalLight
        position={[10, 14, 8]}
        intensity={theme === "dark" ? 0.55 : 0.65}
        castShadow
      />
      <directionalLight
        position={[0, 5, 18]}
        intensity={theme === "dark" ? 0.30 : 0.30}
      />
      <directionalLight
        position={[-12, 6, -10]}
        intensity={0.30}
        color={p.rim}
      />
    </>
  );
};
