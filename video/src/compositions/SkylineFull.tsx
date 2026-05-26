/**
 * SkylineFull: continuous fly-through of a developer's entire history.
 *
 * Unlike v2 (which cross-faded year meshes at origin), v3 lays every year
 * side-by-side in world space along +X. The camera physically flies along
 * the X axis across the entire history — there is one continuous flight from
 * year-zero to the present. Each year gets its own micro-arc within the
 * flight: descend, canyon-pass through that year's peak week, rise, continue
 * forward into the next year.
 *
 * Final outro pulls the camera way back along Z and dolly-out so the entire
 * history reads as a panoramic chart silhouette — a 15-year cardiogram.
 *
 * Adaptive year allocation: per-year segment frames are weighted by
 * sqrt(totalContributions). Quiet years still get at least 3s; mega-years
 * are capped at 18s so a single climax year can't dominate.
 *
 * Story for any developer:
 *   - Always-active dev: weights are all similar → uniform pacing, all years
 *     get strong representation.
 *   - Bursty dev: weights cluster around mega-years → quiet stretches whip
 *     past, big years get linger.
 *   - New dev (1-2 years): falls through to SkylineYear logic at the
 *     composition picker; SkylineFull still works for ≥ 2 years.
 *   - Quiet years: still rendered, get min duration, captioned honestly.
 */
import React, { useMemo } from "react";
import * as THREE from "three";
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
  type CalculateMetadataFunction,
} from "remotion";
import { ThreeCanvas } from "@remotion/three";
import { z } from "zod";

import {
  documentSchema,
  themeSchema,
  resolutionSchema,
  type SkylineDocument,
  type YearData,
} from "../schema";
import { palette } from "../scene/theme";
import { Skyline } from "../scene/Skyline";
import { Lighting } from "../scene/Lighting";
import { Captions } from "../scene/Captions";
import {
  CameraRig,
  sampleRig,
  peakLiftAtX,
  type CameraKeyframe,
} from "../scene/CameraRig";
import {
  layoutBars,
  placementsForWeekStart,
  placementForDate,
  gridGeometry,
} from "../utils/grid";
import { allocate, DEFAULT_TIMING, type Allocation } from "../utils/timing";

export const skylineFullPropsSchema = z.object({
  data: documentSchema,
  theme: themeSchema.default("dark"),
  resolution: resolutionSchema.default("4k"),
  maxDurationSeconds: z.number().positive().default(180),
});

export type SkylineFullProps = z.infer<typeof skylineFullPropsSchema>;

export const SKYLINE_FULL_FPS = 30;

const Z_FLOOR = 4.2;
const YEAR_GAP_UNITS = 8; // gap between adjacent years along X
const BUILD_LEAD = 9;

/**
 * Compute the world-X offset for each year in the document. Year 0 is anchored
 * so that the *first* week of year 0 sits at world X=0, growing positive.
 */
function yearOffsets(doc: SkylineDocument): number[] {
  const offsets: number[] = [];
  let cursor = 0;
  for (const year of doc.years) {
    const geom = gridGeometry(year);
    const stride = geom.cellSize + geom.gap;
    const yearWidth = (geom.weekCount - 1) * stride;
    // Year's local X spans [originX, originX + yearWidth]. originX is negative
    // (centred), so the year's left edge sits at originX. To place its left
    // edge at world X=cursor we offset by (cursor - originX).
    const offset = cursor - geom.originX;
    offsets.push(offset);
    cursor += yearWidth + YEAR_GAP_UNITS;
  }
  return offsets;
}

/** sqrt-scaled weights: keeps quiet years visible while still favouring busy ones. */
function computeWeights(doc: SkylineDocument): number[] {
  return doc.years.map((y) => Math.sqrt(y.totalContributions + 1));
}

interface YearCameraConfig {
  yearIdx: number;
  worldOffset: number;
  startFrame: number;
  segmentFrames: number;
  /** Local X (relative to year) of the canyon target, or 0 if none. */
  canyonLocalX: number;
  /** Whether this year has a real peak worth diving for. */
  hasCanyon: boolean;
  /** Peak Y lift at the canyon target (for camera height). */
  peakY: number;
  /** Year width in world units. */
  width: number;
}

