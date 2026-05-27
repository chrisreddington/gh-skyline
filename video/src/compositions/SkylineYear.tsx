/**
 * SkylineYear: single-year fly-through composition.
 *
 * Storytelling beats (frames @30fps, total 900 = 30s):
 *   0   – 90   Hero-card overview from the three-quarter home pose while the
 *              title overlays the skyline.
 *   90  – 150  Dive to street level near week zero.
 *   150 – 180  Right-to-left collapse wave retracts the skyline before cruise.
 *   180 – 480  Density-weighted cruise rebuilds the bars left-to-right.
 *   480 – 570  Full 360° helicopter orbit around the city centre.
 *   570 – 660  Peak approach, with non-highlight bars shrinking to 20%.
 *   660 – 780  Canyon hold on the peak district with stat-card overlay.
 *   780 – 840  Emergence and outro reveal.
 *   840 – 900  Arc back to the hero-card home pose for a seamless loop.
 *
 * Adaptive fallbacks:
 *   - Empty year (totalContributions == 0 or stats == null): canyon + highlight
 *     are skipped; cruise extends and the side-profile chart-out still plays.
 *   - Tiny year (peak count == 1): the stat card still uses observational copy.
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
import { MONA_SANS_FONT_FAMILY } from "../scene/typography";

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

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

// Phase boundaries (absolute frames @ 30fps = 30s total).
//
// v12 changes:
//  - COLLAPSE_END = 180: new "wave-down" phase 150→180 collapses bars R→L
//    before the cruise begins. Cruise shifts to 180 (same budget, different start).
//  - homePos changed to hero-card angle: three-quarter view at r≈17, h=10.
//  - Full 360° helicopter orbit in flyby phase.
const TITLE_END = 90;         // 3s — hero-card angle overview + title card
const ENTRY_END = 150;        // 5s — street-level entry
const COLLAPSE_END = 180;     // 6s — R→L wave collapses bars before cruise
const CRUISE_END = 480;       // 16s — density-weighted cruise (bars build in again)
const FLYBY_END = 570;        // 19s — full 360° helicopter orbit
const APPROACH_END = 660;     // 22s — approach to peak + focus effect begins
const CANYON_END = 780;       // 26s — canyon hold, peak spotlight
const EMERGE_END = 840;       // 28s — emerge, outro card
const TOTAL = SKYLINE_YEAR_DURATION_FRAMES; // 900 — home arc back to hero pose

// Z floor — camera never goes closer than this in Z so it doesn't clip into
// bars (bars span Z ±3.45 with originZ=-3 and cellSize=0.9 → far edge ≈ 3.5).
// 13.5 keeps the camera ~10 units from bar faces — cinematic "street-level"
// without going inside the geometry.
const Z_FLOOR = 13.5;

// Bar build-in: how far ahead of the camera the wave extends, in world units.
const BUILD_LEAD = 9;

interface PeakCaption {
  /** The large numeric metric (e.g. 497). */
  count: number;
  /** "PEAK WEEK" or "PEAK DAY" */
  label: string;
  /** Formatted date range, e.g. "Apr 20 – Apr 26" */
  dateRange: string;
}

interface PeakTargetBars {
  /** Bars to glow during the canyon moment (peakWeek column if available). */
  highlight: BarPlacement[];
  /** Caption to surface during the canyon moment. */
  caption: PeakCaption | null;
  /** X position to centre the canyon dive on. */
  centerX: number;
}

