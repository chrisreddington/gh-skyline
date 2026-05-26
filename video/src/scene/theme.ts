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
    highlight: "#ffd166",
    rim: "#1f6feb",
  },
  light: {
    levels: ["#ebedf0", "#9be9a8", "#40c463", "#30a14e", "#216e39"],
    background: "#ffffff",
    captionText: "#1f2328",
    captionShadow: "rgba(255,255,255,0.6)",
    highlight: "#bf8700",
    rim: "#0969da",
  },
};

export type BucketLevel = 0 | 1 | 2 | 3 | 4;

/**
 * Bucket a day's contribution count into one of 5 levels using quartiles of
 * the year's peak day count. Mirrors GitHub's heuristic: count=0 always
 * lands at level 0; everything else is proportionally bucketed relative to
 * the year's peak so a quiet year still shows visible variation.
 *
 * For empty years (peakInYear=0) all days resolve to level 0.
 * Counts exceeding peakInYear clamp to level 4 (defensive — shouldn't occur).
 */
export function bucketLevel(count: number, peakInYear: number): BucketLevel {
  if (count <= 0 || peakInYear <= 0) {
    return 0;
  }
  if (count >= peakInYear) {
    return 4;
  }
  const ratio = count / peakInYear;
  if (ratio <= 0.25) return 1;
  if (ratio <= 0.5) return 2;
  if (ratio <= 0.75) return 3;
  return 4;
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
  // Use the level's own colour as the emissive tint so each bucket reads
  // distinctly (instead of every level glowing the same hero green).
  const tints: readonly string[] = p.levels;
  const intensities = theme === "dark"
    ? [0, 0.35, 0.65, 1.0, 1.6]
    : [0, 0.15, 0.3,  0.5, 0.8];
  return {
    emissive: tints[level] ?? tints[0],
    emissiveIntensity: intensities[level] ?? 0,
    roughness: 0.25,
    metalness: 0.1,
  };
}
