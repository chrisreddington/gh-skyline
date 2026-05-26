import { describe, it, expect } from "vitest";
import path from "node:path";
import {
  parseArgs,
  pickComposition,
  defaultOutputPath,
} from "../../scripts/render";
import type { SkylineDocument } from "../schema";

function docWithYears(years: number[]): SkylineDocument {
  return {
    schemaVersion: 1,
    username: "tester",
    generatedAt: "2026-01-01T00:00:00Z",
    years: years.map((y) => ({
      year: y,
      totalContributions: 0,
      weeks: [],
      stats: null,
    })),
  };
}

describe("parseArgs", () => {
  it("returns defaults when only input is provided", () => {
    const a = parseArgs(["fixtures/sample-year.json"]);
    expect(a.input).toBe("fixtures/sample-year.json");
    expect(a.theme).toBe("dark");
    expect(a.resolution).toBe("4k");
    expect(a.out).toBeNull();
    expect(a.maxDurationSeconds).toBe(180);
  });

  it("parses all flags", () => {
    const a = parseArgs([
      "input.json",
      "--theme",
      "light",
      "--resolution",
      "1080p",
      "--out",
      "out/foo.mp4",
      "--max-duration",
      "90",
    ]);
    expect(a.theme).toBe("light");
    expect(a.resolution).toBe("1080p");
    expect(a.out).toBe("out/foo.mp4");
    expect(a.maxDurationSeconds).toBe(90);
  });

  it("rejects unknown theme", () => {
    expect(() => parseArgs(["x.json", "--theme", "neon"])).toThrow(/--theme/);
  });

  it("rejects unknown resolution", () => {
    expect(() => parseArgs(["x.json", "--resolution", "8k"])).toThrow(
      /--resolution/,
    );
  });

  it("rejects non-positive max-duration", () => {
    expect(() => parseArgs(["x.json", "--max-duration", "-1"])).toThrow();
    expect(() => parseArgs(["x.json", "--max-duration", "0"])).toThrow();
    expect(() => parseArgs(["x.json", "--max-duration", "abc"])).toThrow();
  });

  it("rejects unknown flags", () => {
    expect(() => parseArgs(["x.json", "--zoom", "5"])).toThrow(/unknown flag/);
  });

  it("rejects multiple positional arguments", () => {
    expect(() => parseArgs(["a.json", "b.json"])).toThrow(/positional/);
  });
});

describe("pickComposition", () => {
  it("returns SkylineYear for exactly one year", () => {
    expect(pickComposition(docWithYears([2025]))).toBe("SkylineYear");
  });

  it("returns SkylineFull for two or more years", () => {
    expect(pickComposition(docWithYears([2024, 2025]))).toBe("SkylineFull");
    expect(pickComposition(docWithYears([2020, 2021, 2022, 2023]))).toBe(
      "SkylineFull",
    );
  });

  it("throws for an empty years array", () => {
    expect(() => pickComposition(docWithYears([]))).toThrow();
  });
});

describe("defaultOutputPath", () => {
  it("uses a single year for one-year docs", () => {
    const p = defaultOutputPath(docWithYears([2025]), "out");
    expect(p).toBe(path.join("out", "tester-2025-flythrough.mp4"));
  });

  it("uses a min-max range for multi-year docs", () => {
    const p = defaultOutputPath(docWithYears([2024, 2022, 2023]), "out");
    expect(p).toBe(path.join("out", "tester-2022-2024-flythrough.mp4"));
  });
});
