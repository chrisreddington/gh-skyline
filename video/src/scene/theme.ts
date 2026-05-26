/**
 * Theme palettes and helpers. Colours match GitHub's contribution graph so
 * the rendered skyline is visually consistent with the on-site graph.
 */
import type { Theme } from "../schema";

export interface ThemePalette {
  /** 5-stop scale: index 0 = no contributions, 1..4 = increasing intensity. */
  readonly levels: readonly [string, string, string, string, string];
  readonly background: string;
  readonly captionText: string;
  readonly captionShadow: string;
  readonly highlight: string;
  readonly rim: string;
}

export const themes: Record<Theme, ThemePalette> = {
  dark: {
    levels: ["#161b22", "#0e4429", "#006d32", "#26a641", "#39d353"],
    background: "#0d1117",
    captionText: "#f0f6fc",
    captionShadow: "rgba(0,0,0,0.6)",
    // Highlight = brightened L4 so peak bars stay in the GitHub palette family
    // instead of introducing a gold/marketing colour the platform never uses.
    highlight: "#7ee787",
    rim: "#1f6feb",
  },
  light: {
    levels: ["#ebedf0", "#9be9a8", "#40c463", "#30a14e", "#216e39"],
    background: "#ffffff",
    captionText: "#1f2328",
    captionShadow: "rgba(255,255,255,0.6)",
    highlight: "#216e39",
    rim: "#0969da",
  },
};

export type BucketLevel = 0 | 1 | 2 | 3 | 4;

export interface LevelThresholds {
  readonly low: number;
  readonly medium: number;
  readonly high: number;
}

function quantile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.floor((sorted.length - 1) * p);
  return sorted[idx] ?? 0;
}

/**
 * Build per-year activity thresholds from in-year non-zero counts.
 * Thresholds are quantile-based so sparse and bursty years still use
 * a meaningful spread of GitHub greens.
 */
export function buildLevelThresholds(counts: readonly number[]): LevelThresholds {
  const active = counts
    .filter((c) => Number.isFinite(c) && c > 0)
    .map((c) => Math.max(1, Math.floor(c)))
    .sort((a, b) => a - b);
  if (active.length === 0) {
    return { low: 0, medium: 0, high: 0 };
  }
  // Keep top-tier rare and expressive while still adapting per-year.
  const low = quantile(active, 0.35);
  const medium = quantile(active, 0.65);
  const high = quantile(active, 0.9);
  return { low, medium, high };
}

/**
 * Bucket a day's contribution count into one of 5 levels.
 *
 * Preferred path: pass per-year quantile thresholds (buildLevelThresholds)
 * to keep visual range across sparse, bursty, and dense years.
 * Compatibility path: passing a numeric peak preserves the old ratio-based
 * quartile bucketing.
 */
export function bucketLevel(
  count: number,
  thresholds: LevelThresholds | number,
): BucketLevel {
  if (count <= 0) {
    return 0;
  }
  // Backward compatibility: if called with a numeric peak, preserve the
  // original ratio-based behaviour.
  if (typeof thresholds === "number") {
    const peakInYear = thresholds;
    if (peakInYear <= 0) return 0;
    if (count >= peakInYear) return 4;
    const ratio = count / peakInYear;
    if (ratio <= 0.25) return 1;
    if (ratio <= 0.5) return 2;
    if (ratio <= 0.75) return 3;
    return 4;
  }
  if (thresholds.high <= 0) return 0;
  if (thresholds.low === thresholds.medium && thresholds.medium === thresholds.high) {
    return count >= thresholds.high ? 4 : 1;
  }
  if (count > thresholds.high) return 4;
  if (count > thresholds.medium) return 3;
  if (count > thresholds.low) return 2;
  if (count > 0) return 1;
  return 1;
}

/** Return the hex colour for a bucketed level under the given theme. */
export function colourForLevel(level: BucketLevel, theme: Theme): string {
  return themes[theme].levels[level];
}

/** Lookup helper for compositions/CLI; keeps callers from importing `themes`. */
export function palette(theme: Theme): ThemePalette {
  return themes[theme];
}

/**
 * Resolve per-bar colour progress during reveal. Higher-intensity levels lag
 * slightly so they "earn" their green later than low-intensity bars.
 */
export function revealColourProgress(revealT: number, level: BucketLevel): number {
  if (revealT <= 0) return 0;
  if (revealT >= 1) return 1;
  const lag = 0.95 + level * 0.18;
  const t = Math.pow(revealT, lag);
  return t * t * (3 - 2 * t);
}

/**
 * Per-level emissive treatment for bars. The base level colours (palette.levels)
 * are perceptually crushed when rendered as dark PBR surfaces in a dark scene —
 * splitting bars into one mesh per level with these emissive settings restores
 * legibility and lets level 4 actively glow, which is the "wow" moment.
 *
 * Indices match BucketLevel (0..4). Level 0 is intentionally dead (no emissive)
 * so empty days look like concrete; level 4 radiates so peak days read as
 * landmarks even after MP4 compression.
 */
export interface LevelMaterial {
  readonly emissive: string;
  readonly emissiveIntensity: number;
  readonly roughness: number;
  readonly metalness: number;
}

export function levelMaterial(level: BucketLevel, theme: Theme): LevelMaterial {
  const p = themes[theme];
  // Each level's emissive uses its own base hue (preserves GitHub palette
  // identity per bucket) but with progressively brighter intensity. L4 jumps
  // dramatically to mark "this is the peak" without leaving the green family.
  const tints: readonly string[] = p.levels;
  // Big gap between L3 and L4 so peak tier reads as distinct landmarks.
  const darkIntensities = [0, 0.07, 0.14, 0.22, 0.34];
  const lightIntensities = [0, 0.03, 0.07, 0.12, 0.2];
  const intensities = theme === "dark" ? darkIntensities : lightIntensities;
  const emissive = tints[level] ?? "#000000";
  return {
    emissive,
    emissiveIntensity: intensities[level] ?? 0,
    roughness: 0.35,
    metalness: 0.05,
  };
}
