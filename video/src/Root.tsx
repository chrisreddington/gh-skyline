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

import sampleYear from "../fixtures/sample-year.json";
import sampleFull from "../fixtures/sample-full.json";

import type { YearData, SkylineDocument } from "./schema";

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
    </>
  );
};
