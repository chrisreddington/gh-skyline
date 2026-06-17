/**
 * Declarative timeline for the SkylineYear composition.
 *
 * These are the absolute frame boundaries (@30fps) that the camera primitives
 * and the on-screen overlays are choreographed against. Extracted verbatim from
 * the original SkylineYear monolith so behaviour is unchanged — this module is
 * now the single source of truth that both `buildKeyframes` and the React
 * component read from.
 */

export const SKYLINE_YEAR_FPS = 30;

/** Total composition length: 1146f = 38.2s (includes a 6s outro hold). */
export const SKYLINE_YEAR_TOTAL_FRAMES = 1146;

/** A frame interval [start, end] used to scope a primitive. */
export interface FrameWindow {
  readonly start: number;
  readonly end: number;
}

/**
 * Phase markers (absolute frames). Each value carries the meaning it had in the
 * monolith; see the inline notes for why the number is what it is.
 */
export const MARKERS = {
  /** Bars start collapsing the moment the camera commits to the descent. */
  collapseStart: 75,
  /** Bars fully collapsed (65-frame wave window). */
  collapseEnd: 140,
  /** LowerThirdWatermark fade-in timing. */
  titleEnd: 99,
  /** Dive complete; cruise begins. */
  entryEnd: 150,
  /** Collapse fully released; bars now grow via the cruise reveal. */
  collapseRelease: 190,
  /** Density-weighted cruise ends. */
  cruiseEnd: 450,
  /** Full 360° helicopter orbit ends. */
  flybyEnd: 690,
  /** Approach to peak complete. */
  approachEnd: 750,
  /** Canyon hold / peak spotlight ends. */
  canyonEnd: 906,
  /** Camera arrives at the elevated outro pose; outro card fades in. */
  emergeEnd: 966,
  /** Composition end (outro hold runs emergeEnd→total via sampleRig clamp). */
  total: SKYLINE_YEAR_TOTAL_FRAMES,
} as const;

/**
 * Per-primitive frame windows derived from the markers. `compose` walks these
 * in order. Durations are preserved exactly from the monolith.
 */
export const SKYLINE_YEAR_TIMELINE = {
  total: MARKERS.total,
  markers: MARKERS,
  windows: {
    establish: { start: 0, end: MARKERS.collapseStart }, // 0..75 (cut hold)
    approachCollapse: { start: MARKERS.collapseStart, end: MARKERS.entryEnd }, // 75..150
    cruise: { start: MARKERS.entryEnd, end: MARKERS.cruiseEnd }, // 150..450
    panoramaOrbit: { start: MARKERS.cruiseEnd, end: MARKERS.flybyEnd }, // 450..690
    peakFocus: { start: MARKERS.flybyEnd, end: MARKERS.canyonEnd }, // 690..906
    outro: { start: MARKERS.canyonEnd, end: MARKERS.emergeEnd }, // 906..966
    hold: { start: MARKERS.emergeEnd, end: MARKERS.total }, // 966..1146 (no new keyframes)
  },
} as const;

export type SkylineYearTimeline = typeof SKYLINE_YEAR_TIMELINE;
