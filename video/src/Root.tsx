/**
 * Remotion compositions root. Registers SkylineYear and SkylineFull with
 * `calculateMetadata` so per-prop resolution and (for SkylineFull) duration
 * are resolved at studio/render time.
 */
import React from "react";
import { Composition } from "remotion";

import {
  SkylineYear,
  skylineYearPropsSchema,
  calculateSkylineYearMetadata,
  SKYLINE_YEAR_FPS,
  SKYLINE_YEAR_DURATION_FRAMES,
} from "./compositions/SkylineYear";
import {
  SkylineFull,
  skylineFullPropsSchema,
  calculateSkylineFullMetadata,
  SKYLINE_FULL_FPS,
} from "./compositions/SkylineFull";
import {
  SkylineHeroCard,
  skylineHeroCardPropsSchema,
  calculateSkylineHeroCardMetadata,
} from "./compositions/SkylineHeroCard";
import {
  WrappedOrigin,
  WrappedPeak,
  WrappedReturn,
  WrappedSteady,
  WrappedStreak,
  wrappedCardPropsSchema,
  calculateWrappedCardMetadata,
  WRAPPED_CARD_DURATION,
  WRAPPED_CARD_FPS,
} from "./compositions/WrappedCards";

import sampleYear from "../fixtures/sample-year.json";
import sampleFull from "../fixtures/mixed-full.json";

import type { YearData, SkylineDocument } from "./schema";
import { MonaSansFontFaces } from "./scene/typography";

const sampleYearDoc = sampleYear as unknown as SkylineDocument;
const sampleFullDoc = sampleFull as unknown as SkylineDocument;
const sampleYearData: YearData = sampleYearDoc.years[0];

// For SkylineYear default, pick the user's most dramatic year from the full
// history (highest totalContributions). Falls back to the synthetic fixture
// if the full fixture isn't available.
const hero: YearData = (() => {
  if (!sampleFullDoc?.years?.length) return sampleYearData;
  let best = sampleFullDoc.years[0];
  for (const y of sampleFullDoc.years) {
    if (y.totalContributions > best.totalContributions) best = y;
  }
  return best;
})();
const heroUsername = sampleFullDoc?.username ?? sampleYearDoc.username;

export const Root: React.FC = () => {
  return (
    <>
      <MonaSansFontFaces />
      <Composition
        id="SkylineYear"
        component={SkylineYear}
        schema={skylineYearPropsSchema}
        fps={SKYLINE_YEAR_FPS}
        durationInFrames={SKYLINE_YEAR_DURATION_FRAMES}
        width={3840}
        height={2160}
        calculateMetadata={calculateSkylineYearMetadata}
        defaultProps={{
          data: hero,
          username: heroUsername,
          theme: "dark" as const,
          resolution: "1080p" as const,
        }}
      />
      <Composition
        id="SkylineFull"
        component={SkylineFull}
        schema={skylineFullPropsSchema}
        fps={SKYLINE_FULL_FPS}
        durationInFrames={5400}
        width={3840}
        height={2160}
        calculateMetadata={calculateSkylineFullMetadata}
        defaultProps={{
          data: sampleFullDoc,
          theme: "dark" as const,
          resolution: "1080p" as const,
          maxDurationSeconds: 180,
        }}
      />
      <Composition
        id="SkylineHeroCard"
        component={SkylineHeroCard}
        schema={skylineHeroCardPropsSchema}
        fps={30}
        durationInFrames={1}
        width={1200}
        height={630}
        calculateMetadata={calculateSkylineHeroCardMetadata}
        defaultProps={{
          data: sampleFullDoc,
          theme: "dark" as const,
        }}
      />
      {[
        ["WrappedPeak", WrappedPeak],
        ["WrappedStreak", WrappedStreak],
        ["WrappedReturn", WrappedReturn],
        ["WrappedOrigin", WrappedOrigin],
        ["WrappedSteady", WrappedSteady],
      ].map(([id, component]) => (
        <Composition
          key={id as string}
          id={id as string}
          component={component as React.FC<{
            data: SkylineDocument;
            theme: "light" | "dark";
          }>}
          schema={wrappedCardPropsSchema}
          fps={WRAPPED_CARD_FPS}
          durationInFrames={WRAPPED_CARD_DURATION}
          width={1200}
          height={630}
          calculateMetadata={calculateWrappedCardMetadata}
          defaultProps={{
            data: sampleFullDoc,
            theme: "dark" as const,
          }}
        />
      ))}
    </>
  );
};
