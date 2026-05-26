/**
 * SkylineYear: single-year fly-through composition.
 *
 * Camera grammar (frames @30fps, total 900 = 30s):
 *   0   – 90   Establishing overhead → descent. Title overlay on top of the
 *              already-visible 3D city (so the first frame works as a social
 *              loop entry point).
 *   90  – 180  Entry: camera approaches week-0 from the side, Z high.
 *   180 – 540  Cruise: travel along +X with Z and FOV "breathing" with crowd
 *              density. Sparse stretches → wide pull-back; dense stretches →
 *              canyon at Z≈2 with telephoto FOV.
 *   540 – 660  Peak approach: keyframes cluster around the year's peakWeek
 *              (or peakDay fallback) so the camera naturally slows and dives.
 *   660 – 750  Canyon moment: inside the peak district. Peak bars glow via
 *              <HighlightMoment>. Caption fades in/out within this window.
 *   750 – 840  Emergence: rise out of the canyon and pull back to the apex
 *              postcard angle. Outro card fades in.
 *   840 – 900  Hold on postcard angle while outro fades through.
 *
 * Empty year (stats null / peakInYear == 0) fallback: the peak target reverts
 * to the grid centre and the canyon-moment is skipped — the cruise extends
 * smoothly across the full year.
 */
import React, { useMemo } from "react";
import * as THREE from "three";
import {
  AbsoluteFill,
  Sequence,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
  type CalculateMetadataFunction,
} from "remotion";
import { ThreeCanvas } from "@remotion/three";
import { z } from "zod";

import {
  yearSchema,
  themeSchema,
  resolutionSchema,
  type YearData,
} from "../schema";
import { palette } from "../scene/theme";
import { Skyline } from "../scene/Skyline";
import { Lighting } from "../scene/Lighting";
import { Captions } from "../scene/Captions";
import { HighlightMoment } from "../scene/HighlightMoment";
import {
  CameraRig,
  peakLiftAtX,
  crowdDensityAtX,
  type CameraKeyframe,
} from "../scene/CameraRig";
import {
  layoutBars,
  placementForDate,
  placementsForWeekStart,
  gridGeometry,
  type BarPlacement,
} from "../utils/grid";

export const skylineYearPropsSchema = z.object({
  data: yearSchema,
  username: z.string().min(1),
  theme: themeSchema.default("dark"),
  resolution: resolutionSchema.default("4k"),
});

export type SkylineYearProps = z.infer<typeof skylineYearPropsSchema>;

export const SKYLINE_YEAR_FPS = 30;
export const SKYLINE_YEAR_DURATION_FRAMES = 900;

export const calculateSkylineYearMetadata: CalculateMetadataFunction<
  SkylineYearProps
> = async ({ props }) => {
  const dims = props.resolution === "1080p"
    ? { width: 1920, height: 1080 }
    : { width: 3840, height: 2160 };
  return {
    ...dims,
    fps: SKYLINE_YEAR_FPS,
    durationInFrames: SKYLINE_YEAR_DURATION_FRAMES,
    props,
  };
};

// Phase boundaries (absolute frames).
const TITLE_END = 90;
const ENTRY_END = 180;
const CRUISE_END = 540;
const APPROACH_END = 660;
const CANYON_END = 750;
const EMERGE_END = 840;
const TOTAL = SKYLINE_YEAR_DURATION_FRAMES;

interface PeakTargetBars {
  /** Bars to glow during the canyon moment (peakWeek column if available). */
  highlight: BarPlacement[];
  /** Caption to surface during the canyon moment. */
  caption: string | null;
  /** X position to centre the canyon dive on. */
  centerX: number;
}

function pickPeakTarget(
  year: YearData,
  placements: BarPlacement[],
  fallbackCenterX: number,
): PeakTargetBars {
  const s = year.stats;
  if (!s) {
    return { highlight: [], caption: null, centerX: fallbackCenterX };
  }
  // Prefer peakWeek (whole column glows = "district" feel).
  if (s.peakWeek) {
    const bars = placementsForWeekStart(placements, s.peakWeek.startDate);
    if (bars.length > 0) {
      const center = bars[0].x;
      return {
        highlight: bars,
        caption: `Peak week · ${s.peakWeek.total.toLocaleString()} contributions`,
        centerX: center,
      };
    }
  }
  // Fall back to peakDay (single bar glow).
  if (s.peakDay) {
    const bar = placementForDate(placements, s.peakDay.date);
    if (bar) {
      return {
        highlight: [bar],
        caption: `Peak day · ${s.peakDay.count.toLocaleString()} contributions · ${s.peakDay.date}`,
        centerX: bar.x,
      };
    }
  }
  return { highlight: [], caption: null, centerX: fallbackCenterX };
}

