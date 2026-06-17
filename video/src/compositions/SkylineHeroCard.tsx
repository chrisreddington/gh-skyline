/**
 * SkylineHeroCard renders the canonical social-share still: the full Z-stacked
 * skyline object plus the final three-line CTA, at Open Graph dimensions.
 *
 * Brand note: the GitHub Invertocat mark is used per github.com/logos terms —
 * white on dark, black on light; no modifications; linking to github/gh-skyline.
 */
import React, { useMemo } from "react";
import * as THREE from "three";
import { AbsoluteFill, staticFile, type CalculateMetadataFunction } from "remotion";
import { ThreeCanvas } from "@remotion/three";
import { useThree } from "@react-three/fiber";
import { z } from "zod";

import {
  documentSchema,
  themeSchema,
  type SkylineDocument,
  type Theme,
} from "../schema";
import { Skyline } from "../scene/Skyline";
import { palette } from "../scene/theme";
import { MONA_SANS_FONT_FAMILY } from "../scene/typography";
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
  theme: Theme;
  width: number;
  depth: number;
  centerZ: number;
}> = ({ theme, width, depth, centerZ }) => {
  return (
    <group>
      <mesh position={[0, -0.1, centerZ]} receiveShadow>
        <boxGeometry args={[width, 0.2, depth]} />
        <meshStandardMaterial
          color={theme === "dark" ? "#1f2937" : "#d0d7de"}
          roughness={0.86}
        />
      </mesh>
    </group>
  );
};

const HeroCamera: React.FC<{ centerZ: number }> = ({ centerZ }) => {
  const { camera } = useThree();
  React.useLayoutEffect(() => {
    const perspective = camera as THREE.PerspectiveCamera;
    perspective.position.set(0, 52, centerZ - 82);
    perspective.fov = 43;
    perspective.near = 0.1;
    perspective.far = 220;
    perspective.lookAt(0, 0.6, centerZ);
    perspective.updateProjectionMatrix();
  }, [camera, centerZ]);
  return null;
};

export const SkylineHeroCard: React.FC<SkylineHeroCardProps> = ({ data, theme }) => {
  const p = palette(theme);
  const offsets = useMemo(() => yearDepthOffsets(data), [data]);
  const base = useMemo(() => baseDimensions(data), [data]);
  const total = useMemo(() => totalContributions(data), [data]);
  const firstYear = useMemo(() => firstContributionYear(data), [data]);
  const githubMarkSrc = theme === "dark"
    ? staticFile("images/github-mark-white.svg")
    : staticFile("images/github-mark.svg");

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
        <HeroCamera centerZ={base.centerZ} />
        <HeroBaseplate theme={theme} {...base} />
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
          paddingBottom: 36,
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            color: p.captionText,
            fontFamily: `"${MONA_SANS_FONT_FAMILY}", ui-sans-serif, system-ui, sans-serif`,
            textAlign: "center",
          }}
        >
          {/* Top eyebrow */}
          <div
            style={{
              fontSize: 17,
              fontWeight: 500,
              opacity: 0.72,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
            }}
          >
            {firstYear ? `Committed since ${firstYear}.` : yearRange(data)}
          </div>

          {/* Headline — the main story */}
          <div
            style={{
              fontSize: 50,
              fontWeight: 800,
              lineHeight: 1.1,
              marginTop: 8,
              letterSpacing: "-0.02em",
            }}
          >
            {total.toLocaleString()} contributions.
            <br />
            Your skyline.
          </div>

          {/* CTA row: "Let's build." then GitHub mark + repo slug */}
          <div
            style={{
              marginTop: 20,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 10,
            }}
          >
            {/* GitHub's tagline */}
            <span
              style={{
                fontSize: 22,
                fontWeight: 700,
                letterSpacing: "-0.01em",
                opacity: 0.92,
              }}
            >
              Let&apos;s build.
            </span>

            {/* Invertocat + repo slug — horizontal row, brand-compliant */}
            <span
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                fontSize: 16,
                fontWeight: 500,
                opacity: 0.78,
                letterSpacing: "0.01em",
              }}
            >
              <img
                src={githubMarkSrc}
                alt="GitHub"
                width={22}
                height={22}
                style={{ display: "block" }}
              />
              github/gh-skyline
            </span>
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