function buildYearConfigs(
  doc: SkylineDocument,
  alloc: Allocation,
  offsets: number[],
): YearCameraConfig[] {
  return alloc.perYear.map((seg) => {
    const year = doc.years[seg.index];
    const placements = layoutBars(year);
    const geom = gridGeometry(year);
    const stride = geom.cellSize + geom.gap;
    const width = (geom.weekCount - 1) * stride;
    let canyonLocalX = 0;
    let hasCanyon = false;
    let peakY = 2.4;
    const s = year.stats;
    if (year.totalContributions > 0 && s) {
      if (s.peakWeek) {
        const bars = placementsForWeekStart(placements, s.peakWeek.startDate);
        if (bars.length > 0) {
          canyonLocalX = bars[0].x;
          hasCanyon = true;
        }
      } else if (s.peakDay) {
        const bar = placementForDate(placements, s.peakDay.date);
        if (bar) {
          canyonLocalX = bar.x;
          hasCanyon = true;
        }
      }
      if (hasCanyon) {
        const lift = peakLiftAtX(canyonLocalX, placements);
        peakY = Math.max(2.4, Math.min(lift * 0.55 + 1.0, 5.5));
      }
    }
    return {
      yearIdx: seg.index,
      worldOffset: offsets[seg.index],
      startFrame: seg.startFrame,
      segmentFrames: seg.segmentFrames,
      canyonLocalX,
      hasCanyon,
      peakY,
      width,
    };
  });
}

/**
 * Build the continuous camera path through all years + intro/outro.
 *
 * Intro: overhead shot looking down the X axis, the whole history visible
 *        in soft focus, slow descent to year-0 canopy.
 * Per-year: enter from west (low X) at canopy, drop into year, dive into
 *           that year's peak week (if it has one), rise out the east side,
 *           continue smoothly forward.
 * Outro: hard pull back to side-profile pose framing the entire history as
 *        a panoramic chart.
 */
function buildAllKeyframes(
  doc: SkylineDocument,
  alloc: Allocation,
  configs: YearCameraConfig[],
): CameraKeyframe[] {
  const k: CameraKeyframe[] = [];
  const last = configs[configs.length - 1];
  const first = configs[0];
  const firstCenter = first.worldOffset + first.width / 2;

  // -------------------- Intro -----------------------------------------------
  // Open over year 0 — where the "first brick" was laid. This grounds the
  // opening in the user's start, not an abstract panorama.
  k.push({
    frame: 0,
    position: [firstCenter, 24, 18],
    lookAt: [firstCenter, 0, 0],
    fov: 38,
  });
  // Descend toward year-0's entry pose by intro's end.
  k.push({
    frame: alloc.introFrames,
    position: [first.worldOffset - 6, 8, 11],
    lookAt: [first.worldOffset + 4, 1.5, 0],
    fov: 38,
  });

  // -------------------- Per-year arcs ---------------------------------------
  for (const cfg of configs) {
    const year = doc.years[cfg.yearIdx];
    const yearWorldX = (lx: number) => cfg.worldOffset + lx;
    const segEnd = cfg.startFrame + cfg.segmentFrames;
    // Approach the year — first third of segment.
    k.push({
      frame: cfg.startFrame + Math.floor(cfg.segmentFrames * 0.05),
      position: [yearWorldX(-1.5), 4.5, Z_FLOOR + 2.5],
      lookAt: [yearWorldX(4), 1.8, 0],
      fov: 36,
    });
    if (cfg.hasCanyon && year.totalContributions > 0) {
      // Canyon entry — into the peak week of THIS year.
      k.push({
        frame: cfg.startFrame + Math.floor(cfg.segmentFrames * 0.45),
        position: [
          yearWorldX(cfg.canyonLocalX - 3),
          cfg.peakY + 0.5,
          Z_FLOOR + 0.4,
        ],
        lookAt: [yearWorldX(cfg.canyonLocalX), cfg.peakY * 0.55, 0],
        fov: 26,
      });
      // Canyon hold — small dwell at peak, scaled by segment length.
      const holdLen = Math.max(4, Math.floor(cfg.segmentFrames * 0.18));
      const holdStart = cfg.startFrame + Math.floor(cfg.segmentFrames * 0.55);
      k.push({
        frame: holdStart,
        position: [
          yearWorldX(cfg.canyonLocalX - 0.5),
          cfg.peakY + 0.3,
          Z_FLOOR + 0.2,
        ],
        lookAt: [yearWorldX(cfg.canyonLocalX + 1), cfg.peakY * 0.55, 0],
        fov: 24,
      });
      k.push({
        frame: holdStart + holdLen,
        position: [
          yearWorldX(cfg.canyonLocalX + 1),
          cfg.peakY + 0.3,
          Z_FLOOR + 0.2,
        ],
        lookAt: [yearWorldX(cfg.canyonLocalX + 2.5), cfg.peakY * 0.55, 0],
        fov: 24,
      });
    } else {
      // Quiet year: glide over without canyon.
      k.push({
        frame: cfg.startFrame + Math.floor(cfg.segmentFrames * 0.5),
        position: [yearWorldX(cfg.width * 0.4), 6, 10],
        lookAt: [yearWorldX(cfg.width * 0.5), 1.2, 0],
        fov: 38,
      });
    }
    // Exit — rise and continue forward to set up next year.
    k.push({
      frame: segEnd,
      position: [yearWorldX(cfg.width + 1), 6, Z_FLOOR + 3],
      lookAt: [yearWorldX(cfg.width + 5), 1.5, 0],
      fov: 34,
    });
  }

  // -------------------- Outro (panoramic side-profile pan) -----------------
  const outroStart = alloc.totalFrames - alloc.outroFrames;
  const lastCenter = last.worldOffset + last.width / 2;
  const panDistance = lastCenter - firstCenter;
  // First a fast pull-back from the last year's exit pose to side-profile.
  k.push({
    frame: outroStart,
    position: [lastCenter, 9, 18],
    lookAt: [lastCenter, 2.5, 0],
    fov: 32,
  });
  // Then dolly LEFT across the entire history, ending framed on year 0.
  // Reverse-chronological reveal: we end where it started, the "first brick".
  k.push({
    frame: outroStart + Math.floor(alloc.outroFrames * 0.6),
    position: [firstCenter + panDistance * 0.5, 7, 16],
    lookAt: [firstCenter + panDistance * 0.5, 2.5, 0],
    fov: 30,
  });
  k.push({
    frame: alloc.totalFrames,
    position: [firstCenter, 6, 14],
    lookAt: [firstCenter, 2.5, 0],
    fov: 28,
  });

  k.sort((a, b) => a.frame - b.frame);
  return k;
}

