/**
 * SkylineYear: single-year fly-through composition.
 *
 * Timeline (frames @30fps, total 900 = 30s):
 *   0   – 90  title card
 *   90  – 180 establishing orbit
 *   180 – 720 fly-through along +X with peak-Y lift
 *   720 – 840 three highlight beats (peakDay -> peakWeek -> longestStreak)
 *             — each beat is skipped if its sub-stat is null; if all are null
 *               (or stats == null) the orbit phase extends to 6–28s.
 *   840 – 900 outro with totals
 */
import React, { useMemo } from "react";
import {
  AbsoluteFill,
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

const TITLE_END = 90;
const ORBIT_END = 180;
const FLY_END = 720;
const BEATS_END = 840;
const TOTAL = SKYLINE_YEAR_DURATION_FRAMES;
const BEAT_FRAMES = 40;

function buildKeyframes(
  year: YearData,
  placements: BarPlacement[],
  beats: Beat[],
): CameraKeyframe[] {
  const geom = gridGeometry(year);
  const stride = geom.cellSize + geom.gap;
  const span = (geom.weekCount - 1) * stride;
  const lookCenter: [number, number, number] = [0, 1, 0];

  // 0..90  Title: distant front-3/4 orbit, mid altitude.
  // 90..180 Orbit: rotate around grid centre.
  // 180..720 Fly-through along +X.
  // 720..840 Beat snaps.
  // 840..900 Outro: slow pull-back.
  const k: CameraKeyframe[] = [
    { frame: 0, position: [span * 0.6, 10, span * 0.7], lookAt: lookCenter, fov: 38 },
    { frame: TITLE_END, position: [span * 0.5, 9, span * 0.65], lookAt: lookCenter, fov: 38 },
    { frame: TITLE_END + 30, position: [span * 0.7, 8, 0], lookAt: lookCenter, fov: 36 },
    { frame: ORBIT_END, position: [-span * 0.7, 7, 0], lookAt: lookCenter, fov: 36 },
  ];

  // Fly-through: sample along weeks (~10 keyframes for cheap interp).
  const flyKfCount = 10;
  for (let i = 0; i <= flyKfCount; i++) {
    const t = i / flyKfCount;
    const x = geom.originX + t * span;
    const baseY = 2.4;
    const lift = peakLiftAtX(x, placements);
    const y = baseY + Math.max(0, lift - baseY) * 0.6;
    const frame = ORBIT_END + Math.round(t * (FLY_END - ORBIT_END));
    k.push({
      frame,
      position: [x, y, 5.5],
      lookAt: [x, 0.5, 0],
      fov: 32,
    });
  }

  // Highlight beats: snap to each highlighted bar's location.
  let beatStart = FLY_END;
  for (const beat of beats) {
    const target = beat.bars[0];
    if (!target) continue;
    k.push({
      frame: beatStart + 4,
      position: [target.x + 2.5, Math.max(target.height + 1.5, 2.5), target.z + 4],
      lookAt: [target.x, target.height / 2, target.z],
      fov: 28,
    });
    k.push({
      frame: beatStart + BEAT_FRAMES - 2,
      position: [target.x + 2.5, Math.max(target.height + 1.5, 2.5), target.z + 4],
      lookAt: [target.x, target.height / 2, target.z],
      fov: 28,
    });
    beatStart += BEAT_FRAMES;
  }

  // If no beats, hold an orbit keyframe so we don't jump.
  if (beats.length === 0) {
    k.push({
      frame: BEATS_END,
      position: [span * 0.6, 8, span * 0.5],
      lookAt: lookCenter,
      fov: 34,
    });
  }

  // Outro: pull back.
  k.push({
    frame: TOTAL,
    position: [0, 12, span * 1.1],
    lookAt: lookCenter,
    fov: 42,
  });
  return k;
}

interface Beat {
  kind: "peakDay" | "peakWeek" | "longestStreak";
  bars: BarPlacement[];
  caption: string;
}

function buildBeats(year: YearData, placements: BarPlacement[]): Beat[] {
  const beats: Beat[] = [];
  const s = year.stats;
  if (!s) return beats;
  if (s.peakDay) {
    const bar = placementForDate(placements, s.peakDay.date);
    if (bar) {
      beats.push({
        kind: "peakDay",
        bars: [bar],
        caption: `Peak day · ${s.peakDay.count} contributions · ${s.peakDay.date}`,
      });
    }
  }
  if (s.peakWeek) {
    const bars = placementsForWeekStart(placements, s.peakWeek.startDate);
    if (bars.length > 0) {
      beats.push({
        kind: "peakWeek",
        bars,
        caption: `Peak week · ${s.peakWeek.total} contributions · week of ${s.peakWeek.startDate}`,
      });
    }
  }
  if (s.longestStreak) {
    const start = placementForDate(placements, s.longestStreak.start);
    const end = placementForDate(placements, s.longestStreak.end);
    const bars: BarPlacement[] = [];
    if (start) bars.push(start);
    if (end && end !== start) bars.push(end);
    if (bars.length > 0) {
      beats.push({
        kind: "longestStreak",
        bars,
        caption: `Longest streak · ${s.longestStreak.length} days · ${s.longestStreak.start} → ${s.longestStreak.end}`,
      });
    }
  }
  return beats;
}

export const SkylineYear: React.FC<SkylineYearProps> = ({
  data,
  username,
  theme,
  resolution: _resolution,
}) => {
  const { width, height } = useVideoConfig();
  const placements = useMemo(() => layoutBars(data), [data]);
  const beats = useMemo(() => buildBeats(data, placements), [data, placements]);
  const keyframes = useMemo(
    () => buildKeyframes(data, placements, beats),
    [data, placements, beats],
  );
  const p = palette(theme);

  return (
    <AbsoluteFill style={{ backgroundColor: p.background }}>
      <ThreeCanvas
        width={width}
        height={height}
        gl={{ antialias: true }}
        style={{ backgroundColor: p.background }}
      >
        <Lighting theme={theme} />
        <CameraRig keyframes={keyframes} />
        <Skyline year={data} theme={theme} />
        {beats.map((beat, i) => {
          const beatStart = FLY_END + i * BEAT_FRAMES;
          return (
            <BeatOverlay
              key={beat.kind}
              bars={beat.bars}
              startFrame={beatStart}
              theme={theme}
            />
          );
        })}
      </ThreeCanvas>

      {/* Title card */}
      <Captions
        theme={theme}
        visibleFromFrame={0}
        visibleToFrame={TITLE_END}
        placement="center"
      >
        <div style={{ fontSize: 88, fontWeight: 700 }}>{username}</div>
        <div style={{ fontSize: 60, marginTop: 16, opacity: 0.85 }}>
          {data.year} · {data.totalContributions.toLocaleString()} contributions
        </div>
      </Captions>

      {/* Beat captions */}
      {beats.map((beat, i) => {
        const beatStart = FLY_END + i * BEAT_FRAMES;
        return (
          <Captions
            key={`cap-${beat.kind}`}
            theme={theme}
            visibleFromFrame={beatStart}
            visibleToFrame={beatStart + BEAT_FRAMES}
            placement="bottom"
            fadeFrames={8}
          >
            {beat.caption}
          </Captions>
        );
      })}

      {/* Outro */}
      <Captions
        theme={theme}
        visibleFromFrame={BEATS_END}
        visibleToFrame={TOTAL}
        placement="center"
      >
        <div style={{ fontSize: 72, fontWeight: 700 }}>
          {data.totalContributions.toLocaleString()} contributions
        </div>
        <div style={{ fontSize: 44, marginTop: 12, opacity: 0.8 }}>
          {username} · {data.year}
        </div>
      </Captions>
    </AbsoluteFill>
  );
};

// Frame-windowed HighlightMoment so the overlay only exists during its beat.
import { Sequence } from "remotion";
const BeatOverlay: React.FC<{
  bars: BarPlacement[];
  startFrame: number;
  theme: SkylineYearProps["theme"];
}> = ({ bars, startFrame, theme }) => {
  return (
    <Sequence from={startFrame} durationInFrames={BEAT_FRAMES} layout="none">
      <HighlightMoment bars={bars} durationFrames={BEAT_FRAMES} theme={theme} />
    </Sequence>
  );
};
