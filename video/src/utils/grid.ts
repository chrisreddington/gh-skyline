/**
 * Pure helpers for laying out a year's day grid in 3D space.
 *
 * Coordinate system (origin = grid centre):
 *   X = weekIndex axis (- = first week, + = last week)
 *   Z = weekday axis (Sun..Sat). Z is inverted so Sunday sits at the back.
 *   Y = bar height (up).
 */
import type { Day, YearData } from "../schema";

/** A single bar's position + geometric metadata. */
export interface BarPlacement {
  /** Stable instance index into <instancedMesh>: weekIndex * 7 + weekday. */
  readonly instanceIndex: number;
  readonly weekIndex: number;
  readonly weekday: number;
  readonly x: number;
  readonly z: number;
  /** Bar height (0 for padding days and zero-count days). */
  readonly height: number;
  /** Bucketed colour level 0..4. */
  readonly level: 0 | 1 | 2 | 3 | 4;
  readonly count: number;
  readonly inYear: boolean;
  /** ISO date of the source day, or null if the week had no day at this slot. */
  readonly date: string | null;
}

export interface GridGeometry {
  readonly cellSize: number;
  readonly gap: number;
  readonly originX: number;
  readonly originZ: number;
  readonly weekCount: number;
}

import { bucketLevel, buildLevelThresholds } from "../scene/theme";

const DEFAULT_CELL = 0.9;
const DEFAULT_GAP = 0.1;
const DAYS_PER_WEEK = 7;

const BAR_BASE_HEIGHT = 0.05;
const BAR_MAX_HEIGHT = 6;
const BAR_HEIGHT_SCALE = 0.9;

/** Timezone-safe in-year check. Phase 1 emits YYYY-MM-DD strings. */
export function isInYear(date: string, year: number): boolean {
  return date.startsWith(`${year}-`);
}

/**
 * Compute the highest in-year contribution count. Distinct from
 * `stats.peakDay.count`, which is nullable; this looks at raw days so it
 * never depends on Stats being populated.
 */
export function peakCountInYear(year: YearData): number {
  let peak = 0;
  for (const w of year.weeks) {
    for (const d of w.days) {
      if (d.count > peak && isInYear(d.date, year.year)) {
        peak = d.count;
      }
    }
  }
  return peak;
}

/**
 * Compute a bar's display height. `log1p` gives diminishing returns so the
 * tallest day is visually distinct without making short days disappear.
 */
export function barHeight(count: number, peakInYear: number): number {
  if (count <= 0 || peakInYear <= 0) {
    return 0;
  }
  const normalised = Math.log1p(count) / Math.log1p(peakInYear);
  const h = BAR_BASE_HEIGHT + normalised * BAR_HEIGHT_SCALE * BAR_MAX_HEIGHT;
  return Math.min(h, BAR_MAX_HEIGHT);
}

/** Build the geometric grid descriptor for a year (centred on origin). */
export function gridGeometry(year: YearData): GridGeometry {
  const cellSize = DEFAULT_CELL;
  const gap = DEFAULT_GAP;
  const weekCount = year.weeks.length;
  const stride = cellSize + gap;
  return {
    cellSize,
    gap,
    weekCount,
    originX: -((weekCount - 1) * stride) / 2,
    originZ: -((DAYS_PER_WEEK - 1) * stride) / 2,
  };
}

/**
 * Lay out every cell in the grid as a BarPlacement. Padding days (those whose
 * date falls outside the requested year) are kept as zero-height instances at
 * their natural (weekIndex, weekday) slot so instance indices stay stable —
 * this lets HighlightMoment address a known cell via `weekIndex * 7 + weekday`.
 */
export function layoutBars(year: YearData): BarPlacement[] {
  const peak = peakCountInYear(year);
  const geom = gridGeometry(year);
  const stride = geom.cellSize + geom.gap;
  const inYearActiveCounts = year.weeks.flatMap((w) =>
    w.days
      .filter((d) => isInYear(d.date, year.year) && d.count > 0)
      .map((d) => d.count)
  );
  const thresholds = buildLevelThresholds(inYearActiveCounts);
  const placements: BarPlacement[] = [];

  for (let wi = 0; wi < year.weeks.length; wi++) {
    const week = year.weeks[wi];
    if (!week) continue;
    for (let di = 0; di < DAYS_PER_WEEK; di++) {
      const day: Day | undefined = week.days[di];
      const weekday = day?.weekday ?? di;
      const inYear = day ? isInYear(day.date, year.year) : false;
      const count = day && inYear ? day.count : 0;
      placements.push({
        instanceIndex: wi * DAYS_PER_WEEK + di,
        weekIndex: wi,
        weekday,
        x: geom.originX + wi * stride,
        // Invert Z so Sunday (weekday=0) sits at the back of the grid.
        z: geom.originZ + (DAYS_PER_WEEK - 1 - weekday) * stride,
        height: barHeight(count, peak),
        level: bucketLevel(count, thresholds),
        count,
        inYear,
        date: day?.date ?? null,
      });
    }
  }
  return placements;
}

/** Total instance count for a year's grid. */
export function instanceCount(year: YearData): number {
  return year.weeks.length * DAYS_PER_WEEK;
}

/**
 * Locate the placement for a given ISO date. Returns null if the date isn't
 * in the grid (shouldn't happen for stat-derived dates but defensive).
 */
export function placementForDate(
  placements: BarPlacement[],
  date: string,
): BarPlacement | null {
  return placements.find((p) => p.date === date) ?? null;
}

/**
 * Locate all in-year placements belonging to the same week as the given
 * week-start date. Used to highlight a whole peak-week column.
 */
export function placementsForWeekStart(
  placements: BarPlacement[],
  startDate: string,
): BarPlacement[] {
  const anchor = placements.find((p) => p.date === startDate);
  if (!anchor) return [];
  return placements.filter((p) => p.weekIndex === anchor.weekIndex && p.inYear);
}
