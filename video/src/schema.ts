/**
 * Zod schemas mirroring the Phase 1 JSON export produced by
 * `internal/jsonexport/jsonexport.go`.
 *
 * Notes:
 * - `stats` itself is nullable AND each sub-stat
 *   (peakDay/peakWeek/longestStreak/firstContribution/lastContribution) is
 *   individually nullable. The Go side emits null for missing values rather
 *   than omitting the field, so we use `.nullable()` rather than `.optional()`.
 * - `Day.date` is validated as a YYYY-MM-DD string so downstream code can use
 *   timezone-safe `startsWith` filtering without parsing into Date.
 * - `schemaVersion` is a hard literal — bump intentionally if the upstream
 *   schema changes.
 */
import { z } from "zod";

export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u, {
  message: "expected YYYY-MM-DD date string",
});

export const daySchema = z.object({
  date: dateSchema,
  count: z.number().int().nonnegative(),
  weekday: z.number().int().min(0).max(6),
});

export const weekSchema = z.object({
  weekIndex: z.number().int().nonnegative(),
  startDate: dateSchema,
  days: z.array(daySchema),
});

export const dayStatSchema = z.object({
  date: dateSchema,
  count: z.number().int().nonnegative(),
});

export const weekStatSchema = z.object({
  startDate: dateSchema,
  total: z.number().int().nonnegative(),
});

export const streakStatSchema = z.object({
  start: dateSchema,
  end: dateSchema,
  length: z.number().int().positive(),
});

export const statsSchema = z.object({
  peakDay: dayStatSchema.nullable(),
  peakWeek: weekStatSchema.nullable(),
  longestStreak: streakStatSchema.nullable(),
  firstContribution: dayStatSchema.nullable(),
  lastContribution: dayStatSchema.nullable(),
});

export const yearSchema = z.object({
  year: z.number().int(),
  totalContributions: z.number().int().nonnegative(),
  weeks: z.array(weekSchema),
  stats: statsSchema.nullable(),
});

export const documentSchema = z.object({
  schemaVersion: z.literal(1),
  username: z.string().min(1),
  generatedAt: z.string(),
  years: z.array(yearSchema),
});

export type Day = z.infer<typeof daySchema>;
export type Week = z.infer<typeof weekSchema>;
export type DayStat = z.infer<typeof dayStatSchema>;
export type WeekStat = z.infer<typeof weekStatSchema>;
export type StreakStat = z.infer<typeof streakStatSchema>;
export type Stats = z.infer<typeof statsSchema>;
export type YearData = z.infer<typeof yearSchema>;
export type SkylineDocument = z.infer<typeof documentSchema>;

/** Valid theme identifiers accepted by both compositions and the CLI. */
export const themeSchema = z.enum(["light", "dark"]);
export type Theme = z.infer<typeof themeSchema>;

/** Resolution presets the compositions know how to render at. */
export const resolutionSchema = z.enum(["4k", "1080p"]);
export type Resolution = z.infer<typeof resolutionSchema>;
