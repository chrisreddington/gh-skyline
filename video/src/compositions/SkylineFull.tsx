/**
 * SkylineFull: multi-year fly-through with cross-fade transitions.
 *
 * Timing: a frame-integer allocator (`utils/timing.ts`) divides the cap into
 * intro / per-year / transition / outro blocks. During a transition window
 * both the outgoing and incoming year meshes are mounted (cross-faded);
 * outside transitions only the active year's mesh is rendered.
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
} from "../schema";
import { palette } from "../scene/theme";
import { Skyline } from "../scene/Skyline";
import { Lighting } from "../scene/Lighting";
import { Captions } from "../scene/Captions";
import {
  CameraRig,
  peakLiftAtX,
  type CameraKeyframe,
} from "../scene/CameraRig";
import { layoutBars, gridGeometry } from "../utils/grid";
import { allocate, DEFAULT_TIMING, type Allocation } from "../utils/timing";

export const skylineFullPropsSchema = z.object({
  data: documentSchema,
  theme: themeSchema.default("dark"),
  resolution: resolutionSchema.default("4k"),
  maxDurationSeconds: z.number().positive().default(180),
});

export type SkylineFullProps = z.infer<typeof skylineFullPropsSchema>;

export const SKYLINE_FULL_FPS = 30;

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
  const alloc = allocate(yearCount, props.maxDurationSeconds);
  return {
    ...dims,
    fps: SKYLINE_FULL_FPS,
    durationInFrames: alloc.totalFrames,
    props,
  };
};

function buildKeyframesForYear(
  doc: SkylineDocument,
  yearIdx: number,
  startFrame: number,
  segmentFrames: number,
): CameraKeyframe[] {
  const year = doc.years[yearIdx];
  const placements = layoutBars(year);
  const geom = gridGeometry(year);
  const stride = geom.cellSize + geom.gap;
  const span = (geom.weekCount - 1) * stride;
  const lookCenter: [number, number, number] = [0, 1, 0];

  const orbitFrames = Math.min(45, Math.floor(segmentFrames * 0.2));
  const flyFrames = segmentFrames - orbitFrames;
  const k: CameraKeyframe[] = [
    {
      frame: startFrame,
      position: [span * 0.7, 8, span * 0.6],
      lookAt: lookCenter,
      fov: 36,
    },
    {
      frame: startFrame + orbitFrames,
      position: [-span * 0.7, 7, 0],
      lookAt: lookCenter,
      fov: 34,
    },
  ];
  const samples = 8;
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const x = geom.originX + t * span;
    const lift = peakLiftAtX(x, placements);
    const y = 2.4 + Math.max(0, lift - 2.4) * 0.55;
    k.push({
      frame: startFrame + orbitFrames + Math.round(t * flyFrames),
      position: [x, y, 5.5],
      lookAt: [x, 0.5, 0],
      fov: 32,
    });
  }
  return k;
}

function buildAllKeyframes(
  doc: SkylineDocument,
  alloc: Allocation,
): CameraKeyframe[] {
  const all: CameraKeyframe[] = [];
  // Intro keyframe.
  all.push({ frame: 0, position: [0, 14, 16], lookAt: [0, 1, 0], fov: 42 });
  all.push({
    frame: alloc.introFrames,
    position: [10, 8, 10],
    lookAt: [0, 1, 0],
    fov: 38,
  });
  for (const seg of alloc.perYear) {
    all.push(
      ...buildKeyframesForYear(doc, seg.index, seg.startFrame, seg.segmentFrames),
    );
    // Transition keyframe: pull back so cross-fade reads as a "fly between".
    if (seg.transitionFrames > 0) {
      all.push({
        frame: seg.startFrame + seg.segmentFrames,
        position: [0, 11, 14],
        lookAt: [0, 1, 0],
        fov: 40,
      });
      all.push({
        frame: seg.startFrame + seg.segmentFrames + seg.transitionFrames,
        position: [0, 11, 14],
        lookAt: [0, 1, 0],
        fov: 40,
      });
    }
  }
  // Outro pull-back.
  all.push({
    frame: alloc.totalFrames,
    position: [0, 14, 18],
    lookAt: [0, 1, 0],
    fov: 44,
  });
  return all;
}

/**
 * Decide which year(s) to render at the given absolute frame. During a
 * transition window both meshes are mounted; the outgoing fades 1→0 and the
 * incoming fades 0→1.
 */
interface ActiveYear {
  yearIndex: number;
  opacity: number;
}