export const calculateSkylineFullMetadata: CalculateMetadataFunction<
  SkylineFullProps
> = async ({ props }) => {
  const dims = props.resolution === "1080p"
    ? { width: 1920, height: 1080 }
    : { width: 3840, height: 2160 };
  const yearCount = props.data.years.length;
  if (yearCount === 0) {
    throw new Error("SkylineFull: data.years is empty");
  }
  const weights = computeWeights(props.data);
  const alloc = allocate(
    yearCount,
    props.maxDurationSeconds,
    DEFAULT_TIMING,
    weights,
  );
  return {
    ...dims,
    fps: SKYLINE_FULL_FPS,
    durationInFrames: alloc.totalFrames,
    props,
  };
};

export const SkylineFull: React.FC<SkylineFullProps> = ({
  data,
  theme,
  resolution: _resolution,
  maxDurationSeconds,
}) => {
  const { width, height } = useVideoConfig();
  const frame = useCurrentFrame();
  const weights = useMemo(() => computeWeights(data), [data]);
  const alloc = useMemo(
    () => allocate(data.years.length, maxDurationSeconds, DEFAULT_TIMING, weights),
    [data.years.length, maxDurationSeconds, weights],
  );
  const offsets = useMemo(() => yearOffsets(data), [data]);
  const configs = useMemo(
    () => buildYearConfigs(data, alloc, offsets),
    [data, alloc, offsets],
  );
  const keyframes = useMemo(
    () => buildAllKeyframes(data, alloc, configs),
    [data, alloc, configs],
  );
  const p = palette(theme);
  const cameraX = useMemo(
    () => sampleRig(frame, keyframes).position[0],
    [frame, keyframes],
  );
  const totalContrib = useMemo(
    () => data.years.reduce((s, y) => s + y.totalContributions, 0),
    [data.years],
  );
  const yearRange = useMemo(() => {
    const ys = data.years.map((y) => y.year);
    const min = Math.min(...ys);
    const max = Math.max(...ys);
    return min === max ? String(min) : `${min} → ${max}`;
  }, [data.years]);
  const firstContribDate = useMemo(() => {
    for (const y of data.years) {
      if (y.stats?.firstContribution) return y.stats.firstContribution.date;
    }
    return null;
  }, [data.years]);
  const biggestYear = useMemo(() => {
    let best: YearData | null = null;
    for (const y of data.years) {
      if (!best || y.totalContributions > best.totalContributions) best = y;
    }
    return best;
  }, [data.years]);

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
        {/* Lighter fog so distant years still read in the panoramic shots. */}
        <fogExp2 attach="fog" args={[p.background, 0.008]} />
        <Lighting theme={theme} />
        <CameraRig keyframes={keyframes} />
        {data.years.map((year, idx) => (
          <group key={`year-${idx}`} position={[offsets[idx], 0, 0]}>
            <Skyline
              year={year}
              theme={theme}
              cameraX={cameraX - offsets[idx]}
              buildLeadDistance={BUILD_LEAD}
              showLabel={false}
            />
          </group>
        ))}
      </ThreeCanvas>

      {/* Intro card. */}
      <Captions
        theme={theme}
        visibleFromFrame={0}
        visibleToFrame={alloc.introFrames - 5}
        placement="center"
        fadeFrames={18}
      >
        <div style={{ fontSize: 88, fontWeight: 700 }}>{data.username}</div>
        <div style={{ fontSize: 56, marginTop: 16, opacity: 0.9 }}>
          {yearRange}
        </div>
        <div style={{ fontSize: 44, marginTop: 8, opacity: 0.8 }}>
          {totalContrib.toLocaleString()} contributions
        </div>
      </Captions>

      {/* Per-year label — appears briefly at each year's start. */}
      <PerYearLabel alloc={alloc} doc={data} theme={theme} />

      {/* Outro panoramic chart card. */}
      <PanoramicOutro
        fromFrame={alloc.totalFrames - alloc.outroFrames + 20}
        toFrame={alloc.totalFrames}
        username={data.username}
        yearRange={yearRange}
        total={totalContrib}
        firstContribDate={firstContribDate}
        biggestYear={biggestYear}
        theme={theme}
      />
    </AbsoluteFill>
  );
};

