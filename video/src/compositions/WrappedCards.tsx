/**
 * Short "Skyline Wrapped" share-card compositions. They reuse the canonical
 * full-history hero object and add one data-focused Mona Sans headline.
 */
import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, type CalculateMetadataFunction } from "remotion";
import { z } from "zod";
import { documentSchema, themeSchema, type SkylineDocument, type Theme } from "../schema";
import { MONA_SANS_FONT_FAMILY } from "../scene/typography";
import { palette } from "../scene/theme";
import { SkylineHeroCard } from "./SkylineHeroCard";

export const wrappedCardPropsSchema = z.object({
  data: documentSchema,
  theme: themeSchema.default("dark"),
});

export type WrappedCardProps = z.infer<typeof wrappedCardPropsSchema>;

export const WRAPPED_CARD_FPS = 30;
export const WRAPPED_CARD_DURATION = 240;

export const calculateWrappedCardMetadata: CalculateMetadataFunction<
  WrappedCardProps
> = async ({ props }) => ({
  width: 1200,
  height: 630,
  fps: WRAPPED_CARD_FPS,
  durationInFrames: WRAPPED_CARD_DURATION,
  props,
});

type Variant = "peak" | "streak" | "return" | "origin" | "steady";

function peakCopy(data: SkylineDocument): { eyebrow: string; title: string } {
  const year = data.years.reduce((best, y) =>
    y.totalContributions > best.totalContributions ? y : best,
  );
  return {
    eyebrow: "Tallest year",
    title: `${year.year} · ${year.totalContributions.toLocaleString()} contributions`,
  };
}

function streakCopy(data: SkylineDocument): { eyebrow: string; title: string } {
  const year = data.years.reduce((best, y) => {
    const len = y.stats?.longestStreak?.length ?? 0;
    const bestLen = best.stats?.longestStreak?.length ?? 0;
    return len > bestLen ? y : best;
  });
  const streak = year.stats?.longestStreak;
  return streak
    ? { eyebrow: "Longest streak", title: `${streak.length} days · started ${streak.start}` }
    : peakCopy(data);
}

function returnCopy(data: SkylineDocument): { eyebrow: string; title: string } {
  let best: { prev: number; year: number; delta: number } | null = null;
  for (let i = 1; i < data.years.length; i++) {
    const prev = data.years[i - 1];
    const year = data.years[i];
    const delta = year.totalContributions - prev.totalContributions;
    if (prev.totalContributions < year.totalContributions * 0.25 && delta > (best?.delta ?? 0)) {
      best = { prev: prev.year, year: year.year, delta };
    }
  }
  return best
    ? { eyebrow: "Return", title: `After a quiet ${best.prev}. ${best.year} rose.` }
    : peakCopy(data);
}

function originCopy(data: SkylineDocument): { eyebrow: string; title: string } {
  const year = data.years.find((y) => y.totalContributions > 0) ?? data.years[0];
  return { eyebrow: "Origin", title: `Committed since ${year.year}.` };
}

function steadyCopy(data: SkylineDocument): { eyebrow: string; title: string } {
  const active = data.years.filter((y) => y.totalContributions > 0);
  if (active.length < 3) return originCopy(data);
  return { eyebrow: "Steady", title: `${active.length} active years. Every quarter.` };
}

function copyFor(data: SkylineDocument, variant: Variant): { eyebrow: string; title: string } {
  switch (variant) {
    case "peak":
      return peakCopy(data);
    case "streak":
      return streakCopy(data);
    case "return":
      return returnCopy(data);
    case "origin":
      return originCopy(data);
    case "steady":
      return steadyCopy(data);
  }
}

const WrappedCard: React.FC<WrappedCardProps & { variant: Variant }> = ({
  data,
  theme,
  variant,
}) => {
  const frame = useCurrentFrame();
  const p = palette(theme);
  const copy = copyFor(data, variant);
  const opacity = interpolate(frame, [0, 24, WRAPPED_CARD_DURATION - 15], [0, 1, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill style={{ backgroundColor: p.background }}>
      <SkylineHeroCard data={data} theme={theme} />
      <AbsoluteFill
        style={{
          justifyContent: "flex-start",
          alignItems: "flex-start",
          padding: 56,
          pointerEvents: "none",
          opacity,
        }}
      >
        <div
          style={{
            color: p.captionText,
            fontFamily: `"${MONA_SANS_FONT_FAMILY}", ui-sans-serif, system-ui, sans-serif`,
            textShadow: `0 2px 18px ${p.captionShadow}`,
            maxWidth: 760,
          }}
        >
          <div style={{ fontSize: 20, opacity: 0.72, letterSpacing: 4, textTransform: "uppercase" }}>
            {copy.eyebrow}
          </div>
          <div style={{ fontSize: 46, fontWeight: 760, marginTop: 8, lineHeight: 1.05 }}>
            {copy.title}
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export const WrappedPeak: React.FC<WrappedCardProps> = (props) => (
  <WrappedCard {...props} variant="peak" />
);

export const WrappedStreak: React.FC<WrappedCardProps> = (props) => (
  <WrappedCard {...props} variant="streak" />
);

export const WrappedReturn: React.FC<WrappedCardProps> = (props) => (
  <WrappedCard {...props} variant="return" />
);

export const WrappedOrigin: React.FC<WrappedCardProps> = (props) => (
  <WrappedCard {...props} variant="origin" />
);

export const WrappedSteady: React.FC<WrappedCardProps> = (props) => (
  <WrappedCard {...props} variant="steady" />
);
