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
  /** X-range the sweep actually traverses. For sparse years this is narrowed
   *  around the active centroid so the camera doesn't pan through empty grid. */
  sweepMinX: number;
  sweepMaxX: number;
  targetX: number;
  lookAtShiftX: number;
  framingScale: number;
  fovBoost: number;
  peakY: number;
  hasCanyon: boolean;
  caption: string | null;
  isClimax: boolean;
  /**
   * Portrait mode: very sparse years (activeRatio < 0.05) with actual bars.
   * Camera does a slow telephoto push-in to the bar cluster rather than a
   * full-year sweep — treats the few bars as sculpture, not panorama.
   */
  isPortrait: boolean;
  /** Caption shown for portrait-mode years (sparse/empty). Null otherwise. */
  portraitCaption: string | null;
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
    return { activeRatio: 0, activeCentroid: 0, activeMinX: 0, activeMaxX: 0 };
  }
  const xs = active.map((p) => p.x);
  return {
    activeRatio: active.length / placements.length,
    activeCentroid: active.reduce((sum, p) => sum + p.x, 0) / active.length,
    activeMinX: Math.min(...xs),
    activeMaxX: Math.max(...xs),
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

    // Narrow the sweep range for sparse years so the camera stays glued to
    // where contributions actually are. Without this, a year with 3 bars at
    // X≈-2 would have the camera sweep from X=-26 to X=+26 — bars would be
    // off-frame for ~80% of the segment. Padding adds breathing room either
    // side so the bars don't sit hard against the frame edge.
    const isSparse = metrics.activeRatio > 0 && metrics.activeRatio < 0.1;
    // Portrait: treat empty years and very-sparse years similarly — slow
    // telephoto push-in instead of a full sweep.
    const isPortrait = metrics.activeRatio < 0.05;
    const portraitCaption = isPortrait
      ? year.totalContributions === 0
        ? `${year.year} · A quiet year`
        : `${year.year} · ${year.totalContributions.toLocaleString()} contribution${year.totalContributions === 1 ? "" : "s"}`
      : null;
    let sweepMinX = geom.originX;
    let sweepMaxX = geom.originX + width;
    if (isSparse) {
      const activeSpan = metrics.activeMaxX - metrics.activeMinX;
      // Guarantee at least an 8-unit window so a single-bar year still pans.
      const halfWindow = Math.max(activeSpan / 2, 4);
      const padding = 5;
      sweepMinX = metrics.activeCentroid - halfWindow - padding;
      sweepMaxX = metrics.activeCentroid + halfWindow + padding;
    }

    return {
      yearIdx: seg.index,
      depthOffset: offsets[seg.index],
      startFrame: seg.startFrame,
      segmentFrames: seg.segmentFrames,
      localMinX: geom.originX,
      localMaxX: geom.originX + width,
      sweepMinX,
      sweepMaxX,
      targetX,
      lookAtShiftX: metrics.activeCentroid - centerX,
      peakY: Math.max(2.4, Math.min(lift * 0.55 + 1.0, 5.5)),
      hasCanyon,
      caption: hasCanyon ? chapterCaption(doc, year, chapter) : null,
      isClimax: year.totalContributions === maxTotal && maxTotal > 0,
      framingScale: 1.65 + (0.95 - 1.65) * metrics.activeRatio,
      fovBoost: (1 - metrics.activeRatio) * 10,
      isPortrait,
      portraitCaption,
    };
  });
}

