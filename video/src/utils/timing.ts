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
 * @param yearCount       Number of years in the document. Must be ≥ 1.
 * @param maxSeconds      Hard cap on total runtime (seconds).
 * @param defaults        Override defaults (optional).
 * @param perYearWeights  Optional per-year weights (length === yearCount).
 *                        If provided, segment frames are distributed
 *                        proportionally to weights with per-year clamps so
 *                        no single year dominates or vanishes. Use this to
 *                        give busy years more screen time than quiet years
 *                        for the same developer.
 */
export function allocate(
  yearCount: number,
  maxSeconds: number,
  defaults: TimingDefaults = DEFAULT_TIMING,
  perYearWeights?: readonly number[],
): Allocation {
  if (!Number.isInteger(yearCount) || yearCount < 1) {
    throw new Error(
      `allocate: yearCount must be a positive integer (got ${yearCount})`,
    );
  }
  if (!(maxSeconds > 0)) {
    throw new Error(`allocate: maxSeconds must be > 0 (got ${maxSeconds})`);
  }
  if (perYearWeights && perYearWeights.length !== yearCount) {
    throw new Error(
      `allocate: perYearWeights length (${perYearWeights.length}) must equal yearCount (${yearCount})`,
    );
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

  // Weighted-distribution path: dispatch and return early.
  if (perYearWeights) {
    return allocateWeighted(
      introF,
      outroF,
      defaults,
      yearCount,
      maxFrames,
      perYearWeights,
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

// Per-year clamp bounds for weighted allocation (in seconds).
const WEIGHTED_MIN_SEG_SECONDS = 3;
const WEIGHTED_MAX_SEG_SECONDS = 18;

/**
 * Weighted segment allocation. Distributes the available segment budget
 * proportional to weights, clamped per-year so:
 *   - no year is shorter than WEIGHTED_MIN_SEG_SECONDS (so quiet years still
 *     register on-screen),
 *   - no year is longer than WEIGHTED_MAX_SEG_SECONDS (so one mega-year
 *     doesn't eat the whole timeline),
 *   - any leftover from clamps is redistributed across unclamped years.
 *
 * If even the minimums can't fit within maxFrames, falls back to uniform
 * allocation with progressively-shrinking floors (same staged strategy as
 * the unweighted path).
 */
function allocateWeighted(
  introF: number,
  outroF: number,
  defaults: TimingDefaults,
  n: number,
  maxFrames: number,
  weights: readonly number[],
): Allocation {
  const { fps } = defaults;
  let transF = s2f(defaults.transitionSeconds, fps);
  const minSeg = s2f(WEIGHTED_MIN_SEG_SECONDS, fps);
  const maxSeg = s2f(WEIGHTED_MAX_SEG_SECONDS, fps);

  const trySegBudget = (transFTry: number): number[] | null => {
    const transTotal = Math.max(0, n - 1) * transFTry;
    const budget = maxFrames - introF - outroF - transTotal;
    if (budget < n * SEGMENT_HARD_MIN_FRAMES) return null;
    // Initial proportional allocation (non-negative weights; replace
    // non-positive with epsilon so they still get a minimum slot).
    const safeW = weights.map((w) =>
      Number.isFinite(w) && w > 0 ? w : 0.001,
    );
    const sumW = safeW.reduce((a, b) => a + b, 0);
    const raw = safeW.map((w) => (w / sumW) * budget);
    // Apply per-year clamps; rebalance overflow/underflow into unclamped.
    const clamped: number[] = new Array(n).fill(0);
    const isFixed: boolean[] = new Array(n).fill(false);
    let remaining = budget;
    // Iteratively pin clamped years until none change.
    while (true) {
      let changed = false;
      const fixedTotal = clamped.reduce(
        (s, v, i) => s + (isFixed[i] ? v : 0),
        0,
      );
      const freeWSum = safeW.reduce(
        (s, w, i) => s + (isFixed[i] ? 0 : w),
        0,
      );
      const freeBudget = remaining - fixedTotal;
      if (freeWSum <= 0) {
        // All years fixed. Distribute any residue evenly into smallest.
        break;
      }
      for (let i = 0; i < n; i++) {
        if (isFixed[i]) continue;
        const proposed = (safeW[i] / freeWSum) * freeBudget;
        if (proposed < minSeg) {
          clamped[i] = minSeg;
          isFixed[i] = true;
          changed = true;
        } else if (proposed > maxSeg) {
          clamped[i] = maxSeg;
          isFixed[i] = true;
          changed = true;
        }
      }
      if (!changed) {
        // Fill remaining free years proportionally.
        for (let i = 0; i < n; i++) {
          if (isFixed[i]) continue;
          clamped[i] = (safeW[i] / freeWSum) * freeBudget;
        }
        break;
      }
    }
    // Convert to integer frames; absorb rounding into the smallest free year.
    const intSeg = clamped.map((v) => Math.max(SEGMENT_HARD_MIN_FRAMES, Math.round(v)));
    // Verify minimum feasibility.
    const sumInt = intSeg.reduce((a, b) => a + b, 0);
    if (sumInt < budget - n) {
      // Under-utilisation: distribute spare budget respecting per-year max caps.
      // Sort ascending so years with the most headroom are padded first.
      let remaining = budget - sumInt;
      const padOrder = [...Array(n).keys()].sort((a, b) => intSeg[a] - intSeg[b]);
      for (const idx of padOrder) {
        if (remaining <= 0) break;
        const headroom = maxSeg - intSeg[idx];
        if (headroom > 0) {
          const add = Math.min(headroom, remaining);
          intSeg[idx] += add;
          remaining -= add;
        }
      }
      // If remaining > 0 all years are at maxSeg; accept the shorter total —
      // the composition will simply be shorter than maxDurationSeconds.
    } else if (sumInt > budget) {
      // Trim from the largest unfixed (or largest overall) until we fit.
      let over = sumInt - budget;
      while (over > 0) {
        const idx = intSeg.indexOf(Math.max(...intSeg));
        const reducible = intSeg[idx] - SEGMENT_HARD_MIN_FRAMES;
        if (reducible <= 0) return null;
        const cut = Math.min(reducible, over);
        intSeg[idx] -= cut;
        over -= cut;
      }
    }
    void raw;
    return intSeg;
  };

  let segments = trySegBudget(transF);
  if (!segments) {
    // Drop transition to 0.5s and retry.
    transF = Math.round(SHRUNK_TRANSITION_FRAMES_30FPS * (fps / 30));
    segments = trySegBudget(transF);
  }
  if (!segments) {
    // Last-resort: uniform with hard min floor.
    const stage = shrinkSegment(
      introF,
      outroF,
      transF,
      n,
      maxFrames,
      SEGMENT_HARD_MIN_FRAMES,
    );
    if (stage === null) {
      throw new Error(
        `allocate(weighted): cannot fit ${n} years within ${maxFrames}f; raise maxDurationSeconds`,
      );
    }
    return assemble(introF, outroF, stage, transF, n, fps);
  }
  // Assemble with per-year variable segments.
  const perYear: YearSegment[] = [];
  let cursor = introF;
  for (let i = 0; i < n; i++) {
    const isLast = i === n - 1;
    const thisTrans = isLast ? 0 : transF;
    perYear.push({
      index: i,
      startFrame: cursor,
      segmentFrames: segments[i],
      transitionFrames: thisTrans,
    });
    cursor += segments[i] + thisTrans;
  }
  const totalFrames = cursor + outroF;
  return { fps, introFrames: introF, outroFrames: outroF, perYear, totalFrames };
}
