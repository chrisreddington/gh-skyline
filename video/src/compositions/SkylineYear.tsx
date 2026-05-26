/**
 * SkylineYear: single-year fly-through composition.
 *
 * Storytelling beats (frames @30fps, total 900 = 30s):
 *   0   – 75   Opening shot: angled top-down on a half-built city. The bars
 *              for the year are rising chronologically as the camera enters,
 *              so the year is literally being constructed in front of the
 *              viewer. Title overlays the live build.
 *   75  – 180  Descent + entry: camera drops to canopy level and approaches
 *              week-0 from the side.
 *   180 – 600  Cruise: travel along +X with Z/FOV/speed "breathing" with the
 *              year's RELATIVE density curve (normalized to this year's own
 *              min/max so every developer gets visible swell-and-ebb).
 *              The bar-build wave moves with the camera, so each district
 *              materialises just before we arrive.
 *   600 – 660  Peak approach: deceleration into the year's peak week / day.
 *   660 – 720  Canyon hold: near-stationary inside the peak district. Peak
 *              bars glow via <HighlightMoment>.
 *   720 – 810  Emergence + reveal: pull back to the wide postcard angle.
 *   810 – 900  Chart-out: camera slides into a side-profile pose so the year
 *              reads as a 1-D histogram silhouette. Outro card with totals.
 *
 * Adaptive fallbacks:
 *   - Empty year (totalContributions == 0 or stats == null): canyon + highlight
 *     are skipped; cruise extends and the side-profile chart-out still plays.
 *   - Tiny year (peak count == 1): canyon plays normally but copy stays
 *     observational ("Peak day · 1 contribution · 2014-02-19").
 *   - Flat year (uniform daily counts): density curve still self-stretches
 *     so the camera swells/ebbs between the relatively-busy and -quiet
 *     stretches.
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
  sampleRig,
  peakLiftAtX,
  buildRelativeDensityCurve,
  densityAt,
  type CameraKeyframe,
  type DensitySample,
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
const TITLE_END = 75;
const ENTRY_END = 180;
const CRUISE_END = 600;
const APPROACH_END = 660;
const CANYON_END = 720;
const EMERGE_END = 810;
const TOTAL = SKYLINE_YEAR_DURATION_FRAMES;

// Z floor — camera never goes closer than this in Z so it doesn't clip into
// bars (bars span Z ±3.45 with originZ=-3 and cellSize=0.9 → far edge ≈ 3.5).
const Z_FLOOR = 4.2;

// Bar build-in: how far ahead of the camera the wave extends, in world units.
const BUILD_LEAD = 9;

interface PeakTargetBars {
  /** Bars to glow during the canyon moment (peakWeek column if available). */
  highlight: BarPlacement[];
  /** Caption to surface during the canyon moment. */
  caption: string | null;
  /** X position to centre the canyon dive on. */
  centerX: number;
}

/**
 * Pick the canyon target. Order of preference: peakWeek → peakDay → none.
 * Captions stay observational regardless of magnitude (no "got architectural"
 * for small numbers, no "skyline woke up" for empty years).
 */
function pickPeakTarget(
  year: YearData,
  placements: BarPlacement[],
  fallbackCenterX: number,
): PeakTargetBars {
  const s = year.stats;
  if (!s || year.totalContributions === 0) {
    return { highlight: [], caption: null, centerX: fallbackCenterX };
  }
  if (s.peakWeek) {
    const bars = placementsForWeekStart(placements, s.peakWeek.startDate);
    if (bars.length > 0) {
      const center = bars[0].x;
      const c = s.peakWeek.total;
      return {
        highlight: bars,
        caption: `Peak week · ${c.toLocaleString()} contribution${c === 1 ? "" : "s"} · w/c ${s.peakWeek.startDate}`,
        centerX: center,
      };
    }
  }
  if (s.peakDay) {
    const bar = placementForDate(placements, s.peakDay.date);
    if (bar) {
      const c = s.peakDay.count;
      return {
        highlight: [bar],
        caption: `Peak day · ${c.toLocaleString()} contribution${c === 1 ? "" : "s"} · ${s.peakDay.date}`,
        centerX: bar.x,
      };
    }
  }
  return { highlight: [], caption: null, centerX: fallbackCenterX };
}

