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
import { MONA_SANS_FONT_FAMILY } from "../scene/typography";

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
// v11 changes:
//  - FLYBY_END added: panoramic orbit now happens after cruise, before peak —
//    "here's your year at a glance" → "and here's your best moment".
//  - CRUISE_END compressed to 480 (11s) to make room for the mid-video flyby.
//  - EMERGE_END extended to 840 to give the outro/home-arc 60 frames.
//  - Frame 0 = frame 900 (seamless loop) unchanged.
const TITLE_END = 90;       // 3s — wide profile overview + title card
const ENTRY_END = 150;      // 5s — descended to street level, cruise begins
const CRUISE_END = 480;     // 16s — density-weighted cruise along the year
const FLYBY_END = 570;      // 19s — panoramic orbit showing the full year
const APPROACH_END = 660;   // 22s — 3s smooth decel into peak district
const CANYON_END = 780;     // 26s — 4s canyon hold to celebrate the peak
const EMERGE_END = 840;     // 28s — 2s pull-back + outro
const TOTAL = SKYLINE_YEAR_DURATION_FRAMES; // 900 — 2s home arc (seamless loop)

// Z floor — camera never goes closer than this in Z so it doesn't clip into
// bars (bars span Z ±3.45 with originZ=-3 and cellSize=0.9 → far edge ≈ 3.5).
// 13.5 keeps the camera ~10 units from bar faces — cinematic "street-level"
// without going inside the geometry.
const Z_FLOOR = 13.5;

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

  // Compute the X-range of bars that actually have contributions so the cruise
  // doesn't sweep through empty space when the year is partial (current year)
  // or front-loaded. Falls back to the full span for empty years.
  const activeXs = placements
    .filter((p) => p.inYear && p.count > 0)
    .map((p) => p.x);
  const hasActive = activeXs.length > 0;
  const firstActiveX = hasActive ? Math.min(...activeXs) : geom.originX;
  const lastActiveX = hasActive ? Math.max(...activeXs) : geom.originX + span;
  const midActiveX = (firstActiveX + lastActiveX) / 2;
  // Cap cruise X at lastActiveX + 2 (a column of breathing room) so the camera
  // never wanders past the data and reveals an empty plane.
  const cruiseEndX = hasActive
    ? Math.min(geom.originX + span, lastActiveX + 2)
    : geom.originX + span;
  const cruiseSpan = cruiseEndX - geom.originX;

  const k: CameraKeyframe[] = [];

  // The "home" position is the wide overview used for both frame 0 and the
  // final frame — this makes the sequence loop seamlessly.
  // Camera sits above and behind the year midpoint, showing the full skyline
  // silhouette as an establishing shot before the dive begins.
  const homePos: [number, number, number] = [midActiveX, 14, 42];
  const homeLook: [number, number, number] = [midActiveX, 2.5, 0];
  const homeFov = 58;

  // -------------------- 0..90 Title: wide overview establishing shot --------
  // cut:true → zero outgoing velocity so the C¹ spline doesn't overshoot.
  // The camera holds almost still (barely breathing-in zoom) for 3 seconds
  // while the title card overlays the full-year silhouette below it.
  k.push({
    frame: 0,
    position: homePos,
    lookAt: homeLook,
    fov: homeFov,
    cut: true,
  });
  // Breathe gently in toward the year during the title hold.
  k.push({
    frame: 60,
    position: [midActiveX, 13.0, 39],
    lookAt: [midActiveX, 2.5, 0],
    fov: 56,
  });

  // -------------------- 90..150 Entry: dive to street level (2s) -----------
  // No intermediate keyframe at TITLE_END — let the C¹ spline naturally arc
  // from the overview hold (frame 60, still centred) to the street-level entry
  // position. Without an extra waypoint the camera eases leftward and downward
  // as one flowing movement rather than a sharp pan at the end of the title.
  k.push({
    frame: ENTRY_END,  // 150
    position: [geom.originX - 1.5, 4.5, Z_FLOOR + 2.5],
    lookAt: [geom.originX + 4, 1.8, 0],
    fov: 42,
  });

  // -------------------- 150..480 Cruise with adaptive speed/density --------
  // 5 samples starting at i=1 (i=0 would duplicate the ENTRY_END keyframe).
  // EWMA smoothedDensity is pre-seeded from the entry position so the first
  // cruise sample blends correctly.
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
    const frame = ENTRY_END + Math.round(u * (CRUISE_END - ENTRY_END));
    k.push({ frame, position: [x, y, z], lookAt: [x + 4, lookY, 0], fov });
  }

  // -------------------- 480..570 Panoramic orbit flyby (3s) ----------------
  // After street-level cruise the camera pulls back to show the FULL year
  // silhouette before diving to the peak. Narrative: "here's everything you
  // built this year… and here's your best moment."
  // lookAt is pinned to midActiveX throughout for a stately orbital pan.
  k.push({
    frame: CRUISE_END + 30,  // 510
    position: [midActiveX + 10, 9.5, 28],
    lookAt: [midActiveX, 2.2, 0],
    fov: 40,
  });
  k.push({
    frame: CRUISE_END + 60,  // 540
    position: [midActiveX, 12.5, 36],
    lookAt: [midActiveX, 2.4, 0],
    fov: 52,
  });
  k.push({
    frame: FLYBY_END,  // 570
    position: [midActiveX - 10, 9.5, 28],
    lookAt: [midActiveX, 2.2, 0],
    fov: 40,
  });

  // -------------------- 570..660 Peak approach (3s) -------------------------
  const px = peak.centerX;
  const peakLift = peakLiftAtX(px, placements);
  const peakY = Math.max(2.4, Math.min(peakLift * 0.55 + 1.0, 5.5));

  if (hasContent) {
    // Bridge: dive from flyby position toward the peak.
    k.push({
      frame: APPROACH_END,
      position: [px - 4, peakY + 1.4, Z_FLOOR + 4.0],
      lookAt: [px, peakY * 0.55, 0],
      fov: 32,
    });

    // -------------------- 660..780 Canyon HOLD (4s) ------------------------
    // Three slow drift keyframes — linger on the peak.
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
    // Empty year: gentle orbit over the centre before emergence.
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

  // -------------------- 780..840 Emergence + outro (2s) -------------------
  // Single pull-back keyframe — camera rises away from the canyon and begins
  // the arc home. ChartOutro overlays show totals during this window.
  k.push({
    frame: EMERGE_END - 30,  // 810
    position: [midActiveX + 6, 10.5, 26],
    lookAt: [midActiveX, 2.0, 0],
    fov: 38,
  });

  // -------------------- 840..900 Home arc → seamless loop (2s) ------------
  // Camera arcs back to homePos so the loop is invisible (frame 900 = frame 0).
  // With nextKf=null the CameraRig sets C2=homePos → velocity is zero at
  // frame 900, matching the cut:true zero-velocity at frame 0.
  k.push({
    frame: EMERGE_END + 30,  // 870
    position: [midActiveX, 13.0, 38],
    lookAt: [midActiveX, 2.4, 0],
    fov: 56,
  });
  // Frame 900 = frame 0: exactly homePos so the loop is invisible.
  k.push({
    frame: TOTAL,  // 900
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

  // Build-wave sentinel logic:
  //  - Overview + entry (0→ENTRY_END): all bars pre-revealed so the establishing
  //    shot shows the full year silhouette.
  //  - Cruise (ENTRY_END→CRUISE_END): camera-X based reveal — bars materialise
  //    progressively as the camera sweeps left-to-right. At street level the far
  //    end of the year isn't visible anyway, so the transition at ENTRY_END is
  //    imperceptible.
  //  - Flyby + rest (CRUISE_END→): all bars visible — cruise has already swept
  //    to cruiseEndX so all bars are built; switching back to camera-X would
  //    un-reveal the far end as the camera orbits back. Keeping sentinel ensures
  //    the flyby "year in review" shows the complete skyline.
  const cameraX = useMemo(() => {
    if (frame <= ENTRY_END || frame >= CRUISE_END) return 1e6;
    return sampleRig(frame, keyframes).position[0];
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
          placement="top"
          fadeFrames={20}
        >
          A quiet year. The graph took a breath.
        </Captions>
      )}

      {/* Canyon-moment caption — at the top so it doesn't clash with the
          lower-third watermark (username/year) which sits at the bottom. */}
      {peak.caption && hasContent && (
        <Captions
          theme={theme}
          visibleFromFrame={APPROACH_END + 5}
          visibleToFrame={CANYON_END + 15}
          placement="top"
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
          fontFamily: `"${MONA_SANS_FONT_FAMILY}", ui-sans-serif, system-ui, sans-serif`,
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
