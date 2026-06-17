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
  staticFile,
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
  buildRelativeDensityCurve,
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
import {
  MARKERS,
  SKYLINE_YEAR_FPS as PRIMITIVES_FPS,
  SKYLINE_YEAR_TOTAL_FRAMES,
  BUILD_LEAD,
  buildCameraContext,
  composeYearCamera,
  type PeakCaption,
  type PeakTargetBars,
} from "../scene/primitives";

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const skylineYearPropsSchema = z.object({
  data: yearSchema,
  username: z.string().min(1),
  theme: themeSchema.default("dark"),
  resolution: resolutionSchema.default("4k"),
});

export type SkylineYearProps = z.infer<typeof skylineYearPropsSchema>;

export const SKYLINE_YEAR_FPS = PRIMITIVES_FPS;
export const SKYLINE_YEAR_DURATION_FRAMES = SKYLINE_YEAR_TOTAL_FRAMES; // 38.2s @30fps (6s outro hold)

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

// Phase boundaries (absolute frames @ 30fps). Single source of truth is
// `MARKERS` in scene/primitives/timeline.ts — these local aliases preserve the
// readable names used throughout the choreography below.
const COLLAPSE_START = MARKERS.collapseStart;     // 2.5s — bars start collapsing the moment the
                              // camera commits to the descent. Camera motion + bar motion
                              // begin in lockstep so the collapse reads intentional.
const COLLAPSE_END = MARKERS.collapseEnd;         // 4.67s — bars fully collapsed by F140 (65-frame window).
const TITLE_END = MARKERS.titleEnd;               // 3.3s — kept for LowerThirdWatermark fade-in timing
const ENTRY_END = MARKERS.entryEnd;               // 5s — dive complete; cruise begins
const COLLAPSE_RELEASE = MARKERS.collapseRelease; // 6.33s — collapse fully released; bars now grow via cruise reveal
const CRUISE_END = MARKERS.cruiseEnd;             // 15s — density-weighted cruise (bars build in)
const APPROACH_END = MARKERS.approachEnd;         // 25s — approach to peak, focus effect
const CANYON_END = MARKERS.canyonEnd;             // 30.2s — canyon hold, peak spotlight
const EMERGE_END = MARKERS.emergeEnd;             // 32.2s — camera arrives at elevated outroPos; outro card fades in
const TOTAL = MARKERS.total;                      // 1146 (38.2s) — 6s outro hold at hero-card angle

// Spatial constants live in scene/primitives/constants.ts and are consumed by
// the camera primitives via the camera context. BUILD_LEAD is imported above
// because the React component still uses it to drive the bar build-in reveal.

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