/** Format "2025-04-20" → "Apr 20" */
export function fmtDate(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${MONTH_ABBR[parseInt(m, 10) - 1]} ${parseInt(d, 10)}`;
}

/** Compute the end date (startDate + 6 days) and format as "Apr 20 – Apr 26". */
export function fmtWeekRange(startIso: string): string {
  const start = new Date(startIso + "T12:00:00Z");
  const end = new Date(start.getTime() + 6 * 86400_000);
  const em = MONTH_ABBR[end.getUTCMonth()];
  const ed = end.getUTCDate();
  return `${fmtDate(startIso)} – ${em} ${ed}`;
}

/**
 * Pick the canyon target. Order of preference: peakWeek → peakDay → none.
 * Captions stay observational regardless of magnitude (no "got architectural"
 * for small numbers, no "skyline woke up" for empty years).
 */
export function pickPeakTarget(
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
      return {
        highlight: bars,
        caption: {
          count: s.peakWeek.total,
          label: "PEAK WEEK",
          dateRange: fmtWeekRange(s.peakWeek.startDate),
        },
        centerX: bars[0].x,
      };
    }
  }
  if (s.peakDay) {
    const bar = placementForDate(placements, s.peakDay.date);
    if (bar) {
      return {
        highlight: [bar],
        caption: {
          count: s.peakDay.count,
          label: "PEAK DAY",
          dateRange: fmtDate(s.peakDay.date),
        },
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

export function buildKeyframes(
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

  const activeXs = placements
    .filter((p) => p.inYear && p.count > 0)
    .map((p) => p.x);
  const hasActive = activeXs.length > 0;
  const firstActiveX = hasActive ? Math.min(...activeXs) : geom.originX;
  const lastActiveX = hasActive ? Math.max(...activeXs) : geom.originX + span;
  const midActiveX = (firstActiveX + lastActiveX) / 2;
  const cruiseEndX = hasActive
    ? Math.min(geom.originX + span, lastActiveX + 2)
    : geom.originX + span;
  const cruiseSpan = cruiseEndX - geom.originX;

  // Hero-card "home" position: three-quarter isometric view matching the
  // GitHub Skyline hero card aesthetic. Same for frame 0 and frame 900 → loop.
  const homePos: [number, number, number] = [midActiveX + 14, 10, 20];
  const homeLook: [number, number, number] = [midActiveX - 2, 1.8, 0];
  const homeFov = 38;

  const k: CameraKeyframe[] = [];

  // ---- 0..90 Hero-card overview + title card -----
  k.push({ frame: 0, position: homePos, lookAt: homeLook, fov: homeFov, cut: true });
  // Gentle breathing zoom toward the skyline
  k.push({
    frame: 60,
    position: [midActiveX + 11, 9.0, 17],
    lookAt: [midActiveX - 1, 1.6, 0],
    fov: 36,
  });

  // ---- 90..150 Dive to street level -----
  k.push({
    frame: ENTRY_END,
    position: [geom.originX - 1.5, 4.5, Z_FLOOR + 2.5],
    lookAt: [geom.originX + 4, 1.8, 0],
    fov: 42,
  });

  // ---- 150..180 Collapse-wave camera hold -----
  // The camera stays at street level while bars retract R→L.
  // No camera keyframe needed here; the spline glides through naturally.

  // ---- 180..480 Cruise (bars rebuild L→R) -----
  const cruiseSamples = 5;
  let smoothedDensity = densityAt(densityCurve, geom.originX);
  for (let i = 1; i <= cruiseSamples; i++) {
    const u = i / cruiseSamples;
    const t = lerpSpeedRemap(speedRemap, u);
    const x = geom.originX + t * cruiseSpan;
    const rawDensity = densityAt(densityCurve, x);
    smoothedDensity = smoothedDensity * 0.75 + rawDensity * 0.25;
    const lift = peakLiftAtX(x, placements);
    const z = Math.max(Z_FLOOR, 19 - smoothedDensity * (19 - Z_FLOOR));
    const y = Math.max(5.0, 5.4 + (lift - 2.4) * 0.45);
    const fov = 42 - smoothedDensity * 4;
    const lookY = smoothedDensity > 0.4 ? 1.2 + smoothedDensity * 1.0 : 0.8;
    const frame = COLLAPSE_END + Math.round(u * (CRUISE_END - COLLAPSE_END));
    k.push({ frame, position: [x, y, z], lookAt: [x + 4, lookY, 0], fov });
  }

  // ---- 480..570 Full 360° helicopter orbit -----
  // 8 evenly-spaced keyframes around a circle, r=32, h=11.
  const orbitR = 32;
  const orbitH = 11;
  const orbitCenter: [number, number, number] = [midActiveX, 0, 0];
  const orbitFrames = FLYBY_END - CRUISE_END;
  for (let seg = 1; seg <= 8; seg++) {
    const theta = (seg / 8) * Math.PI * 2;
    const orbitFrame = CRUISE_END + Math.round((seg / 8) * orbitFrames);
    k.push({
      frame: orbitFrame,
      position: [
        orbitCenter[0] + orbitR * Math.sin(theta),
        orbitH,
        orbitCenter[2] + orbitR * Math.cos(theta),
      ],
      lookAt: [midActiveX, 2, 0],
      fov: 44,
    });
  }

  // ---- 570..660 Peak approach -----
  const px = peak.centerX;
  const peakLift = peakLiftAtX(px, placements);
  const peakY = Math.max(2.4, Math.min(peakLift * 0.55 + 1.0, 5.5));

  if (hasContent) {
    k.push({
      frame: APPROACH_END,
      position: [px - 4, peakY + 1.4, Z_FLOOR + 4.0],
      lookAt: [px, peakY * 0.55, 0],
      fov: 32,
    });

    // ---- 660..780 Canyon HOLD -----
    k.push({
      frame: APPROACH_END + 40,
      position: [px - 1.0, peakY + 0.7, Z_FLOOR + 3.5],
      lookAt: [px + 0.8, peakY * 0.5, 0],
      fov: 29,
    });
    k.push({
      frame: APPROACH_END + 80,
      position: [px + 0.8, peakY + 0.5, Z_FLOOR + 3.4],
      lookAt: [px + 1.5, peakY * 0.48, 0],
      fov: 28,
    });
    k.push({
      frame: CANYON_END,
      position: [px + 2.5, peakY + 1.0, Z_FLOOR + 3.8],
      lookAt: [px + 1.5, peakY * 0.5, 0],
      fov: 30,
    });
  } else {
    k.push({
      frame: APPROACH_END,
      position: [midActiveX, 8, 22],
      lookAt: [midActiveX, 1.5, 0],
      fov: 44,
    });
    k.push({
      frame: CANYON_END,
      position: [midActiveX, 10, 26],
      lookAt: [midActiveX, 1.5, 0],
      fov: 48,
    });
  }

  // ---- 780..840 Emerge + outro -----
  k.push({
    frame: EMERGE_END - 30,
    position: [midActiveX + 6, 10.5, 26],
    lookAt: [midActiveX, 2.0, 0],
    fov: 38,
  });

  // ---- 840..900 Home arc → seamless loop -----
  k.push({
    frame: EMERGE_END + 30,
    position: [midActiveX + 10, 9.5, 22],
    lookAt: [midActiveX - 1, 2.0, 0],
    fov: 38,
  });
  k.push({
    frame: TOTAL,
    position: homePos,
    lookAt: homeLook,
    fov: homeFov,
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

  // Collapse wave progress: 0→1 over frames ENTRY_END→COLLAPSE_END.
  const collapseProgress = useMemo(
    () => interpolate(frame, [ENTRY_END, COLLAPSE_END], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }),
    [frame],
  );

  // Peak focus progress: ramps 0→1 during approach, holds at 1 in canyon,
  // then recovers 1→0 during emerge.
  const focusProgress = useMemo(() => {
    if (!hasContent) return 0;
    return interpolate(
      frame,
      [APPROACH_END, CANYON_END, EMERGE_END],
      [0, 1, 0],
      { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
    );
  }, [frame, hasContent]);

  // X positions of peak highlight bars — immune to focus shrink.
  const peakHighlightXs = useMemo(
    () => peak.highlight.map((b) => b.x),
    [peak.highlight],
  );

  // Current month during cruise, for lower-third indicator.
  // Uses Wednesday (weekday index 3) of the nearest week column as anchor.
  const currentMonth = useMemo<number | null>(() => {
    if (frame < COLLAPSE_END || frame > CRUISE_END) return null;
    const geom = gridGeometry(data);
    const stride = geom.cellSize + geom.gap;
    const camX = sampleRig(frame, keyframes).position[0];
    const weekIdx = Math.max(0, Math.min(
      data.weeks.length - 1,
      Math.round((camX - geom.originX) / stride),
    ));
    const wednesdayIdx = weekIdx * 7 + 3;
    const anchor = placements[wednesdayIdx];
    if (!anchor?.date) return null;
    return new Date(anchor.date + "T12:00:00Z").getUTCMonth();
  }, [frame, placements, data, keyframes]);

  const cameraX = useMemo(() => {
    // Cruise phase only: camera-X based reveal so bars build in as camera sweeps.
    // All other phases use sentinel 1e6 (all bars visible).
    if (frame >= COLLAPSE_END && frame <= CRUISE_END) {
      return sampleRig(frame, keyframes).position[0];
    }
    return 1e6;
  }, [frame, keyframes]);

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
          showLabel={false}
          collapseProgress={collapseProgress}
          focusProgress={focusProgress}
          peakHighlightXs={peakHighlightXs}
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
        currentMonth={currentMonth}
      />

      {/* Empty-year contemplative caption (replaces canyon caption). */}
      {!hasContent && (
        <Captions
          theme={theme}
          visibleFromFrame={CRUISE_END}
          visibleToFrame={EMERGE_END - 30}
          placement="top"
          fadeFrames={20}
        >
          A quiet year. The graph took a breath.
        </Captions>
      )}

      {peak.caption && hasContent && (
        <PeakStatCard
          caption={peak.caption}
          visibleFromFrame={APPROACH_END + 5}
          visibleToFrame={CANYON_END + 15}
          theme={theme}
        />
      )}

      {/* Outro: side-profile chart card. */}
      <ChartOutro
        year={data.year}
        total={data.totalContributions}
        username={username}
        fromFrame={EMERGE_END}
        toFrame={TOTAL}
        theme={theme}
      />

      {/* WebGL warm-up cover: the canvas isn't ready on frame 0, causing a
          1-frame black flash. Fade out from background over frames 0→8. */}
      {frame <= 8 && (
        <AbsoluteFill
          style={{
            backgroundColor: p.background,
            opacity: interpolate(frame, [0, 1, 8], [1, 1, 0], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
            pointerEvents: "none",
          }}
        />
      )}
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
  currentMonth?: number | null;
}> = ({ username, year, fromFrame, toFrame, theme, currentMonth }) => {
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
          fontFamily: `"${MONA_SANS_FONT_FAMILY}", ui-sans-serif, system-ui, sans-serif`,
          fontSize: 36,
          fontWeight: 500,
          letterSpacing: 0.5,
        }}
      >
        @{username.replace(/^@/, "")} · {year}
        {currentMonth != null && (
          <span style={{ opacity: 0.7 }}>
            {" "}· {MONTH_NAMES[currentMonth].toUpperCase()}
          </span>
        )}
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
          fontFamily: `"${MONA_SANS_FONT_FAMILY}", ui-sans-serif, system-ui, sans-serif`,
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

const PeakStatCard: React.FC<{
  caption: PeakCaption;
  visibleFromFrame: number;
  visibleToFrame: number;
  theme: SkylineYearProps["theme"];
}> = ({ caption, visibleFromFrame, visibleToFrame, theme }) => {
  const frame = useCurrentFrame();
  const p = palette(theme);
  const opacity = interpolate(
    frame,
    [visibleFromFrame, visibleFromFrame + 14, visibleToFrame - 14, visibleToFrame],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  if (opacity <= 0) return null;
  const accentColor = theme === "dark" ? "#39d353" : "#26a641";
  return (
    <AbsoluteFill
      style={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: 80,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          opacity,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 8,
          fontFamily: MONA_SANS_FONT_FAMILY,
          color: p.captionText,
        }}
      >
        <div
          style={{
            fontSize: 28,
            fontWeight: 500,
            letterSpacing: "0.25em",
            textTransform: "uppercase",
            opacity: 0.6,
            color: p.captionText,
          }}
        >
          {caption.label}
        </div>
        <div
          style={{
            fontSize: 120,
            fontWeight: 800,
            lineHeight: 1,
            color: accentColor,
            letterSpacing: "-0.02em",
          }}
        >
          {caption.count.toLocaleString()}
        </div>
        <div style={{ fontSize: 36, fontWeight: 400, opacity: 0.75 }}>
          contribution{caption.count === 1 ? "" : "s"}
        </div>
        <div style={{ fontSize: 28, fontWeight: 400, opacity: 0.55, marginTop: 4 }}>
          {caption.dateRange}
        </div>
      </div>
    </AbsoluteFill>
  );
};
