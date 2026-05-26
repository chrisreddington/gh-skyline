/**
 * Integer-frame timing allocator for the multi-year SkylineFull composition.
 *
 * The composition concatenates:
 *
 *   intro | year_0 | trans | year_1 | trans | ... | year_{n-1} | outro
 *
 * Each block is an integer frame count. The allocator guarantees:
 *   - Σ blocks === totalFrames (no gaps, no overlaps).
 *   - totalFrames ≤ maxFrames (except when the throw paths fire).
 *
 * Shrink strategy when defaults would exceed `maxFrames`:
 *   1. Reduce per-year segmentFrames keeping a 3s floor (90 frames @30fps).
 *   2. If still over budget, also drop transitionFrames from 1s to 0.5s.
 *   3. If still over, drop the 3s segment floor down to a 1s hard minimum.
 *   4. If even that overflows, throw — caller must raise maxDurationSeconds.
 */
export interface TimingDefaults {
  readonly fps: number;
  readonly introSeconds: number;
  readonly outroSeconds: number;
  readonly perYearSeconds: number;
  readonly transitionSeconds: number;
}

export const DEFAULT_TIMING: TimingDefaults = {
  fps: 30,
  introSeconds: 4,
  outroSeconds: 4,
  perYearSeconds: 12,
  transitionSeconds: 1,
};

export interface YearSegment {
  readonly index: number;
  readonly startFrame: number;
  readonly segmentFrames: number;
  /** Transition that *follows* this year. 0 for the last year. */
  readonly transitionFrames: number;
}

export interface Allocation {
  readonly fps: number;
  readonly introFrames: number;
  readonly outroFrames: number;
  readonly perYear: YearSegment[];
  readonly totalFrames: number;
}

const SEGMENT_FLOOR_FRAMES = 90; // 3s @30fps
const SEGMENT_HARD_MIN_FRAMES = 30; // 1s @30fps
const SHRUNK_TRANSITION_FRAMES_30FPS = 15; // 0.5s @30fps

function s2f(seconds: number, fps: number): number {
  return Math.max(0, Math.round(seconds * fps));
}

function compose(
  introF: number,
  outroF: number,
  segF: number,
  transF: number,
  n: number,
): number {
  return introF + n * segF + Math.max(0, n - 1) * transF + outroF;
}

/**
 * Allocate frame ranges for the SkylineFull composition.
 *
 * @param yearCount   Number of years in the document. Must be ≥ 1.
 * @param maxSeconds  Hard cap on total runtime (seconds).
 * @param defaults    Override defaults (optional).
 */
export function allocate(
  yearCount: number,
  maxSeconds: number,
  defaults: TimingDefaults = DEFAULT_TIMING,
): Allocation {
  if (!Number.isInteger(yearCount) || yearCount < 1) {
    throw new Error(
      `allocate: yearCount must be a positive integer (got ${yearCount})`,
    );
  }
  if (!(maxSeconds > 0)) {
    throw new Error(`allocate: maxSeconds must be > 0 (got ${maxSeconds})`);
  }
  const { fps } = defaults;
  const maxFrames = Math.floor(maxSeconds * fps);
  const introF = s2f(defaults.introSeconds, fps);
  const outroF = s2f(defaults.outroSeconds, fps);
  if (introF + outroF >= maxFrames) {
    throw new Error(
      `allocate: intro+outro (${introF + outroF}f) does not leave room within maxFrames (${maxFrames}f)`,
    );
  }
  let segF = s2f(defaults.perYearSeconds, fps);
  let transF = s2f(defaults.transitionSeconds, fps);

  const total = compose(introF, outroF, segF, transF, yearCount);
  if (total <= maxFrames) {
    return assemble(introF, outroF, segF, transF, yearCount, fps);
  }

  // Shrink stage 1: shrink segF with 3s floor, original transF.
  const stage1 = shrinkSegment(
    introF,
    outroF,
    transF,
    yearCount,
    maxFrames,
    SEGMENT_FLOOR_FRAMES,
  );
  if (stage1 !== null) {
    return assemble(introF, outroF, stage1, transF, yearCount, fps);
  }

  // Shrink stage 2: drop transition to 0.5s, retry with 3s floor.
  transF = Math.round(SHRUNK_TRANSITION_FRAMES_30FPS * (fps / 30));
  const stage2 = shrinkSegment(
    introF,
    outroF,
    transF,
    yearCount,
    maxFrames,
    SEGMENT_FLOOR_FRAMES,
  );
  if (stage2 !== null) {
    return assemble(introF, outroF, stage2, transF, yearCount, fps);
  }

  // Shrink stage 3: relax segment floor to 1s minimum.
  const stage3 = shrinkSegment(
    introF,
    outroF,
    transF,
    yearCount,
    maxFrames,
    SEGMENT_HARD_MIN_FRAMES,
  );
  if (stage3 !== null) {
    return assemble(introF, outroF, stage3, transF, yearCount, fps);
  }

  throw new Error(
    `allocate: cannot fit ${yearCount} years within ${maxSeconds}s; raise maxDurationSeconds`,
  );
}

function shrinkSegment(
  introF: number,
  outroF: number,
  transF: number,
  n: number,
  maxFrames: number,
  floorF: number,
): number | null {
  const transTotal = Math.max(0, n - 1) * transF;
  const available = maxFrames - introF - outroF - transTotal;
  if (available < n * floorF) return null;
  // Integer floor division; assemble() absorbs the remainder into the outro
  // so we never exceed maxFrames.
  const segF = Math.floor(available / n);
  return segF < floorF ? null : segF;
}

function assemble(
  introF: number,
  outroF: number,
  segF: number,
  transF: number,
  n: number,
  fps: number,
): Allocation {
  const perYear: YearSegment[] = [];
  let cursor = introF;
  for (let i = 0; i < n; i++) {
    const isLast = i === n - 1;
    const thisTrans = isLast ? 0 : transF;
    perYear.push({
      index: i,
      startFrame: cursor,
      segmentFrames: segF,
      transitionFrames: thisTrans,
    });
    cursor += segF + thisTrans;
  }
  const totalFrames = cursor + outroF;
  return { fps, introFrames: introF, outroFrames: outroF, perYear, totalFrames };
}