function buildKeyframes(
  year: YearData,
  placements: BarPlacement[],
  peak: PeakTargetBars,
): CameraKeyframe[] {
  const geom = gridGeometry(year);
  const stride = geom.cellSize + geom.gap;
  const span = (geom.weekCount - 1) * stride;
  const center: [number, number, number] = [0, 1.2, 0];

  const k: CameraKeyframe[] = [];

  // -------------------- 0..90 Establishing overhead → descent --------------
  // Frame 0: high gods-eye, city visible immediately for social loops.
  k.push({ frame: 0, position: [0, 22, 6], lookAt: [0, 0, 0], fov: 50 });
  k.push({
    frame: 60,
    position: [span * -0.15, 16, 8],
    lookAt: [span * -0.05, 1, 0],
    fov: 44,
  });
  k.push({
    frame: TITLE_END,
    position: [span * -0.45, 9, 9],
    lookAt: [span * -0.35, 1.5, 0],
    fov: 38,
  });

  // -------------------- 90..180 Entry --------------------------------------
  k.push({
    frame: ENTRY_END,
    position: [geom.originX - 1.5, 4.5, 7],
    lookAt: [geom.originX + 4, 1.8, 0],
    fov: 36,
  });

  // -------------------- 180..540 Cruise with density/lift breathing ---------
  // Sample many points so cubic ease between adjacent keyframes approximates
  // uniform motion. At each sample we set Z (canyon depth) and FOV based on
  // local crowd density and Y based on peak-lift.
  const cruiseSamples = 14;
  for (let i = 0; i <= cruiseSamples; i++) {
    const t = i / cruiseSamples;
    const x = geom.originX + t * span;
    const density = crowdDensityAtX(x, placements, 2);
    const lift = peakLiftAtX(x, placements);
    // Z: 7.5 when sparse → 2.5 when dense. Closer = canyon parallax.
    const z = 7.5 - density * 5.0;
    // Y: hug the canopy. Climb with lift but stay just above peak.
    const y = Math.max(2.4, 2.6 + (lift - 2.4) * 0.55);
    // FOV: 38° wide when sparse → 26° telephoto in canyon.
    const fov = 38 - density * 12;
    // LookAt: gaze forward along travel + slight downward bias so canyon
    // walls fill the frame rather than sky.
    const lookY = density > 0.4 ? 1.0 + density * 1.2 : 0.6;
    const frame = ENTRY_END + Math.round(t * (CRUISE_END - ENTRY_END));
    k.push({
      frame,
      position: [x, y, z],
      lookAt: [x + 4, lookY, 0],
      fov,
    });
  }

  // -------------------- 540..660 Peak approach ------------------------------
  // Decelerate into the peak target by clustering 3 keyframes around its X.
  // Position swings around to come at it from the side, low Z (canyon entry).
  const px = peak.centerX;
  const peakLift = peakLiftAtX(px, placements);
  const peakY = Math.max(2.2, Math.min(peakLift * 0.55 + 1.0, 5.5));

  k.push({
    frame: CRUISE_END + 30,
    position: [px - 8, peakY + 1.5, 4.5],
    lookAt: [px, peakY * 0.6, 0],
    fov: 30,
  });
  k.push({
    frame: APPROACH_END,
    position: [px - 3, peakY + 0.4, 2.8],
    lookAt: [px, peakY * 0.55, -0.2],
    fov: 26,
  });

  // -------------------- 660..750 Canyon moment ------------------------------
  // Slow arc THROUGH the peak district. The camera passes the peak with the
  // glow active. Z dips to 1.8 (closest approach), FOV 24° (most telephoto).
  k.push({
    frame: APPROACH_END + 30,
    position: [px - 0.5, peakY + 0.2, 1.8],
    lookAt: [px + 1.0, peakY * 0.55, 0],
    fov: 24,
  });
  k.push({
    frame: APPROACH_END + 60,
    position: [px + 1.2, peakY + 0.4, 2.2],
    lookAt: [px + 2.5, peakY * 0.5, 0],
    fov: 26,
  });
  k.push({
    frame: CANYON_END,
    position: [px + 4, peakY + 2.0, 4.5],
    lookAt: [px + 2, peakY * 0.4, 0],
    fov: 30,
  });

  // -------------------- 750..840 Emergence + apex ---------------------------
  // Pull back, rise, slight Y-rotation to reveal the whole year.
  k.push({
    frame: CANYON_END + 45,
    position: [span * 0.25, 12, 14],
    lookAt: [0, 1.8, 0],
    fov: 38,
  });
  k.push({
    frame: EMERGE_END,
    position: [span * 0.08, 15, 19],
    lookAt: [0, 1.8, 0],
    fov: 40,
  });

  // -------------------- 840..900 Postcard hold ------------------------------
  k.push({
    frame: TOTAL,
    position: [span * 0.05, 16, 22],
    lookAt: [0, 2, 0],
    fov: 42,
  });

  // Ensure sorted by frame (helps sampleRig's bracket search be stable).
  k.sort((a, b) => a.frame - b.frame);
  return k;
}

