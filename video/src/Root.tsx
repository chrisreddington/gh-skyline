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
import sampleMulti from "../fixtures/sample-multi.json";

import type { YearData, SkylineDocument } from "./schema";

const sampleYearDoc = sampleYear as unknown as SkylineDocument;
const sampleMultiDoc = sampleMulti as unknown as SkylineDocument;
const sampleYearData: YearData = sampleYearDoc.years[0];

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
          data: sampleYearData,
          username: sampleYearDoc.username,
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
          data: sampleMultiDoc,
          theme: "dark" as const,
          resolution: "1080p" as const,
          maxDurationSeconds: 180,
        }}
      />
    </>
  );
};