const PerYearLabel: React.FC<{
  alloc: Allocation;
  doc: SkylineDocument;
  theme: SkylineFullProps["theme"];
}> = ({ alloc, doc, theme }) => {
  const frame = useCurrentFrame();
  const p = palette(theme);
  // Identify which year is currently active.
  let active: { year: YearData; seg: typeof alloc.perYear[number] } | null = null;
  for (const seg of alloc.perYear) {
    const end = seg.startFrame + seg.segmentFrames;
    if (frame >= seg.startFrame && frame < end) {
      active = { year: doc.years[seg.index], seg };
      break;
    }
  }
  if (!active) return null;
  const { year, seg } = active;
  // Show label for the first 25% of each segment.
  const labelEnd = seg.startFrame + Math.floor(seg.segmentFrames * 0.35);
  const opacity = interpolate(
    frame,
    [seg.startFrame, seg.startFrame + 8, labelEnd - 15, labelEnd],
    [0, 0.85, 0.85, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  if (opacity <= 0) return null;
  return (
    <AbsoluteFill
      style={{
        justifyContent: "flex-start",
        alignItems: "flex-start",
        padding: 80,
        paddingTop: 100,
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
        }}
      >
        <div style={{ fontSize: 120, fontWeight: 700, lineHeight: 1 }}>
          {year.year}
        </div>
        <div style={{ fontSize: 38, marginTop: 8, opacity: 0.85 }}>
          {year.totalContributions.toLocaleString()} contribution
          {year.totalContributions === 1 ? "" : "s"}
        </div>
      </div>
    </AbsoluteFill>
  );
};

const PanoramicOutro: React.FC<{
  fromFrame: number;
  toFrame: number;
  username: string;
  yearRange: string;
  total: number;
  firstContribDate: string | null;
  biggestYear: YearData | null;
  theme: SkylineFullProps["theme"];
}> = ({
  fromFrame,
  toFrame,
  username,
  yearRange,
  total,
  firstContribDate,
  biggestYear,
  theme,
}) => {
  const frame = useCurrentFrame();
  const p = palette(theme);
  const opacity = interpolate(
    frame,
    [fromFrame, fromFrame + 25, toFrame - 5, toFrame],
    [0, 1, 1, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  if (opacity <= 0) return null;
  return (
    <AbsoluteFill
      style={{
        justifyContent: "flex-start",
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
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
          textAlign: "center",
        }}
      >
        <div
          style={{
            fontSize: 28,
            opacity: 0.7,
            letterSpacing: 4,
            textTransform: "uppercase",
          }}
        >
          {username}
        </div>
        <div style={{ fontSize: 88, fontWeight: 700, marginTop: 8 }}>
          {yearRange}
        </div>
        <div style={{ fontSize: 52, marginTop: 8, opacity: 0.9 }}>
          {total.toLocaleString()} contributions
        </div>
        <div
          style={{
            display: "flex",
            gap: 40,
            marginTop: 28,
            fontSize: 28,
            opacity: 0.8,
            justifyContent: "center",
          }}
        >
          {firstContribDate && (
            <div>
              <div style={{ opacity: 0.6, fontSize: 20 }}>FIRST BRICK</div>
              <div>{firstContribDate}</div>
            </div>
          )}
          {biggestYear && (
            <div>
              <div style={{ opacity: 0.6, fontSize: 20 }}>BIGGEST SKYLINE</div>
              <div>
                {biggestYear.year} ·{" "}
                {biggestYear.totalContributions.toLocaleString()}
              </div>
            </div>
          )}
        </div>
      </div>
    </AbsoluteFill>
  );
};