/**
 * Build a piecewise-linear remap of cruise time `u in [0,1]` (uniform) to a
 * density-weighted progress along the year. The camera spends MORE frames in
 * dense stretches (slow-mo through bustling districts) and FEWER frames in
 * sparse stretches (skim across quiet weeks). The curve is normalized so the
 * year always uses its full cruise budget regardless of density distribution.
 *
 * Returns an array of `[u, t]` pairs where `u` is uniform progress through
 * cruise time and `t` is the position along the year's X span. With no
 * density variation (empty year), `t === u` (uniform cruise).
 */
function buildSpeedRemap(curve: DensitySample[]): Array<[number, number]> {
  const N = curve.length;
  if (N < 2) {
    return [[0, 0], [1, 1]];
  }
  // Weight: dwell-time per sample = (0.4 + density). Sparse weeks get 0.4,
  // dense weeks get 1.4 → ~3.5× speed difference between extremes.
  const weights: number[] = curve.map((s) => 0.4 + s.density);
  let totalW = 0;
  for (const w of weights) totalW += w;
  // Cumulative time (u) per sample, normalized.
  const cumU: number[] = [];
  let acc = 0;
  for (let i = 0; i < N; i++) {
    cumU.push(acc / totalW);
    acc += weights[i];
  }
  cumU.push(1);
  // Map each sample to its spatial position (t in [0,1]).
  const samples: Array<[number, number]> = [];
  for (let i = 0; i < N; i++) {
    const tSpace = i / (N - 1);
    samples.push([cumU[i], tSpace]);
  }
  // Ensure endpoints are exact.
  samples[0] = [0, 0];
  samples[samples.length - 1] = [1, 1];
  return samples;
}

function lerpSpeedRemap(remap: Array<[number, number]>, u: number): number {
  if (u <= remap[0][0]) return remap[0][1];
  if (u >= remap[remap.length - 1][0]) return remap[remap.length - 1][1];
  for (let i = 0; i < remap.length - 1; i++) {
    const [u0, t0] = remap[i];
    const [u1, t1] = remap[i + 1];
    if (u >= u0 && u <= u1) {
      const f = (u - u0) / Math.max(u1 - u0, 1e-9);
      return t0 + (t1 - t0) * f;
    }
  }
  return remap[remap.length - 1][1];
}

