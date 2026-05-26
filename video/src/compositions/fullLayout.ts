/**
 * Pure layout and story helpers for the full-history composition.
 */
import type { SkylineDocument, YearData } from "../schema";
import {
  gridGeometry,
  layoutBars,
  placementForDate,
  placementsForWeekStart,
} from "../utils/grid";
import type { Allocation } from "../utils/timing";
import { peakLiftAtX, type CameraKeyframe } from "../scene/CameraRig";

export const YEAR_DEPTH_UNITS = 7;
export const BUILD_LEAD = 9;

export type ChapterType = "origin" | "peak" | "streak" | "return" | "steady" | "present";

export interface YearCameraConfig {
  yearIdx: number;
  depthOffset: number;
  startFrame: number;
  segmentFrames: number;
  localMinX: number;
  localMaxX: number;
  targetX: number;
  lookAtShiftX: number;
  framingScale: number;
  fovBoost: number;
  peakY: number;
  hasCanyon: boolean;
  caption: string | null;
  isClimax: boolean;
}

export function yearDepthOffsets(doc: SkylineDocument): number[] {
  const lastIndex = doc.years.length - 1;
  return doc.years.map((_, idx) => (lastIndex - idx) * YEAR_DEPTH_UNITS);
}

export function computeWeights(doc: SkylineDocument): number[] {
  return doc.years.map((y) => Math.sqrt(y.totalContributions + 1));
}

export function totalContributions(doc: SkylineDocument): number {
  return doc.years.reduce((sum, y) => sum + y.totalContributions, 0);
}

export function yearRange(doc: SkylineDocument): string {
  const years = doc.years.map((y) => y.year);
  const min = Math.min(...years);
  const max = Math.max(...years);
  return min === max ? String(min) : `${min} → ${max}`;
}

export function firstContributionYear(doc: SkylineDocument): number | null {
  return doc.years.find((year) => year.totalContributions > 0)?.year ?? null;
}

function meritThreshold(doc: SkylineDocument): number {
  const totals = doc.years
    .map((y) => y.totalContributions)
    .filter((n) => n > 0)
    .sort((a, b) => a - b);
  if (totals.length === 0) return 10;
  return Math.max(10, totals[Math.floor((totals.length - 1) * 0.25)]);
}

function activeMetrics(year: YearData) {
  const placements = layoutBars(year).filter((p) => p.inYear);
  const active = placements.filter((p) => p.count > 0);
  if (placements.length === 0 || active.length === 0) {
    return { activeRatio: 0, activeCentroid: 0 };
  }
  return {
    activeRatio: active.length / placements.length,
    activeCentroid: active.reduce((sum, p) => sum + p.x, 0) / active.length,
  };
}

function pickSteadyYear(doc: SkylineDocument): YearData | null {
  const nonzero = doc.years.filter((y) => y.totalContributions > 0);
  if (nonzero.length < 3) return null;
  const mean = nonzero.reduce((sum, y) => sum + y.totalContributions, 0) / nonzero.length;
  const variance =
    nonzero.reduce((sum, y) => sum + Math.pow(y.totalContributions - mean, 2), 0) /
    nonzero.length;
  return mean > 0 && Math.sqrt(variance) / mean < 0.4
    ? nonzero[Math.floor(nonzero.length / 2)]
    : null;
}

function classifyChapters(doc: SkylineDocument): Map<number, ChapterType> {
  const byYear = new Map<number, ChapterType>();
  const nonzero = doc.years.filter((y) => y.totalContributions > 0);
  if (nonzero[0]) byYear.set(nonzero[0].year, "origin");
  const peak = doc.years.reduce((best, y) =>
    y.totalContributions > best.totalContributions ? y : best,
  );
  if (peak.totalContributions > 0) byYear.set(peak.year, "peak");
  const streak = doc.years.reduce<YearData | null>((best, y) => {
    const len = y.stats?.longestStreak?.length ?? 0;
    const bestLen = best?.stats?.longestStreak?.length ?? 0;
    return len > bestLen ? y : best;
  }, null);
  if (streak?.stats?.longestStreak) byYear.set(streak.year, "streak");
  let returnYear: YearData | null = null;
  let returnDelta = 0;
  for (let i = 1; i < doc.years.length; i++) {
    const prev = doc.years[i - 1];
    const curr = doc.years[i];
    const delta = curr.totalContributions - prev.totalContributions;
    if (prev.totalContributions < curr.totalContributions * 0.25 && delta > returnDelta) {
      returnYear = curr;
      returnDelta = delta;
    }
  }
  if (returnYear && !byYear.has(returnYear.year)) byYear.set(returnYear.year, "return");
  const present = doc.years[doc.years.length - 1];
  if (present.totalContributions > 0 && !byYear.has(present.year)) {
    byYear.set(present.year, "present");
  }
  const steady = pickSteadyYear(doc);
  if (steady && !byYear.has(steady.year)) byYear.set(steady.year, "steady");
  return byYear;
}

function chapterCaption(
  doc: SkylineDocument,
  year: YearData,
  chapter: ChapterType | null,
): string | null {
  switch (chapter) {
    case "origin":
      return `First contributions · ${year.year}`;
    case "peak":
      return `Tallest year · ${year.totalContributions.toLocaleString()} contributions`;
    case "streak":
      return year.stats?.longestStreak
        ? `${year.stats.longestStreak.length}-day streak · started ${year.stats.longestStreak.start}`
        : null;
    case "return": {
      const idx = doc.years.findIndex((y) => y.year === year.year);
      return idx > 0 ? `After a quiet ${doc.years[idx - 1].year}.` : null;
    }
    case "steady":
      return "Every year. Every quarter.";
    case "present":
      return "Still here.";
    default:
      return null;
  }
}

