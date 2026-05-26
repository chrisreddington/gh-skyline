/**
 * HTML caption overlay. Lives in an <AbsoluteFill> *outside* <ThreeCanvas>
 * so DOM text isn't fighting WebGL rasterization.
 */
import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import type { Theme } from "../schema";
import { palette } from "./theme";
import { MONA_SANS_FONT_FAMILY } from "./typography";

interface CaptionsProps {
  theme: Theme;
  /** Frame range (absolute) over which the caption should be visible. */
  visibleFromFrame: number;
  visibleToFrame: number;
  /** Frames spent fading in/out at each edge of the visible range. */
  fadeFrames?: number;
  children: React.ReactNode;
  /** Vertical placement: top, center, or bottom of the frame. */
  placement?: "top" | "center" | "bottom";
}

export const Captions: React.FC<CaptionsProps> = ({
  theme,
  visibleFromFrame,
  visibleToFrame,
  fadeFrames = 12,
  children,
  placement = "bottom",
}) => {
  const frame = useCurrentFrame();
  const p = palette(theme);
  const opacity = interpolate(
    frame,
    [
      visibleFromFrame,
      visibleFromFrame + fadeFrames,
      visibleToFrame - fadeFrames,
      visibleToFrame,
    ],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  if (opacity <= 0) return null;

  const justifyContent =
    placement === "top" ? "flex-start" : placement === "center" ? "center" : "flex-end";

  return (
    <AbsoluteFill
      style={{
        justifyContent,
        alignItems: "center",
        padding: 80,
        pointerEvents: "none",
        opacity,
      }}
    >
      <div
        style={{
          color: p.captionText,
          textShadow: `0 2px 12px ${p.captionShadow}`,
          fontFamily: `"${MONA_SANS_FONT_FAMILY}", ui-sans-serif, system-ui, sans-serif`,
          fontSize: 56,
          fontWeight: 600,
          textAlign: "center",
          lineHeight: 1.15,
        }}
      >
        {children}
      </div>
    </AbsoluteFill>
  );
};
