import { describe, it, expect } from "vitest";
import { documentSchema, statsSchema } from "../schema";

const validDoc = {
  schemaVersion: 1,
  username: "chrisreddington",
  generatedAt: "2026-05-26T11:00:00Z",
  years: [
    {
      year: 2025,
      totalContributions: 3,
      weeks: [
        {
          weekIndex: 0,
          startDate: "2024-12-29",
          days: [
            { date: "2024-12-29", count: 0, weekday: 0 },
            { date: "2024-12-30", count: 0, weekday: 1 },
            { date: "2024-12-31", count: 0, weekday: 2 },
            { date: "2025-01-01", count: 3, weekday: 3 },
            { date: "2025-01-02", count: 0, weekday: 4 },
            { date: "2025-01-03", count: 0, weekday: 5 },
            { date: "2025-01-04", count: 0, weekday: 6 },
          ],
        },
      ],
      stats: {
        peakDay: { date: "2025-01-01", count: 3 },
        peakWeek: { startDate: "2024-12-29", total: 3 },
        longestStreak: { start: "2025-01-01", end: "2025-01-01", length: 1 },
        firstContribution: { date: "2025-01-01", count: 3 },
        lastContribution: { date: "2025-01-01", count: 3 },
      },
    },
  ],
};

describe("documentSchema", () => {
  it("accepts a valid document", () => {
    expect(() => documentSchema.parse(validDoc)).not.toThrow();
  });

  it("rejects schemaVersion !== 1", () => {
    const bad = { ...validDoc, schemaVersion: 2 };
    expect(() => documentSchema.parse(bad)).toThrow();
  });

  it("accepts stats: null at the year level", () => {
    const doc = structuredClone(validDoc) as unknown as {
      years: { stats: unknown }[];
    };
    doc.years[0].stats = null;
    expect(() => documentSchema.parse(doc)).not.toThrow();
  });

  it("accepts individual nullable sub-stats", () => {
    expect(() =>
      statsSchema.parse({
        peakDay: null,
        peakWeek: null,
        longestStreak: null,
        firstContribution: null,
        lastContribution: null,
      }),
    ).not.toThrow();
    expect(() =>
      statsSchema.parse({
        peakDay: { date: "2025-01-01", count: 3 },
        peakWeek: null,
        longestStreak: null,
        firstContribution: { date: "2025-01-01", count: 3 },
        lastContribution: { date: "2025-01-01", count: 3 },
      }),
    ).not.toThrow();
  });

  it("rejects malformed Day.date", () => {
    const doc = structuredClone(validDoc);
    doc.years[0].weeks[0].days[0].date = "2024-13-99";
    // 13 is invalid logically but regex only checks shape; check shape rejection:
    doc.years[0].weeks[0].days[0].date = "not-a-date";
    expect(() => documentSchema.parse(doc)).toThrow();
  });

  it("rejects a missing required field", () => {
    const doc = structuredClone(validDoc) as unknown as Record<string, unknown>;
    delete (doc as { username?: string }).username;
    expect(() => documentSchema.parse(doc)).toThrow();
  });
});