export function buildAllKeyframes(
  alloc: Allocation,
  configs: readonly YearCameraConfig[],
): CameraKeyframe[] {
  const smoothstep = (t: number): number => {
    const c = Math.min(1, Math.max(0, t));
    return c * c * (3 - 2 * c);
  };
  const first = configs[0];
  const last = configs[configs.length - 1];
  const centerZ = (first.depthOffset + last.depthOffset) / 2;
  // Establishing wide shot from above-behind: camera sits at Y=18 looking
  // down the spine of stacked years so the viewer sees the full timeline
  // spread out in front. The previous frame-0 pose (Y=1.4) put the camera at
  // bar-top height and only the baseplate edge was visible.
  const k: CameraKeyframe[] = [
    { frame: 0, position: [0, 18, -28], lookAt: [0, 0, centerZ], fov: 55 },
    { frame: 45, position: [0, 22, -22], lookAt: [0, 0, centerZ], fov: 52 },
    {
      frame: Math.max(alloc.introFrames - 1, 90),
      position: [first.targetX - 7.2, 10, first.depthOffset - 12.4],
      lookAt: [first.targetX, 1.4, first.depthOffset],
      fov: 42 + first.fovBoost,
    },
  ];
  for (let index = 0; index < configs.length; index++) {
    const cfg = configs[index];
    const nextCfg = configs[index + 1];
    const z = cfg.depthOffset;
    const lookX = cfg.targetX + cfg.lookAtShiftX * 0.45;
    const segEnd = cfg.startFrame + cfg.segmentFrames;

    const sweepFractions = [0.2, 0.32, 0.46, 0.6, 0.76];

    if (cfg.isPortrait) {
      // Very sparse/empty year: centered head-on approach then slow orbit around
      // the bar cluster — treats the few bars as sculpture, not panorama.
      // The opening keyframe enters from high above (center X = targetX) so the
      // bar appears centered regardless of where the cluster sits on the grid.
      k.push(
        {
          frame: cfg.startFrame + Math.floor(cfg.segmentFrames * 0.08),
          position: [cfg.targetX, 8.0, z - 14],
          lookAt: [cfg.targetX, 1.5, z],
          fov: 42,
        },
        {
          frame: cfg.startFrame + Math.floor(cfg.segmentFrames * 0.25),
          position: [cfg.targetX, 5.0, z - 10],
          lookAt: [cfg.targetX, 1.5, z],
          fov: 34,
        },
        // Orbit to one side (camera right of bar in world → bar appears screen-left)
        {
          frame: cfg.startFrame + Math.floor(cfg.segmentFrames * 0.55),
          position: [cfg.targetX - 3.5, 3.5, z - 7],
          lookAt: [cfg.targetX, 1.0, z],
          fov: 28,
        },
        // Orbit to other side (bar appears screen-right for parallax feel)
        {
          frame: cfg.startFrame + Math.floor(cfg.segmentFrames * 0.82),
          position: [cfg.targetX + 2.5, 2.8, z - 5.5],
          lookAt: [cfg.targetX, 1.0, z],
          fov: 30,
        },
      );
    } else {
      k.push({
        frame: cfg.startFrame + Math.floor(cfg.segmentFrames * 0.08),
        position: [lookX - 6.4, 5.5, z - 9.2 * cfg.framingScale],
        lookAt: [lookX, 1.4, z],
        fov: 38 + cfg.fovBoost,
      });
      for (const fraction of sweepFractions) {
        const eased = smoothstep(fraction);
        const segmentX = cfg.sweepMinX + (cfg.sweepMaxX - cfg.sweepMinX) * eased;
        const focus = 1 - Math.abs(eased - 0.5) / 0.5;
        const farDistance = 11.6 * cfg.framingScale;
        const nearDistance = 8.4 * cfg.framingScale;
        const distance = farDistance - focus * (farDistance - nearDistance);
        const fovBase = 42 + cfg.fovBoost;
        const fovZoom = cfg.hasCanyon ? 8 : 5;
        k.push({
          frame: cfg.startFrame + Math.floor(cfg.segmentFrames * fraction),
          position: [segmentX - 1.8, 5.5 + focus * 1.2, z - distance],
          lookAt: [segmentX + 2.6, 1.2 + focus * 0.35, z],
          fov: fovBase - focus * fovZoom,
        });
      }
    }

    if (cfg.hasCanyon && cfg.caption) {
      k.push(
        {
          frame: cfg.startFrame + Math.floor(cfg.segmentFrames * 0.66),
          position: [cfg.targetX - 3.2, cfg.peakY + 1.5, z - 6.8],
          lookAt: [cfg.targetX, cfg.peakY * 0.55, z],
          fov: cfg.isClimax ? 30 : 34,
        },
        {
          frame: cfg.startFrame + Math.floor(cfg.segmentFrames * (cfg.isClimax ? 0.82 : 0.76)),
          position: [cfg.targetX + 1.8, cfg.peakY + 1.5, z - 6.2],
          lookAt: [cfg.targetX + 2.6, cfg.peakY * 0.52, z],
          fov: cfg.isClimax ? 29 : 33,
        },
      );
    }
    // Portrait years exit looking at their actual cluster center (targetX),
    // not the lookAtShift-adjusted lookX which would drag the camera off-center.
    const segEndLookX = cfg.isPortrait ? cfg.targetX : lookX;
    k.push({
      frame: segEnd,
      position: [segEndLookX + 4.8, 6.5, z - 10.6],
      lookAt: [segEndLookX, 1.5, z],
      fov: 44,
    });
    if (nextCfg) {
      const transitionSpan = Math.max(0, nextCfg.startFrame - segEnd);
      if (transitionSpan > 0) {
        const nextLookX = nextCfg.isPortrait
          ? nextCfg.targetX
          : nextCfg.targetX + nextCfg.lookAtShiftX * 0.45;
        const bridgeZ = (z + nextCfg.depthOffset) / 2;
        const bridgeX = (segEndLookX + nextLookX) / 2;
        k.push({
          frame: segEnd + Math.floor(transitionSpan * 0.5),
          position: [bridgeX, 12.2, bridgeZ - 15.8],
          lookAt: [bridgeX, 1.3, bridgeZ],
          fov: 46,
        });
      }
    }
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
  const eased = t * t * (3 - 2 * t);
  return cfg.localMinX -
    BUILD_LEAD +
    eased * (cfg.localMaxX - cfg.localMinX + BUILD_LEAD * 2);
}