function activeYearsAt(frame: number, alloc: Allocation): ActiveYear[] {
  if (frame < alloc.introFrames) {
    return [{ yearIndex: 0, opacity: 1 }];
  }
  const outroStart = alloc.totalFrames - alloc.outroFrames;
  if (frame >= outroStart) {
    return [{ yearIndex: alloc.perYear.length - 1, opacity: 1 }];
  }
  for (let i = 0; i < alloc.perYear.length; i++) {
    const seg = alloc.perYear[i];
    const segEnd = seg.startFrame + seg.segmentFrames;
    if (frame >= seg.startFrame && frame < segEnd) {
      return [{ yearIndex: seg.index, opacity: 1 }];
    }
    const transEnd = segEnd + seg.transitionFrames;
    if (
      seg.transitionFrames > 0 &&
      frame >= segEnd &&
      frame < transEnd &&
      i + 1 < alloc.perYear.length
    ) {
      const t = (frame - segEnd) / seg.transitionFrames;
      return [
        { yearIndex: seg.index, opacity: 1 - t },
        { yearIndex: alloc.perYear[i + 1].index, opacity: t },
      ];
    }
  }
  return [{ yearIndex: alloc.perYear.length - 1, opacity: 1 }];
}

const YearLabelCaption: React.FC<{
  alloc: Allocation;
  doc: SkylineDocument;
  theme: SkylineFullProps["theme"];
}> = ({ alloc, doc, theme }) => {
  const frame = useCurrentFrame();
  const actives = activeYearsAt(frame, alloc);
  // During transition we suppress label entirely; otherwise show active year.
  if (actives.length !== 1) return null;
  const yearIdx = actives[0].yearIndex;
  const year = doc.years[yearIdx];
  const seg = alloc.perYear[yearIdx];
  if (!year || !seg) return null;
  const opacity = interpolate(
    frame,
    [
      seg.startFrame,
      seg.startFrame + 10,
      seg.startFrame + seg.segmentFrames - 10,
      seg.startFrame + seg.segmentFrames,
    ],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  if (opacity <= 0) return null;
  const p = palette(theme);
  return (
    <AbsoluteFill
      style={{
        justifyContent: "flex-end",
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
          fontSize: 56,
          fontWeight: 700,
          textAlign: "center",
        }}
      >
        {year.year} · {year.totalContributions.toLocaleString()} contributions
      </div>
    </AbsoluteFill>
  );
};

export const SkylineFull: React.FC<SkylineFullProps> = ({
  data,
  theme,
  resolution: _resolution,
  maxDurationSeconds,
}) => {
  const { width, height } = useVideoConfig();
  const alloc = useMemo(
    () => allocate(data.years.length, maxDurationSeconds, DEFAULT_TIMING),
    [data.years.length, maxDurationSeconds],
  );
  const keyframes = useMemo(() => buildAllKeyframes(data, alloc), [data, alloc]);
  const p = palette(theme);
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
        <fogExp2 attach="fog" args={[p.background, 0.018]} />
        <Lighting theme={theme} />
        <CameraRig keyframes={keyframes} />
        <ActiveYearMeshes data={data} alloc={alloc} theme={theme} />
      </ThreeCanvas>

      <Captions
        theme={theme}
        visibleFromFrame={0}
        visibleToFrame={alloc.introFrames}
        placement="center"
      >
        <div style={{ fontSize: 88, fontWeight: 700 }}>{data.username}</div>
        <div style={{ fontSize: 56, marginTop: 16, opacity: 0.9 }}>
          {yearRange}
        </div>
        <div style={{ fontSize: 44, marginTop: 8, opacity: 0.8 }}>
          {totalContrib.toLocaleString()} contributions
        </div>
      </Captions>

      <YearLabelCaption alloc={alloc} doc={data} theme={theme} />

      <Captions
        theme={theme}
        visibleFromFrame={alloc.totalFrames - alloc.outroFrames}
        visibleToFrame={alloc.totalFrames}
        placement="center"
      >
        <div style={{ fontSize: 72, fontWeight: 700 }}>{yearRange}</div>
        <div style={{ fontSize: 56, marginTop: 12, opacity: 0.9 }}>
          {totalContrib.toLocaleString()} contributions
        </div>
        <div style={{ fontSize: 40, marginTop: 6, opacity: 0.75 }}>
          {data.username}
        </div>
      </Captions>
    </AbsoluteFill>
  );
};

const ActiveYearMeshes: React.FC<{
  data: SkylineDocument;
  alloc: Allocation;
  theme: SkylineFullProps["theme"];
}> = ({ data, alloc, theme }) => {
  const frame = useCurrentFrame();
  const actives = activeYearsAt(frame, alloc);
  return (
    <>
      {actives.map((a) => {
        const year = data.years[a.yearIndex];
        if (!year) return null;
        return (
          <Skyline
            key={`year-${a.yearIndex}`}
            year={year}
            theme={theme}
            opacity={a.opacity}
            showLabel={false}
          />
        );
      })}
    </>
  );
};
