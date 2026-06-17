import { describe, expect, it } from "vitest";
import {
  buildGoArgs,
  defaultJsonOutPath,
  parseRenderUserArgs,
  type RenderUserArgs,
} from "../../scripts/render-user";

function yearArgs(): RenderUserArgs {
  return {
    user: "octocat",
    year: 2025,
    full: false,
    theme: "dark",
    resolution: "4k",
    out: null,
    maxDurationSeconds: 180,
    jsonOut: null,
    keepJson: false,
  };
}

describe("parseRenderUserArgs", () => {
  it("parses single-year mode defaults", () => {
    const a = parseRenderUserArgs(["--user", "@mona", "--year", "2025"]);
    expect(a.user).toBe("mona");
    expect(a.year).toBe(2025);
    expect(a.full).toBe(false);
    expect(a.theme).toBe("dark");
    expect(a.resolution).toBe("4k");
    expect(a.maxDurationSeconds).toBe(180);
  });

  it("parses full-history mode with overrides", () => {
    const a = parseRenderUserArgs([
      "--user",
      "mona",
      "--full",
      "--theme",
      "light",
      "--resolution",
      "1080p",
      "--max-duration",
      "90",
      "--json-out",
      "/tmp/out.json",
      "--out",
      "video/out/custom.mp4",
      "--keep-json",
    ]);
    expect(a.full).toBe(true);
    expect(a.year).toBeNull();
    expect(a.theme).toBe("light");
    expect(a.resolution).toBe("1080p");
    expect(a.maxDurationSeconds).toBe(90);
    expect(a.jsonOut).toBe("/tmp/out.json");
    expect(a.out).toBe("video/out/custom.mp4");
    expect(a.keepJson).toBe(true);
  });

  it("rejects missing mode", () => {
    expect(() => parseRenderUserArgs(["--user", "mona"])).toThrow(
      /exactly one of --year or --full/,
    );
  });

  it("rejects conflicting mode flags", () => {
    expect(() =>
      parseRenderUserArgs(["--user", "mona", "--year", "2025", "--full"]),
    ).toThrow(/exactly one of --year or --full/);
  });
});

describe("wrapper helpers", () => {
  it("builds go args for year mode", () => {
    const args = buildGoArgs(yearArgs(), "/tmp/a.json");
    expect(args).toEqual([
      "run",
      ".",
      "--user",
      "octocat",
      "--json",
      "--art-only",
      "--year",
      "2025",
      "--output",
      "/tmp/a.json",
    ]);
  });

  it("builds go args for full mode", () => {
    const a = { ...yearArgs(), full: true, year: null };
    const args = buildGoArgs(a, "/tmp/b.json");
    expect(args).toEqual([
      "run",
      ".",
      "--user",
      "octocat",
      "--json",
      "--art-only",
      "--full",
      "--output",
      "/tmp/b.json",
    ]);
  });

  it("generates a temp JSON path containing user + scope", () => {
    const pYear = defaultJsonOutPath(yearArgs());
    expect(pYear).toMatch(/gh-skyline-octocat-2025-\d+\.json$/);
    const pFull = defaultJsonOutPath({ ...yearArgs(), full: true, year: null });
    expect(pFull).toMatch(/gh-skyline-octocat-full-\d+\.json$/);
  });
});

