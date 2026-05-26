/**
 * Full-history Remotion composition: one continuous Z-stacked skyline object
 * with data-driven chapters and the final "Your skyline" CTA.
 */
import React, { useLayoutEffect, useMemo } from "react";
import * as THREE from "three";
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
  type CalculateMetadataFunction,
} from "remotion";
import { ThreeCanvas } from "@remotion/three";
import { Text } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { z } from "zod";

import {
  documentSchema,
  resolutionSchema,
  themeSchema,
  type SkylineDocument,
  type Theme,
} from "../schema";
import { CameraRig, sampleRig } from "../scene/CameraRig";
import { Captions } from "../scene/Captions";
import { Lighting } from "../scene/Lighting";
import { Skyline } from "../scene/Skyline";
import { palette } from "../scene/theme";
import { MONA_SANS_FONT_FAMILY, MONA_SANS_MEDIUM } from "../scene/typography";
import { gridGeometry } from "../utils/grid";
import { allocate, DEFAULT_TIMING, type Allocation } from "../utils/timing";
import {
  buildAllKeyframes,
  buildYearConfigs,
  computeWeights,
  firstContributionYear,
  revealCameraX,
  totalContributions,
  yearDepthOffsets,
  yearRange,
  type YearCameraConfig,
} from "./fullLayout";

export const skylineFullPropsSchema = z.object({
  data: documentSchema,
  theme: themeSchema.default("dark"),
  resolution: resolutionSchema.default("4k"),
  maxDurationSeconds: z.number().positive().default(180),
});

export type SkylineFullProps = z.infer<typeof skylineFullPropsSchema>;

export const SKYLINE_FULL_FPS = 30;

function cinemaState(frame: number, alloc: Allocation, configs: readonly YearCameraConfig[]) {
  const outroStart = alloc.totalFrames - alloc.outroFrames;
  if (frame >= outroStart) return { fog: 0.005, ambient: 0.3, rim: 0.2 };
  const active = configs.find(
    (cfg) => frame >= cfg.startFrame && frame <= cfg.startFrame + cfg.segmentFrames,
  );
  if (!active) return { fog: 0.005, ambient: 0.3, rim: 0.2 };
  if (active.isClimax) return { fog: 0.015, ambient: 0.2, rim: 0.34 };
  if (!active.hasCanyon) return { fog: 0.007, ambient: 0.28, rim: 0.18 };
  return { fog: 0.008, ambient: 0.25, rim: 0.24 };
}

const DynamicFog: React.FC<{ color: string; density: number }> = ({ color, density }) => {
  const { scene } = useThree();
  useLayoutEffect(() => {
    if (!(scene.fog instanceof THREE.FogExp2)) scene.fog = new THREE.FogExp2(color, density);
    else {
      scene.fog.color.set(color);
      scene.fog.density = density;
    }
  }, [color, density, scene]);
  return null;
};

export const calculateSkylineFullMetadata: CalculateMetadataFunction<
  SkylineFullProps
> = async ({ props }) => {
  const dims = props.resolution === "1080p"
    ? { width: 1920, height: 1080 }
    : { width: 3840, height: 2160 };
  if (props.data.years.length === 0) throw new Error("SkylineFull: data.years is empty");
  const alloc = allocate(
    props.data.years.length,
    props.maxDurationSeconds,
    DEFAULT_TIMING,
    computeWeights(props.data),
  );
  return { ...dims, fps: SKYLINE_FULL_FPS, durationInFrames: alloc.totalFrames, props };
};

export const SkylineFull: React.FC<SkylineFullProps> = ({
  data,
  theme,
  resolution: _resolution,
  maxDurationSeconds,
}) => {
  const { width, height } = useVideoConfig();
  const frame = useCurrentFrame();
  const p = palette(theme);
  const weights = useMemo(() => computeWeights(data), [data]);
  const alloc = useMemo(
    () => allocate(data.years.length, maxDurationSeconds, DEFAULT_TIMING, weights),
    [data.years.length, maxDurationSeconds, weights],
  );
  const offsets = useMemo(() => yearDepthOffsets(data), [data]);
  const configs = useMemo(() => buildYearConfigs(data, alloc, offsets), [alloc, data, offsets]);
  const keyframes = useMemo(() => buildAllKeyframes(alloc, configs), [alloc, configs]);
  const sampledRig = useMemo(() => sampleRig(frame, keyframes), [frame, keyframes]);
  const state = cinemaState(frame, alloc, configs);
  const total = useMemo(() => totalContributions(data), [data]);
  const range = useMemo(() => yearRange(data), [data]);
  const firstYear = useMemo(() => firstContributionYear(data), [data]);
  const base = useMemo(() => baseDimensions(data), [data]);

  return (
    <AbsoluteFill style={{ backgroundColor: p.background }}>
      <ThreeCanvas
        width={width}
        height={height}
        gl={{
          antialias: true,
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.14,
          outputColorSpace: THREE.SRGBColorSpace,
        }}
        style={{ backgroundColor: p.background }}
      >
        <DynamicFog color={p.background} density={state.fog} />
        <Lighting theme={theme} ambientIntensity={state.ambient} rimIntensity={state.rim} />
        <CameraRig keyframes={keyframes} />
        <SharedBaseplate username={data.username} range={range} theme={theme} {...base} />
        {data.years.map((year, idx) => {
          const cfg = configs.find((c) => c.yearIdx === idx);
          return (
            <group key={year.year} position={[0, 0, offsets[idx]]}>
              <Skyline
                year={year}
                theme={theme}
                cameraX={cfg ? revealCameraX(frame, cfg) : sampledRig.position[0]}
                buildLeadDistance={9}
                showLabel={false}
                showBaseplate={false}
              />
            </group>
          );
        })}
      </ThreeCanvas>
      <IntroCard data={data} total={total} range={range} theme={theme} to={alloc.introFrames + 30} />
      <ChapterCaption configs={configs} theme={theme} />
      <PanoramicOutro
        from={alloc.totalFrames - alloc.outroFrames + 60}
        to={alloc.totalFrames}
        username={data.username}
        firstYear={firstYear}
        total={total}
        range={range}
        theme={theme}
      />
    </AbsoluteFill>
  );
};

