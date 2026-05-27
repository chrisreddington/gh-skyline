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
export const SKYLINE_YEAR_DURATION_FRAMES = 1056; // 35.2s @30fps (3s outro hold)

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
// v13 phase changes:
//  - COLLAPSE_START=45: collapse wave starts at 1.5s, overlapping the dive,
//    so bars are fully retracted by the time the camera hits street level (5s).
//  - ENTRY_END=150: dive complete + collapse complete; cruise begins immediately.
//  - CRUISE_END=450: 300-frame cruise (same as before, now starts at 150).
//  - FLYBY_END=630: orbit extended to 180 frames (6s) — celebrates the year.
//  - EMERGE_END=870: camera arrives at homePos here so outro shows hero angle.
const COLLAPSE_START = 45;    // 1.5s — R→L collapse wave begins during overview
const TITLE_END = 90;         // 3s — hero-card overview + title card
const ENTRY_END = 150;        // 5s — dive + collapse complete; cruise begins
const COLLAPSE_RELEASE = 190; // 6.33s — collapse fully released; bars now grow via cruise reveal
const CRUISE_END = 450;       // 15s — density-weighted cruise (bars build in)
const FLYBY_END = 690;        // 23s — full 360° helicopter orbit (8s, leisurely)
const APPROACH_END = 750;     // 25s — approach to peak, focus effect
const CANYON_END = 906;       // 30.2s — canyon hold, peak spotlight
const EMERGE_END = 966;       // 32.2s — camera arrives at elevated outroPos; outro card fades in
const TOTAL = SKYLINE_YEAR_DURATION_FRAMES; // 1056 (35.2s) — 3s outro hold at hero-card angle

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
    ? Math.min(geom.originX + span, lastActiveX)
    : geom.originX + span;
  const cruiseSpan = cruiseEndX - geom.originX;

  // Hero-card "home" position: three-quarter isometric view for title card.
  const homePos: [number, number, number] = [midActiveX + 14, 10, 20];
  const homeLook: [number, number, number] = [midActiveX - 2, 1.8, 0];
  const homeFov = 38;

  // Outro position: v22 — trajectory panel iteration (CD + DP + Type
  // consensus). Lower the bars in frame so the skyline sits BETWEEN the
  // type cluster and the CTA with breathing room, rather than crowding
  // the tagline.
  //
  // pos Y=20 unchanged (depth gain from v21 is real — keep it).
  // lookAt Y 3 → 6: raises the camera's aim point, dropping the bars in
  // frame. Depression 16.6° → 13.8°. Still firmly in the "city, not chart"
  // zone (DP's 10-22° guideline; v18d was 10.9° and read cinematic).
  //
  // Bar peaks now sit at ~48% from top (was 41%), base ~76% (was 72%).
  // The hero moment regains its negative-space stage.
  const outroPos: [number, number, number] = [midActiveX, 20, 57];
  const outroLook: [number, number, number] = [midActiveX, 6, 0];
  const outroFov = 30;

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
  // Camera starts far enough left (originX - BUILD_LEAD - 2) so that at
  // ENTRY_END all bars are still AHEAD of the camera (revealMul=0 for all),
  // preventing a jarring "pre-revealed" pop when cruise begins.
  k.push({
    frame: ENTRY_END,
    position: [geom.originX - BUILD_LEAD - 2, 4.5, Z_FLOOR + 2.5],
    lookAt: [geom.originX + 2, 1.8, 0],
    fov: 42,
  });

  // ---- 150..450 Cruise (bars rebuild L→R) -----
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
    // Ramp look-ahead from 4 → 0 in the final 20% of cruise so the camera
    // doesn't look beyond the last bar (fixes the December-overshoot feel).
    const endRamp = Math.max(0, (u - 0.8) / 0.2);
    const lookAhead = 4 * (1 - endRamp);
    const frame = ENTRY_END + Math.round(u * (CRUISE_END - ENTRY_END));
    k.push({ frame, position: [x, y, z], lookAt: [x + lookAhead, lookY, 0], fov });
  }

  // ---- 450..690 Full 360° helicopter orbit (8s, leisurely) -----
  // Elliptical orbit tightened to RX=42/RZ=30 (was 55/26) so the distance from
  // the skyline stays more uniform across the orbit — eliminates the
  // "zoomed-too-far-out" feel at the X-axis extremes. Height 9 = just above
  // average bar tops, well below peak columns.
  //
  // lookAt: instead of a fixed center-pivot (which makes the skyline foreshorten
  // to a thin line at the side), the camera tracks the nearest active part of the
  // skyline — like a helicopter passenger looking out the window as the city
  // slides past, with a 35% bias toward the peak column.
  const orbitRX = 42;
  const orbitRZ = 30;
  const orbitH = 9;
  const peakX = hasContent ? peak.centerX : midActiveX;
  const orbitFrames = FLYBY_END - CRUISE_END; // 180 frames = 6s
  for (let seg = 1; seg <= 8; seg++) {
    const theta = (seg / 8) * Math.PI * 2;
    const orbitFrame = CRUISE_END + Math.round((seg / 8) * orbitFrames);
    const camX = midActiveX + orbitRX * Math.sin(theta);
    const camZ = orbitRZ * Math.cos(theta);
    // Clamp lookAt X to stay within the active skyline span so the camera
    // never looks "past" the ends; bias 35% toward peak for a natural focal draw.
    const nearX = Math.min(Math.max(camX, midActiveX - 35), midActiveX + 35);
    const lookX = nearX + 0.35 * (peakX - nearX);
    k.push({
      frame: orbitFrame,
      position: [camX, orbitH, camZ],
      lookAt: [lookX, 3.0, 5.5],
      fov: 48,
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
    // Gentle drift at canyon hold end so camera already has upward velocity
    // when the emerge arc begins — prevents the dead-stop lurch at CANYON_END.
    k.push({
      frame: CANYON_END - 20,  // 886 — canyon hold peak
      position: [px + 2.5, peakY + 1.0, Z_FLOOR + 3.8],
      lookAt: [px + 1.5, peakY * 0.5, 0],
      fov: 30,
    });
    k.push({
      frame: CANYON_END,       // 906 — gentle lift already underway
      position: [px + 2.5, peakY + 3.5, Z_FLOOR + 5.5],
      lookAt: [px + 1.5, peakY * 0.55 + 0.8, 0.5],
      fov: 32,
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

  // ---- Emerge: single arc keyframe then outro hold -----
  // Smooth midpoint between canyon exit and v22 outroPos [midX, 20, 57]/[6, 0].
  k.push({
    frame: CANYON_END + 30,  // 936 — arc midpoint
    position: [midActiveX - 1, 16, 48],
    lookAt: [midActiveX, 4.5, -1],
    fov: 34,
  });

  // ---- EMERGE_END..TOTAL Outro holds at hero-card-style elevated position -----
  // Only ONE final keyframe at EMERGE_END=966. The composition runs to TOTAL
  // (frame 1056) but no further keyframe is added: sampleRig clamps to the
  // last keyframe's position/lookAt/fov for all frames >= last.frame, giving
  // a rock-solid static hold from F966 → F1056 (3s). Adding a duplicate
  // keyframe at TOTAL previously caused subtle drift because Catmull-Rom
  // computed a non-zero tangent at F966 from the arc keyframe → next-segment
  // velocity, pulling the camera slightly off outroPos mid-segment.
  k.push({
    frame: EMERGE_END,  // 966
    position: outroPos,
    lookAt: outroLook,
    fov: outroFov,
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

  // Collapse wave progress: 0→1 over frames COLLAPSE_START→ENTRY_END (1.5s→5s)
  // — bars retract R→L during the dive. Then RELEASES back 1→0 over
  // ENTRY_END→COLLAPSE_RELEASE (5s→6.33s) so bars can grow back via the cruise
  // camera's natural L→R reveal. No "revealBoost" is used; the cruise camera
  // alone drives the per-bar growth, so bars grow with their proper colors
  // from 0 height (no "grow in dark" phase, no full-height pop + snap-back).
  const collapseProgress = useMemo(() => {
    if (frame <= COLLAPSE_START) return 0;
    if (frame < ENTRY_END) {
      return interpolate(frame, [COLLAPSE_START, ENTRY_END], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });
    }
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
  const currentMonth = useMemo<number | null>(() => {
    if (frame < ENTRY_END || frame > CRUISE_END) return null;
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

      {/* Title card — overlays the live build. */}
      <Captions
        theme={theme}
        visibleFromFrame={0}
        visibleToFrame={TITLE_END - 5}
        placement="center"
        fadeFrames={18}
      >
        <div style={{ fontSize: 88, fontWeight: 700, textShadow: "0 2px 24px rgba(0,0,0,0.85), 0 0 8px rgba(0,0,0,0.6)" }}>{username}</div>
        <div style={{ fontSize: 60, marginTop: 16, opacity: 0.85, textShadow: "0 2px 16px rgba(0,0,0,0.8)" }}>
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

      {/* Outro: hero-card layout — camera is at homePos, text matches intro style. */}
      <ChartOutro
        year={data.year}
        total={data.totalContributions}
        username={username}
        fromFrame={EMERGE_END - 15}
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
          opacity: 0.42 * heroOpacity,
          textTransform: "lowercase",
        }}
      >
        @{username.replace(/^@/, "")} · {year}
      </div>

      {/* Hero stat — big green contributions number sitting in the sky.
          Heavy weight, tight tracking, no shadow chrome. */}
      <div
        style={{
          position: "absolute",
          top: "14%",
          left: 0,
          right: 0,
          textAlign: "center",
          fontSize: 168,
          fontWeight: 800,
          lineHeight: 1,
          letterSpacing: "-0.01em",
          color: accentColor,
          opacity: heroOpacity,
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
          top: "38%",
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
          bottom: 120,
          left: 0,
          right: 0,
          textAlign: "center",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 14,
          opacity: ctaOpacity,
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