export function buildYearConfigs(
  doc: SkylineDocument,
  alloc: Allocation,
  offsets: readonly number[],
): YearCameraConfig[] {
  const threshold = meritThreshold(doc);
  const chapters = classifyChapters(doc);
  const maxTotal = Math.max(...doc.years.map((y) => y.totalContributions));
  return alloc.perYear.map((seg) => {
    const year = doc.years[seg.index];
    const geom = gridGeometry(year);
    const stride = geom.cellSize + geom.gap;
    const width = (geom.weekCount - 1) * stride;
    const metrics = activeMetrics(year);
    const centerX = geom.originX + width / 2;
    const placements = layoutBars(year);
    let targetX = metrics.activeRatio > 0 ? metrics.activeCentroid : centerX;
    if (year.stats?.peakWeek) {
      const bars = placementsForWeekStart(placements, year.stats.peakWeek.startDate);
      if (bars[0]) targetX = bars[0].x;
    } else if (year.stats?.peakDay) {
      targetX = placementForDate(placements, year.stats.peakDay.date)?.x ?? targetX;
    }
    const hasCanyon = year.totalContributions >= threshold && year.stats !== null;
    const lift = hasCanyon ? peakLiftAtX(targetX, placements) : 2.4;
    const chapter = chapters.get(year.year) ?? null;
    return {
      yearIdx: seg.index,
      depthOffset: offsets[seg.index],
      startFrame: seg.startFrame,
      segmentFrames: seg.segmentFrames,
      localMinX: geom.originX,
      localMaxX: geom.originX + width,
      targetX,
      lookAtShiftX: metrics.activeCentroid - centerX,
      framingScale: 1.25 + (0.9 - 1.25) * metrics.activeRatio,
      fovBoost: (1 - metrics.activeRatio) * 6,
      peakY: Math.max(2.4, Math.min(lift * 0.55 + 1.0, 5.5)),
      hasCanyon,
      caption: hasCanyon ? chapterCaption(doc, year, chapter) : null,
      isClimax: year.totalContributions === maxTotal && maxTotal > 0,
    };
  });
}

export function buildAllKeyframes(
  alloc: Allocation,
  configs: readonly YearCameraConfig[],
): CameraKeyframe[] {
  const first = configs[0];
  const last = configs[configs.length - 1];
  const centerZ = (first.depthOffset + last.depthOffset) / 2;
  const k: CameraKeyframe[] = [
    { frame: 0, position: [-2.8, 1.4, -5.2], lookAt: [0, 0.4, -2.4], fov: 63 },
    { frame: 45, position: [0, 20, -13], lookAt: [0, 0, centerZ], fov: 62 },
    {
      frame: Math.max(alloc.introFrames - 1, 90),
      position: [first.targetX - 5, 7.5, first.depthOffset - 7],
      lookAt: [first.targetX, 1.4, first.depthOffset],
      fov: 42 + first.fovBoost,
    },
  ];
  for (const cfg of configs) {
    const z = cfg.depthOffset;
    const lookX = cfg.targetX + cfg.lookAtShiftX * 0.45;
    const segEnd = cfg.startFrame + cfg.segmentFrames;
    k.push({
      frame: cfg.startFrame + Math.floor(cfg.segmentFrames * 0.08),
      position: [lookX - 5, 5.5, z - 5.2 * cfg.framingScale],
      lookAt: [lookX, 1.4, z],
      fov: 40 + cfg.fovBoost,
    });
    if (cfg.hasCanyon && cfg.caption) {
      k.push(
        {
          frame: cfg.startFrame + Math.floor(cfg.segmentFrames * 0.42),
          position: [cfg.targetX - 2.2, cfg.peakY + 0.8, z - 3.2],
          lookAt: [cfg.targetX, cfg.peakY * 0.55, z],
          fov: cfg.isClimax ? 29 : 34,
        },
        {
          frame: cfg.startFrame + Math.floor(cfg.segmentFrames * (cfg.isClimax ? 0.74 : 0.65)),
          position: [cfg.targetX + 1.4, cfg.peakY + 0.7, z - 2.7],
          lookAt: [cfg.targetX + 2.6, cfg.peakY * 0.52, z],
          fov: cfg.isClimax ? 28 : 32,
        },
      );
    } else {
      k.push({
        frame: cfg.startFrame + Math.floor(cfg.segmentFrames * 0.5),
        position: [lookX, 7.2, z - 7.5 * cfg.framingScale],
        lookAt: [lookX, 1.1, z],
        fov: 44 + cfg.fovBoost,
      });
    }
    k.push({
      frame: segEnd,
      position: [lookX + 4.5, 6.8, z - 6.4],
      lookAt: [lookX, 1.5, z],
      fov: 42,
    });
  }
  const outroStart = alloc.totalFrames - alloc.outroFrames;
  k.push(
    { frame: outroStart, position: [18, 12, -13], lookAt: [0, 1.6, centerZ], fov: 54, cut: true },
    {
      frame: outroStart + Math.floor(alloc.outroFrames * 0.45),
      position: [13, 10, -9],
      lookAt: [0, 1.4, centerZ],
      fov: 56,
    },
    { frame: alloc.totalFrames, position: [12, 9.4, -8.2], lookAt: [0, 1.3, centerZ], fov: 57 },
  );
  return k.sort((a, b) => a.frame - b.frame);
}

export function revealCameraX(frame: number, cfg: YearCameraConfig): number {
  if (frame < cfg.startFrame) return -Infinity;
  if (frame > cfg.startFrame + cfg.segmentFrames) return Infinity;
  const t = (frame - cfg.startFrame) / Math.max(1, cfg.segmentFrames);
  return cfg.localMinX - BUILD_LEAD + t * (cfg.localMaxX - cfg.localMinX + BUILD_LEAD * 2);
}