function baseDimensions(doc: SkylineDocument) {
  const offsets = yearDepthOffsets(doc);
  const geom = gridGeometry(doc.years[0]);
  const stride = geom.cellSize + geom.gap;
  const maxWeeks = Math.max(...doc.years.map((year) => gridGeometry(year).weekCount));
  const firstZ = Math.min(...offsets) - 3.5 * stride - 1.2;
  const lastZ = Math.max(...offsets) + 3.5 * stride + 1.2;
  return {
    width: (maxWeeks + 1) * stride + 2.4,
    depth: lastZ - firstZ,
    centerZ: (firstZ + lastZ) / 2,
    frontZ: firstZ,
  };
}

const SharedBaseplate: React.FC<{
  username: string;
  range: string;
  theme: Theme;
  width: number;
  depth: number;
  centerZ: number;
  frontZ: number;
}> = ({ username, range, theme, width, depth, centerZ, frontZ }) => {
  const p = palette(theme);
  return (
    <group>
      <mesh position={[0, -0.1, centerZ]} receiveShadow>
        <boxGeometry args={[width, 0.2, depth]} />
        <meshStandardMaterial
          color={theme === "dark" ? "#10161f" : "#d0d7de"}
          roughness={0.86}
        />
      </mesh>
      <Text
        position={[-width / 2 + 1.3, 0.08, frontZ - 0.25]}
        rotation={[-Math.PI / 2, 0, 0]}
        fontSize={0.62}
        font={MONA_SANS_MEDIUM}
        color={p.captionText}
        anchorX="left"
        anchorY="middle"
      >
        @{username.replace(/^@/, "")}
      </Text>
      <Text
        position={[width / 2 - 1.3, 0.08, frontZ - 0.25]}
        rotation={[-Math.PI / 2, 0, 0]}
        fontSize={0.54}
        font={MONA_SANS_MEDIUM}
        color={p.captionText}
        anchorX="right"
        anchorY="middle"
      >
        {range}
      </Text>
    </group>
  );
};

const IntroCard: React.FC<{
  data: SkylineDocument;
  total: number;
  range: string;
  theme: Theme;
  to: number;
}> = ({ data, total, range, theme, to }) => (
  <Captions theme={theme} visibleFromFrame={45} visibleToFrame={to} placement="center">
    <div style={{ fontSize: 86, fontWeight: 700 }}>@{data.username.replace(/^@/, "")}</div>
    <div style={{ fontSize: 54, marginTop: 14, opacity: 0.88 }}>{range}</div>
    <div style={{ fontSize: 42, marginTop: 8, opacity: 0.78 }}>
      {total.toLocaleString()} contribution{total === 1 ? "" : "s"}
    </div>
  </Captions>
);

const ChapterCaption: React.FC<{ configs: readonly YearCameraConfig[]; theme: Theme }> = ({
  configs,
  theme,
}) => {
  const frame = useCurrentFrame();
  const active = configs.find((cfg) => {
    const start = cfg.startFrame + Math.floor(cfg.segmentFrames * 0.38);
    const end = cfg.startFrame + Math.floor(cfg.segmentFrames * 0.7);
    return cfg.caption && frame >= start && frame <= end;
  });
  if (!active?.caption) return null;
  const start = active.startFrame + Math.floor(active.segmentFrames * 0.38);
  const end = active.startFrame + Math.floor(active.segmentFrames * 0.7);
  return (
    <Captions theme={theme} visibleFromFrame={start} visibleToFrame={end} placement="bottom">
      {active.caption}
    </Captions>
  );
};

const PanoramicOutro: React.FC<{
  from: number;
  to: number;
  username: string;
  firstYear: number | null;
  total: number;
  range: string;
  theme: Theme;
}> = ({ from, to, username, firstYear, total, range, theme }) => {
  const frame = useCurrentFrame();
  const p = palette(theme);
  const opacity = interpolate(frame, [from, from + 30, to - 5, to], [0, 1, 1, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  if (opacity <= 0) return null;
  return (
    <AbsoluteFill
      style={{ justifyContent: "center", alignItems: "center", padding: "8%", opacity }}
    >
      <div
        style={{
          color: p.captionText,
          textShadow: `0 2px 18px ${p.captionShadow}`,
          fontFamily: `"${MONA_SANS_FONT_FAMILY}", ui-sans-serif, system-ui, sans-serif`,
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: 34, opacity: 0.72, letterSpacing: 5 }}>
          {firstYear ? `Committed since ${firstYear}.` : range}
        </div>
        <div style={{ fontSize: 92, fontWeight: 760, marginTop: 12 }}>
          {total.toLocaleString()} contributions. Your skyline.
        </div>
        <div style={{ fontSize: 34, marginTop: 22, opacity: 0.76 }}>
          Let's build. &nbsp;□ gh-skyline &nbsp;@{username.replace(/^@/, "")}
        </div>
      </div>
    </AbsoluteFill>
  );
};