export function buildKeyframes(
  year: YearData,
  placements: BarPlacement[],
  peak: PeakTargetBars,
  densityCurve: DensitySample[],
  hasContent: boolean,
): CameraKeyframe[] {
  // Thin wrapper: derive the camera context once, then delegate to the
  // primitives composer which stitches the six camera shots into one keyframe
  // track. See scene/primitives/ for the shot grammar.
  const ctx = buildCameraContext(year, placements, peak, densityCurve, hasContent);
  return composeYearCamera(ctx);
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

  // Collapse wave progress: 0→1 over frames COLLAPSE_START→COLLAPSE_END
  // (3.0s→4.5s) — bars retract R→L during the dive, completing BEFORE the
  // camera arrives at F150. Held at 1 from COLLAPSE_END→ENTRY_END, then
  // RELEASES back 1→0 over ENTRY_END→COLLAPSE_RELEASE so the cruise camera's
  // natural L→R reveal can grow them back.
  const collapseProgress = useMemo(() => {
    if (frame <= COLLAPSE_START) return 0;
    if (frame < COLLAPSE_END) {
      return interpolate(frame, [COLLAPSE_START, COLLAPSE_END], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });
    }
    if (frame < ENTRY_END) return 1;
    if (frame < COLLAPSE_RELEASE) {
      return interpolate(frame, [ENTRY_END, COLLAPSE_RELEASE], [1, 0], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });
    }
    return 0;
  }, [frame]);

  // Reveal boost retained as a constant 0 so Skyline's API stays stable.
  // The cruise camera's natural reveal-distance does all the work now —
  // bars grow gradually with their proper colors as camera approaches.
  const revealBoost = 0;

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
  // v27: Uses the camera BODY position (was lookAt) and gates on bar
  // visibility. The camera body is where the build-front sits — bars are
  // revealing in the range [cameraX, cameraX + BUILD_LEAD]. Using lookAt
  // (cameraX + lookAhead during cruise) reported a month ~4 units AHEAD of
  // where bars were actually appearing, so at F150 the indicator said
  // "January week 2" while no bars were on screen yet.
  const currentMonth = useMemo<number | null>(() => {
    if (frame < ENTRY_END || frame > CRUISE_END) return null;
    const geom = gridGeometry(data);
    const sample = sampleRig(frame, keyframes);
    const focusX = sample.position[0];
    // Hide indicator before the leftmost bar can become visible. Bars build
    // in within BUILD_LEAD ahead of the camera, so anything before
    // originX - BUILD_LEAD has zero bars on screen.
    if (focusX < geom.originX - BUILD_LEAD) return null;
    const stride = geom.cellSize + geom.gap;
    const weekIdx = Math.max(0, Math.min(
      data.weeks.length - 1,
      Math.round((focusX - geom.originX) / stride),
    ));
    const wednesdayIdx = weekIdx * 7 + 3;
    const anchor = placements[wednesdayIdx];
    if (!anchor?.date) return null;
    return new Date(anchor.date + "T12:00:00Z").getUTCMonth();
  }, [frame, placements, data, keyframes]);

  const cameraX = useMemo(() => {
    // Cruise phase only: camera-X based reveal so bars build in as camera sweeps.
    // All other phases use sentinel 1e6 (all bars visible).
    if (frame >= ENTRY_END && frame <= CRUISE_END) {
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
          revealBoost={revealBoost}
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

      {/* Global atmosphere — applies the outro's cinematic grammar (sky
          recession + warm low rim + bottom vignette) at reduced intensity
          across the whole video. Sits above the ThreeCanvas so the 3D world
          gets a coherent atmospheric envelope from frame 0, rather than only
          earning it in the final 6s. The outro's heavier overlays still
          stack on top inside ChartOutro so the celebration moment lands
          with extra weight. */}
      <GlobalAtmosphere theme={theme} fadeOutFromFrame={EMERGE_END - 30} />

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

      {/* Outro: hero-card layout — camera is at homePos, text matches intro style. */}
      <ChartOutro
        year={data.year}
        total={data.totalContributions}
        username={username}
        fromFrame={EMERGE_END - 15}
        toFrame={TOTAL}
        theme={theme}
      />

      {/* ChartIntro: atmospheric stack only (no text — user direction). */}
      <ChartIntro theme={theme} />
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
 * Global cinematic atmosphere — same compositional grammar as ChartOutro
 * (sky recession, warm low rim, soft bottom vignette) at reduced intensity,
 * applied across the entire video so every frame feels lit, not unlit-WebGL.
 *
 * Crossfades to zero just before ChartOutro's own heavier atmosphere takes
 * over (around F936) so the two systems don't double-up at the cut.
 *
 * Pure HTML overlay — sits over the ThreeCanvas, beneath the captions. All
 * layers are `pointerEvents: "none"`.
 */
const GlobalAtmosphere: React.FC<{
  theme: SkylineYearProps["theme"];
  fadeOutFromFrame: number;
}> = ({ theme: _theme, fadeOutFromFrame }) => {
  const frame = useCurrentFrame();
  // Fade in over the first 8 frames (after the WebGL warm-up cover) and out
  // over the 30 frames leading into the outro arc — ChartOutro's overlays
  // pick up the duty from there.
  const intro = interpolate(frame, [0, 8], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const outroFade = interpolate(
    frame,
    [fadeOutFromFrame, fadeOutFromFrame + 30],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const masterOpacity = Math.min(intro, outroFade);
  return (
    <AbsoluteFill style={{ pointerEvents: "none", opacity: masterOpacity }}>
      {/* Sky recession — deeper at top, transparent mid, warmer near-black
          at the bottom. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(to bottom, rgba(14,22,38,0.65) 0%, rgba(0,0,0,0) 32%, rgba(0,0,0,0) 64%, rgba(18,14,8,0.55) 100%)",
        }}
      />
      {/* Cool sky tint at top — atmospheric perspective so distant bars
          feel set against a sky, not a void. (v25: warm low rim removed
          from global atmosphere — that dusk-amber tone is celebration
          chrome and belongs only to ChartIntro/ChartOutro brackets, not
          the cool/focused fly-through body.) */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(ellipse 90% 50% at 50% 0%, rgba(40,70,110,0.06) 0%, rgba(40,70,110,0) 60%)",
        }}
      />
      {/* Soft edge vignette — gentle camera framing. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(ellipse 100% 80% at 50% 50%, rgba(0,0,0,0) 50%, rgba(0,0,0,0.42) 100%)",
        }}
      />
    </AbsoluteFill>
  );
};

/**
 * Intro hero card (v25 loop-seam composition — text-free variant).
 *
 * Renders ONLY the atmospheric stack that mirrors ChartOutro:
 * sky recession + warm low rim + bottom vignette + ground lift. The heavy
 * layers fade out F75→F150 to match the descent so the cruise body returns
 * to a cool, focused palette.
 *
 * User direction: the intro carries NO text. The skyline alone (held at
 * outroPos for F0..F75) is the opening shot. The "Your skyline." +
 * attribution moment is reserved for the outro celebration.
 *
 * Camera is parked at outroPos for F0..F75 (in CameraRig), so the geometry
 * is identical to the outro's final pose minus the chrome — a clean
 * cinematic establishing shot of the city.
 */
const ChartIntro: React.FC<{
  theme: SkylineYearProps["theme"];
}> = ({ theme }) => {
  const frame = useCurrentFrame();

  // Heavy atmospheric layers (sky recession, warm low rim, bottom vignette,
  // ground lift) fade out over the descent F75→F150 so they don't fight the
  // cruise mood. After F150 the component is a no-op.
  const heavyAtmosphere = interpolate(
    frame,
    [75, 150],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  if (heavyAtmosphere <= 0) return null;
  // theme reserved for future palette-aware atmosphere; intentionally unused.
  void theme;

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {/* Atmospheric layers — mirror ChartOutro exactly, fade out during the
          descent so the cruise body returns to the cool/focused palette. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(to bottom, rgba(8,10,16,0.55) 0%, rgba(0,0,0,0) 38%, rgba(0,0,0,0) 65%, rgba(10,8,4,0.55) 100%)",
          pointerEvents: "none",
          opacity: heavyAtmosphere,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: "8%",
          right: "8%",
          bottom: "12%",
          height: "22%",
          background:
            "radial-gradient(ellipse at center bottom, rgba(240,136,62,0.10) 0%, rgba(240,136,62,0) 60%)",
          pointerEvents: "none",
          filter: "blur(10px)",
          opacity: heavyAtmosphere,
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(to bottom, rgba(0,0,0,0) 50%, rgba(0,0,0,0.55) 100%)",
          pointerEvents: "none",
          opacity: heavyAtmosphere,
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(ellipse 80% 28% at 42% 78%, rgba(20,30,22,0.55) 0%, rgba(8,12,10,0.30) 45%, rgba(0,0,0,0) 75%)",
          pointerEvents: "none",
          opacity: heavyAtmosphere,
        }}
      />
    </AbsoluteFill>
  );
};

/**
 * Outro overlay modelled after the gh-skyline hero card (Image 3):
 * - Text anchored to the lower third (justifyContent:"flex-end").
 * - Total contributions as the primary hero element in accent green.
 * - "Your skyline." tagline + "Let's build. github/gh-skyline" CTA below.
 * - Left-aligned, matching the reference card's layout.
 * - Invertocat logo before the repo name (theme-aware).
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

  // v18d + atmosphere/stagger (panel additive findings only — no structural
  // changes to copy, camera, or layout). Each element fades in on its own
  // schedule so the viewer reads hero → tagline → CTA in cadence.
  const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
  const fadeIn = (start: number, duration: number) => {
    const t = Math.max(0, Math.min(1, (frame - (fromFrame + start)) / duration));
    return easeOutCubic(t);
  };
  // Hero cluster (attribution + stat) lands first, "Your skyline." follows at
  // +6 frames, CTA cascades at +14 frames. Total entry window ~24 frames (0.8s).
  const heroOpacity = fadeIn(0, 18);
  const titleOpacity = fadeIn(6, 18);
  const ctaOpacity = fadeIn(14, 18);

  // v25c: tail-fade REMOVED — user direction. Stat and CTA persist at full
  // opacity to the very last rendered frame. This trades the seamless loop
  // for a stronger final beat (the celebration shouldn't dim before it ends).
  const tailFadeOut = 1;

  // Master container fade — fast 6-frame cover for late upstream cuts.
  const masterOpacity = interpolate(
    frame,
    [fromFrame, fromFrame + 6, toFrame],
    [0, 1, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  if (masterOpacity <= 0) return null;
  const accentColor = theme === "dark" ? "#39d353" : "#26a641";
  const dimColor = theme === "dark" ? "rgba(255,255,255,0.45)" : "rgba(0,0,0,0.45)";
  // Theme-aware Invertocat: white mark on dark backgrounds, black on light.
  const logoSrc = staticFile(
    theme === "dark" ? "images/github-mark-white.svg" : "images/github-mark.svg",
  );
  return (
    <AbsoluteFill
      style={{
        pointerEvents: "none",
        opacity: masterOpacity,
        fontFamily: `"${MONA_SANS_FONT_FAMILY}", ui-sans-serif, system-ui, sans-serif`,
        color: p.captionText,
        textShadow: `0 2px 24px rgba(0,0,0,0.85), 0 0 14px rgba(0,0,0,0.55)`,
      }}
    >
      {/* Atmospheric vertical gradient — Colorist + DP panel note: the prior
          flat black background read as unlit WebGL. This adds true
          cinematographic recession: deeper blue-black at top tapering to
          near-black mid-frame, then a warmer near-black at the bottom where
          the skyline sits. Purely additive — does not move any layout. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(to bottom, rgba(8,10,16,0.55) 0%, rgba(0,0,0,0) 38%, rgba(0,0,0,0) 65%, rgba(10,8,4,0.55) 100%)",
          pointerEvents: "none",
        }}
      />
      {/* Warm low rim glow — sits behind the skyline base, suggests dusk
          atmosphere meeting the city. Very subtle (~10% opacity). */}
      <div
        style={{
          position: "absolute",
          left: "8%",
          right: "8%",
          bottom: "12%",
          height: "22%",
          background:
            "radial-gradient(ellipse at center bottom, rgba(240,136,62,0.10) 0%, rgba(240,136,62,0) 60%)",
          pointerEvents: "none",
          filter: "blur(10px)",
        }}
      />
      {/* Original bottom vignette — kept so the CTA sinks into the skyline
          base as it did in v18d. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(to bottom, rgba(0,0,0,0) 50%, rgba(0,0,0,0.55) 100%)",
          pointerEvents: "none",
        }}
      />
      {/* Ground-plane lift (v22, per Creative Director trajectory note) —
          subtle green-tinted brightening at the horizon line (~75% from top)
          fading to true #000 at the bottom edge. Gives the CTA a stage to
          sit under rather than floating in flat black. ≤8% luminance lift,
          biased slightly leftward to match the dense-bar mass — reads as
          ambient ground bounce, not a vignette. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(ellipse 80% 28% at 42% 78%, rgba(20,30,22,0.55) 0%, rgba(8,12,10,0.30) 45%, rgba(0,0,0,0) 75%)",
          pointerEvents: "none",
        }}
      />

      {/* Username caption — small lowercase wordmark sitting IMMEDIATELY above
          the hero stat as a tight attribution cluster ("who" → "what they did").
          Sonnet 4.6 note: the username is the emotional hook ("this is mine!")
          and should read alongside the stat, not be orphaned at the top. */}
      <div
        style={{
          position: "absolute",
          top: "10%",
          left: 0,
          right: 0,
          textAlign: "center",
          fontSize: 32,
          fontWeight: 400,
          letterSpacing: "0.14em",
          opacity: 0.38 * heroOpacity,
          textTransform: "lowercase",
        }}
      >
        @{username.replace(/^@/, "")} · {year}
      </div>

      {/* Hero stat — green contributions number sized as a PEER to the
          tagline (both 120-ish). Color carries the hierarchy, not size.
          v23 graphic-designer note: at 168 the literal word "contributions."
          was shouting louder than the number itself; dropping to 122 lets
          the green carry the announce role while green-vs-white does the
          hierarchy work (Bloomberg Businessweek editorial move). */}
      <div
        style={{
          position: "absolute",
          top: "16%",
          left: 0,
          right: 0,
          textAlign: "center",
          fontSize: 122,
          fontWeight: 800,
          lineHeight: 1,
          letterSpacing: "-0.01em",
          color: accentColor,
          opacity: heroOpacity * tailFadeOut,
        }}
      >
        {total.toLocaleString()} contributions.
      </div>

      {/* Emotional title — "Your skyline." positioned so its descenders ('y',
          '.') physically intersect the tallest bar peaks. The figure/ground
          interlock IS the money shot. Modular-scale ratio of ~1.4× from the
          hero stat (168 → 120) creates proper hierarchy: stat announces,
          title resolves. Weight 700 (vs stat's 800) reinforces hierarchy
          without losing authority.

          Subtle white outer glow per cinematographer note — makes the type
          feel lit by the city, not pasted onto it. Pairs with the existing
          dark drop-shadow for legibility over bar overlap. */}
      <div
        style={{
          position: "absolute",
          top: "26%",
          left: 0,
          right: 0,
          textAlign: "center",
          fontSize: 120,
          fontWeight: 700,
          lineHeight: 1,
          letterSpacing: "-0.015em",
          color: p.captionText,
          textShadow:
            "0 0 18px rgba(255,255,255,0.16), 0 2px 28px rgba(0,0,0,0.92), 0 0 14px rgba(0,0,0,0.6)",
          opacity: titleOpacity,
        }}
      >
        Your skyline.
      </div>

      {/* CTA — credit-line treatment sunk into the dark floor BELOW the
          skyline base. Acts as a poster signature. Per GPT-5.5 panel note:
          scaled up slightly so it reads as a confident signature rather
          than apologetic legal copy. */}
      <div
        style={{
          position: "absolute",
          bottom: 96,
          left: 0,
          right: 0,
          textAlign: "center",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 14,
          opacity: ctaOpacity * tailFadeOut,
        }}
      >
        <div
          style={{
            fontSize: 38,
            fontWeight: 600,
            color: p.captionText,
            opacity: 0.82,
            letterSpacing: "0.02em",
          }}
        >
          Let&apos;s build.
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            justifyContent: "center",
          }}
        >
          <img
            src={logoSrc}
            width={28}
            height={28}
            alt="GitHub"
            style={{ opacity: 0.62, display: "block" }}
          />
          <div
            style={{
              fontSize: 26,
              fontWeight: 400,
              color: dimColor,
              opacity: 0.88,
              letterSpacing: "0.05em",
            }}
          >
            github/gh-skyline
          </div>
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
  const { width, height } = useVideoConfig();
  const p = palette(theme);
  const opacity = interpolate(
    frame,
    [visibleFromFrame, visibleFromFrame + 14, visibleToFrame - 14, visibleToFrame],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  if (opacity <= 0) return null;
  // Padding is resolution-relative to look consistent at 4K and 1080p.
  // PowerPoint-style upper-right anchor: 18% from top, 28% from right.
  const padTop = Math.round(height * 0.18);
  const padRight = Math.round(width * 0.28);
  return (
    <AbsoluteFill
      style={{
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "flex-start",
        paddingTop: padTop,
        paddingRight: padRight,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          opacity,
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          gap: 8,
          fontFamily: MONA_SANS_FONT_FAMILY,
          color: p.captionText,
          textAlign: "right",
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
            color: p.captionText,
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