export const SkylineYear: React.FC<SkylineYearProps> = ({
  data,
  username,
  theme,
  resolution: _resolution,
}) => {
  const { width, height } = useVideoConfig();
  const placements = useMemo(() => layoutBars(data), [data]);
  const peak = useMemo(
    () => pickPeakTarget(data, placements, 0),
    [data, placements],
  );
  const keyframes = useMemo(
    () => buildKeyframes(data, placements, peak),
    [data, placements, peak],
  );
  const p = palette(theme);

  // Lower-third watermark: persistent during cruise + canyon so social-loop
  // viewers always see attribution + year, regardless of which moment they
  // sample.
  const watermarkOpacity = useMemo(() => 0, []); // placeholder, computed below

  return (
    <AbsoluteFill style={{ backgroundColor: p.background }}>
      <ThreeCanvas
        width={width}
        height={height}
        gl={{
          antialias: true,
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.25,
          outputColorSpace: THREE.SRGBColorSpace,
        }}
        style={{ backgroundColor: p.background }}
      >
        {/* Exponential fog softens far-distance bars into the background and
            adds depth cue during canyon dives. ANGLE-safe (built into Three.js
            standard material). */}
        <fogExp2 attach="fog" args={[p.background, 0.018]} />
        <Lighting theme={theme} />
        <CameraRig keyframes={keyframes} />
        <Skyline year={data} theme={theme} />
        {peak.highlight.length > 0 && (
          <Sequence
            from={APPROACH_END - 10}
            durationInFrames={CANYON_END - APPROACH_END + 30}
            layout="none"
          >
            <HighlightMoment
              bars={peak.highlight}
              durationFrames={CANYON_END - APPROACH_END + 30}
              theme={theme}
            />
          </Sequence>
        )}
      </ThreeCanvas>

      {/* Title card — overlay on top of already-visible 3D city. */}
      <Captions
        theme={theme}
        visibleFromFrame={0}
        visibleToFrame={TITLE_END - 5}
        placement="center"
        fadeFrames={18}
      >
        <div style={{ fontSize: 88, fontWeight: 700 }}>{username}</div>
        <div style={{ fontSize: 60, marginTop: 16, opacity: 0.85 }}>
          {data.year} · {data.totalContributions.toLocaleString()} contributions
        </div>
      </Captions>

      {/* Persistent lower-third watermark during cruise → emerge. */}
      <LowerThirdWatermark
        username={username}
        year={data.year}
        fromFrame={TITLE_END}
        toFrame={EMERGE_END}
        theme={theme}
      />

      {/* Canyon-moment caption — folded into the fly-through, not a snap. */}
      {peak.caption && (
        <Captions
          theme={theme}
          visibleFromFrame={APPROACH_END + 5}
          visibleToFrame={CANYON_END + 20}
          placement="bottom"
          fadeFrames={14}
        >
          {peak.caption}
        </Captions>
      )}

      {/* Outro card. */}
      <Captions
        theme={theme}
        visibleFromFrame={EMERGE_END - 20}
        visibleToFrame={TOTAL}
        placement="center"
        fadeFrames={20}
      >
        <div style={{ fontSize: 80, fontWeight: 700 }}>
          {data.totalContributions.toLocaleString()} contributions
        </div>
        <div style={{ fontSize: 48, marginTop: 12, opacity: 0.85 }}>
          @{username.replace(/^@/, "")} · {data.year}
        </div>
      </Captions>
    </AbsoluteFill>
  );
};

/** Bottom-left watermark with light fade in/out at the edges. */
const LowerThirdWatermark: React.FC<{
  username: string;
  year: number;
  fromFrame: number;
  toFrame: number;
  theme: SkylineYearProps["theme"];
}> = ({ username, year, fromFrame, toFrame, theme }) => {
  const frame = useCurrentFrame();
  const p = palette(theme);
  const opacity = interpolate(
    frame,
    [fromFrame, fromFrame + 20, toFrame - 30, toFrame],
    [0, 0.65, 0.65, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  if (opacity <= 0) return null;
  return (
    <AbsoluteFill
      style={{
        justifyContent: "flex-end",
        alignItems: "flex-start",
        padding: 80,
        pointerEvents: "none",
        opacity,
      }}
    >
      <div
        style={{
          color: p.captionText,
          textShadow: `0 2px 12px ${p.captionShadow}`,
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
          fontSize: 36,
          fontWeight: 500,
          letterSpacing: 0.5,
        }}
      >
        @{username.replace(/^@/, "")} · {year}
      </div>
    </AbsoluteFill>
  );
};