function buildKeyframes(
  year: YearData,
  placements: BarPlacement[],
  peak: PeakTargetBars,
  densityCurve: DensitySample[],
  hasContent: boolean,
): CameraKeyframe[] {
  const geom = gridGeometry(year);
  const stride = geom.cellSize + geom.gap;
  const span = (geom.weekCount - 1) * stride;
  const speedRemap = buildSpeedRemap(densityCurve);

  const k: CameraKeyframe[] = [];

  // -------------------- 0..75 Opening: empty grid → wave begins ------------
  // Frame 0: camera sits behind the year's left edge so cameraX < originX - lead.
  // ALL bars have revealT=0 → invisible. The shot reads as: empty grid +
  // title overlay. As camera flies forward during 0→75, the build wave
  // sweeps across the first weeks of the year — the "year being built".
  const startCamX = geom.originX - BUILD_LEAD - 4;
  k.push({
    frame: 0,
    position: [startCamX, 12, 11],
    lookAt: [geom.originX + 4, 1.5, 0],
    fov: 44,
  });
  k.push({
    frame: TITLE_END,
    position: [geom.originX - 2.5, 8, 9],
    lookAt: [geom.originX + 5, 1.6, 0],
    fov: 40,
  });

  // -------------------- 75..180 Entry --------------------------------------
  k.push({
    frame: ENTRY_END,
    position: [geom.originX - 1.5, 4.5, Z_FLOOR + 2.5],
    lookAt: [geom.originX + 4, 1.8, 0],
    fov: 36,
  });

  // -------------------- 180..600 Cruise with adaptive speed/density --------
  // Use the speed-remap so time spent in dense stretches > sparse stretches.
  const cruiseSamples = 16;
  for (let i = 0; i <= cruiseSamples; i++) {
    const u = i / cruiseSamples;
    const t = lerpSpeedRemap(speedRemap, u);
    const x = geom.originX + t * span;
    const density = densityAt(densityCurve, x);
    const lift = peakLiftAtX(x, placements);
    // Z: 8.5 sparse → Z_FLOOR dense.
    const z = Math.max(Z_FLOOR, 8.5 - density * (8.5 - Z_FLOOR));
    // Y: hug canopy + a touch above peak.
    const y = Math.max(2.6, 2.8 + (lift - 2.4) * 0.55);
    // FOV: 38° wide sparse → 26° telephoto dense.
    const fov = 38 - density * 12;
    const lookY = density > 0.4 ? 1.0 + density * 1.2 : 0.6;
    const frame = ENTRY_END + Math.round(u * (CRUISE_END - ENTRY_END));
    k.push({
      frame,
      position: [x, y, z],
      lookAt: [x + 4, lookY, 0],
      fov,
    });
  }

  // -------------------- 600..660 Peak approach ------------------------------
  const px = peak.centerX;
  const peakLift = peakLiftAtX(px, placements);
  const peakY = Math.max(2.4, Math.min(peakLift * 0.55 + 1.0, 5.5));

  if (hasContent) {
    k.push({
      frame: CRUISE_END + 30,
      position: [px - 7, peakY + 1.6, Z_FLOOR + 1.5],
      lookAt: [px, peakY * 0.6, 0],
      fov: 30,
    });
    k.push({
      frame: APPROACH_END,
      position: [px - 3, peakY + 0.5, Z_FLOOR + 0.4],
      lookAt: [px, peakY * 0.55, 0],
      fov: 26,
    });
    // -------------------- 660..720 Canyon HOLD (near-stationary) -----------
    // 60-frame near-stationary moment — the climax. Camera barely drifts so
    // the highlight glow + caption can land.
    k.push({
      frame: APPROACH_END + 25,
      position: [px - 1.2, peakY + 0.3, Z_FLOOR + 0.2],
      lookAt: [px + 0.8, peakY * 0.55, 0],
      fov: 24,
    });
    k.push({
      frame: APPROACH_END + 50,
      position: [px + 0.4, peakY + 0.3, Z_FLOOR + 0.2],
      lookAt: [px + 1.5, peakY * 0.55, 0],
      fov: 24,
    });
    k.push({
      frame: CANYON_END,
      position: [px + 2.2, peakY + 1.4, Z_FLOOR + 1.2],
      lookAt: [px + 1.5, peakY * 0.5, 0],
      fov: 28,
    });
  } else {
    // Empty year: glide gently — no climax, no canyon.
    k.push({
      frame: CRUISE_END + 60,
      position: [span * 0.2, 8, 12],
      lookAt: [0, 1.5, 0],
      fov: 40,
    });
    k.push({
      frame: CANYON_END,
      position: [span * 0.15, 10, 14],
      lookAt: [0, 1.5, 0],
      fov: 42,
    });
  }

  // -------------------- 720..810 Emergence + wide reveal --------------------
  k.push({
    frame: CANYON_END + 45,
    position: [span * 0.25, 12, 16],
    lookAt: [0, 1.8, 0],
    fov: 38,
  });
  k.push({
    frame: EMERGE_END,
    position: [span * 0.1, 11, 18],
    lookAt: [0, 1.8, 0],
    fov: 38,
  });

  // -------------------- 810..900 Chart-out (side profile) -------------------
  // The reveal: camera slides to a near-side pose so the year reads as a 1D
  // histogram silhouette. Y low, Z large, FOV tight (telephoto compresses the
  // year into a chart-like ribbon).
  k.push({
    frame: EMERGE_END + 45,
    position: [0, 4, 24],
    lookAt: [0, 2, 0],
    fov: 32,
  });
  k.push({
    frame: TOTAL,
    position: [0, 2.5, 28],
    lookAt: [0, 2, 0],
    fov: 28,
  });

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
  const frame = useCurrentFrame();
  const placements = useMemo(() => layoutBars(data), [data]);
  const hasContent = data.totalContributions > 0;
  const densityCurve = useMemo(
    () => buildRelativeDensityCurve(placements, 64, 2.5),
    [placements],
  );
  const peak = useMemo(
    () => pickPeakTarget(data, placements, 0),
    [data, placements],
  );
  const keyframes = useMemo(
    () => buildKeyframes(data, placements, peak, densityCurve, hasContent),
    [data, placements, peak, densityCurve, hasContent],
  );
  const p = palette(theme);

  // Sample the camera X at the current frame and pass it to <Skyline> so
  // bars rise into existence as the camera approaches.
  const cameraX = useMemo(
    () => sampleRig(frame, keyframes).position[0],
    [frame, keyframes],
  );

  return (
    <AbsoluteFill style={{ backgroundColor: p.background }}>
      <ThreeCanvas
        width={width}
        height={height}
        gl={{
          antialias: true,
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.2,
          outputColorSpace: THREE.SRGBColorSpace,
        }}
        style={{ backgroundColor: p.background }}
      >
        {/* Lighter fog (0.010) — v2 0.018 was eating mid-tones and flattening
            L1-L3 distinction at distance. */}
        <fogExp2 attach="fog" args={[p.background, 0.010]} />
        <Lighting theme={theme} />
        <CameraRig keyframes={keyframes} />
        <Skyline
          year={data}
          theme={theme}
          cameraX={cameraX}
          buildLeadDistance={BUILD_LEAD}
          showBaseplate
        />
        {peak.highlight.length > 0 && hasContent && (
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

      {/* Title card — overlays the live build. */}
      <Captions
        theme={theme}
        visibleFromFrame={0}
        visibleToFrame={TITLE_END - 5}
        placement="center"
        fadeFrames={18}
      >
        <div style={{ fontSize: 88, fontWeight: 700 }}>{username}</div>
        <div style={{ fontSize: 60, marginTop: 16, opacity: 0.85 }}>
          {data.year} · {data.totalContributions.toLocaleString()} contribution
          {data.totalContributions === 1 ? "" : "s"}
        </div>
      </Captions>

      {/* Persistent lower-third watermark during cruise → emerge. */}
      <LowerThirdWatermark
        username={username}
        year={data.year}
        fromFrame={TITLE_END}
        toFrame={EMERGE_END - 30}
        theme={theme}
      />

      {/* Empty-year contemplative caption (replaces canyon caption). */}
      {!hasContent && (
        <Captions
          theme={theme}
          visibleFromFrame={CRUISE_END}
          visibleToFrame={EMERGE_END - 30}
          placement="bottom"
          fadeFrames={20}
        >
          A quiet year. The graph took a breath.
        </Captions>
      )}

      {/* Canyon-moment caption — observational, magnitude-agnostic. */}
      {peak.caption && hasContent && (
        <Captions
          theme={theme}
          visibleFromFrame={APPROACH_END + 5}
          visibleToFrame={CANYON_END + 15}
          placement="bottom"
          fadeFrames={14}
        >
          {peak.caption}
        </Captions>
      )}

      {/* Outro: side-profile chart card. */}
      <ChartOutro
        year={data.year}
        total={data.totalContributions}
        username={username}
        fromFrame={EMERGE_END + 20}
        toFrame={TOTAL}
        theme={theme}
      />
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

/**
 * Chart-out overlay during the side-profile pose: simple corner card with
 * year + total formatted as a data line, sitting above the silhouette.
 */
const ChartOutro: React.FC<{
  year: number;
  total: number;
  username: string;
  fromFrame: number;
  toFrame: number;
  theme: SkylineYearProps["theme"];
}> = ({ year, total, username, fromFrame, toFrame, theme }) => {
  const frame = useCurrentFrame();
  const p = palette(theme);
  const opacity = interpolate(
    frame,
    [fromFrame, fromFrame + 25, toFrame - 10, toFrame],
    [0, 1, 1, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  if (opacity <= 0) return null;
  return (
    <AbsoluteFill
      style={{
        justifyContent: "flex-start",
        alignItems: "center",
        padding: 100,
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
          textAlign: "center",
        }}
      >
        <div
          style={{
            fontSize: 32,
            opacity: 0.7,
            letterSpacing: 4,
            textTransform: "uppercase",
          }}
        >
          @{username.replace(/^@/, "")}
        </div>
        <div style={{ fontSize: 96, fontWeight: 700, marginTop: 8 }}>
          {year}
        </div>
        <div style={{ fontSize: 52, marginTop: 4, opacity: 0.9 }}>
          {total.toLocaleString()} contribution{total === 1 ? "" : "s"}
        </div>
      </div>
    </AbsoluteFill>
  );
};
