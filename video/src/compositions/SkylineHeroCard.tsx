/**
 * SkylineHeroCard renders the canonical social-share still: the full Z-stacked
 * skyline object plus the final three-line CTA, at Open Graph dimensions.
 *
 * Brand note: the GitHub Invertocat mark is used per github.com/logos terms —
 * white on dark, black on light; no modifications; linking to github/gh-skyline.
 */
import React, { useMemo } from "react";
import * as THREE from "three";
import { AbsoluteFill, type CalculateMetadataFunction } from "remotion";
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

/**
 * GitHubMark renders the official GitHub Invertocat as an inline SVG.
 * Per github.com/logos: use only in white or black, no other modifications.
 * The path is taken from primer/octicons (mark-github), scaled via viewBox.
 */
const GitHubMark: React.FC<{ color: string; size?: number }> = ({
  color,
  size = 24,
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 98 96"
    width={size}
    height={size}
    style={{ display: "inline-block", verticalAlign: "middle", flexShrink: 0 }}
    aria-label="GitHub"
    role="img"
  >
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      fill={color}
      d="M48.854 0C21.839 0 0 22 0 49.217c0 21.756 13.993 40.172 33.405 46.69 2.427.49 3.316-1.059 3.316-2.362 0-1.141-.08-5.052-.08-9.127-13.59 2.926-16.42-5.884-16.42-5.884-2.064-5.541-5.141-7.017-5.141-7.017-4.148-2.927.329-2.927.329-2.927 4.596.326 7.024 4.817 7.024 4.817 4.148 7.017 10.862 4.981 13.492 3.805.414-2.927 1.651-4.981 2.966-6.127-10.862-1.229-22.316-5.541-22.316-24.615 0-5.457 1.897-9.924 4.99-13.411-.496-1.228-2.161-6.377.482-13.244 0 0 4.063-1.308 13.25 5.047 3.847-1.075 7.99-1.613 12.13-1.633 4.14.02 8.283.558 12.148 1.633 9.168-6.355 13.23-5.047 13.23-5.047 2.644 6.867.979 12.016.483 13.244 3.093 3.487 4.99 7.954 4.99 13.411 0 19.074-11.454 23.386-22.4 24.615 1.651 1.47 3.15 4.39 3.15 8.843 0 6.457-.082 11.637-.082 13.245 0 1.305.889 2.854 3.316 2.362C84.007 89.389 98 70.973 98 49.217 98 22 76.161 0 48.854 0z"
    />
  </svg>
);

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
              <GitHubMark
                color={p.captionText}
                size={22}
              />
              github/gh-skyline
            </span>
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
