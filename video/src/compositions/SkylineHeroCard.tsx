/**
 * SkylineHeroCard renders the canonical social-share still: the full Z-stacked
 * skyline object plus the final three-line CTA, at Open Graph dimensions.
 */
import React, { useMemo } from "react";
import * as THREE from "three";
import { AbsoluteFill, type CalculateMetadataFunction } from "remotion";
import { ThreeCanvas } from "@remotion/three";
import { PerspectiveCamera, Text } from "@react-three/drei";
import { z } from "zod";

import {
  documentSchema,
  themeSchema,
  type SkylineDocument,
  type Theme,
} from "../schema";
import { Lighting } from "../scene/Lighting";
import { Skyline } from "../scene/Skyline";
import { palette } from "../scene/theme";
import { MONA_SANS_FONT_FAMILY, MONA_SANS_MEDIUM } from "../scene/typography";
import { gridGeometry } from "../utils/grid";
import { yearDepthOffsets } from "./fullLayout";

export const skylineHeroCardPropsSchema = z.object({
  data: documentSchema,
  theme: themeSchema.default("dark"),
});

export type SkylineHeroCardProps = z.infer<typeof skylineHeroCardPropsSchema>;

export const calculateSkylineHeroCardMetadata: CalculateMetadataFunction<
  SkylineHeroCardProps
> = async ({ props }) => ({
  width: 1200,
  height: 630,
  fps: 30,
  durationInFrames: 1,
  props,
});

function totalContributions(doc: SkylineDocument): number {
  return doc.years.reduce((sum, year) => sum + year.totalContributions, 0);
}

function firstContributionYear(doc: SkylineDocument): number | null {
  return doc.years.find((year) => year.totalContributions > 0)?.year ?? null;
}

function yearRange(doc: SkylineDocument): string {
  const years = doc.years.map((y) => y.year);
  const min = Math.min(...years);
  const max = Math.max(...years);
  return min === max ? String(min) : `${min} → ${max}`;
}

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

const HeroBaseplate: React.FC<{
  doc: SkylineDocument;
  theme: Theme;
  width: number;
  depth: number;
  centerZ: number;
  frontZ: number;
}> = ({ doc, theme, width, depth, centerZ, frontZ }) => {
  const p = palette(theme);
  return (
    <group>
      <mesh position={[0, -0.1, centerZ]} receiveShadow>
        <boxGeometry args={[width, 0.2, depth]} />
        <meshStandardMaterial
          color={theme === "dark" ? "#1f2937" : "#d0d7de"}
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
        @{doc.username.replace(/^@/, "")}
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
        {yearRange(doc)}
      </Text>
    </group>
  );
};

export const SkylineHeroCard: React.FC<SkylineHeroCardProps> = ({ data, theme }) => {
  const p = palette(theme);
  const offsets = useMemo(() => yearDepthOffsets(data), [data]);
  const base = useMemo(() => baseDimensions(data), [data]);
  const total = useMemo(() => totalContributions(data), [data]);
  const firstYear = useMemo(() => firstContributionYear(data), [data]);

  return (
    <AbsoluteFill style={{ backgroundColor: p.background }}>
      <ThreeCanvas
        width={1200}
        height={430}
        gl={{
          antialias: true,
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.22,
          outputColorSpace: THREE.SRGBColorSpace,
        }}
        style={{ backgroundColor: p.background, height: 430 }}
      >
        <fogExp2 attach="fog" args={[p.background, 0.005]} />
        <ambientLight intensity={1.1} />
        <directionalLight position={[0, 30, -20]} intensity={1.2} color="#ffffff" />
        <directionalLight position={[30, 15, 20]} intensity={0.8} color="#7ee787" />
        <PerspectiveCamera
          makeDefault
          position={[0, 92, base.centerZ - 6]}
          fov={38}
          near={0.1}
          far={220}
          onUpdate={(camera) => camera.lookAt(0, 0, base.centerZ)}
        />
        <HeroBaseplate doc={data} theme={theme} {...base} />
        {data.years.map((year, idx) => (
          <group key={year.year} position={[0, 0, offsets[idx]]}>
            <Skyline
              year={year}
              theme={theme}
              cameraX={Infinity}
              showLabel={false}
              showBaseplate={false}
            />
          </group>
        ))}
      </ThreeCanvas>
      <AbsoluteFill
        style={{
          justifyContent: "flex-end",
          alignItems: "center",
          padding: 64,
          paddingBottom: 42,
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            color: p.captionText,
            textShadow: `0 2px 18px ${p.captionShadow}`,
            fontFamily: `"${MONA_SANS_FONT_FAMILY}", ui-sans-serif, system-ui, sans-serif`,
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: 22, opacity: 0.82, letterSpacing: 4 }}>
            {firstYear ? `Committed since ${firstYear}.` : yearRange(data)}
          </div>
          <div style={{ fontSize: 52, fontWeight: 760, marginTop: 8 }}>
            {total.toLocaleString()} contributions. Your skyline.
          </div>
          <div style={{ fontSize: 22, marginTop: 16, opacity: 0.78 }}>
            Let's build. &nbsp;□ gh-skyline
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
