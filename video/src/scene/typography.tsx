/**
 * Shared Mona Sans font setup for DOM overlays and drei Text meshes.
 */
import React from "react";
import { staticFile } from "remotion";

export const MONA_SANS_FONT_FAMILY = "Mona Sans";
export const MONA_SANS_REGULAR = staticFile("fonts/monasans-regular.ttf");
export const MONA_SANS_MEDIUM = staticFile("fonts/monasans-medium.ttf");

/** Injects @font-face declarations for Remotion DOM captions. */
export const MonaSansFontFaces: React.FC = () => (
  <style>
    {`
@font-face {
  font-family: '${MONA_SANS_FONT_FAMILY}';
  src: url('${MONA_SANS_REGULAR}') format('truetype');
  font-weight: 400;
  font-style: normal;
  font-display: block;
}
@font-face {
  font-family: '${MONA_SANS_FONT_FAMILY}';
  src: url('${MONA_SANS_MEDIUM}') format('truetype');
  font-weight: 500 800;
  font-style: normal;
  font-display: block;
}
`}
  </style>
);
