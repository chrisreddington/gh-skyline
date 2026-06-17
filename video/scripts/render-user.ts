/**
 * One-command wrapper for user/year video generation.
 *
 * Usage:
 *   tsx scripts/render-user.ts --user <login> (--year <YYYY> | --full)
 *     [--theme dark|light] [--resolution 4k|1080p]
 *     [--out path.mp4] [--max-duration <seconds>]
 *     [--json-out /path/file.json] [--keep-json]
 *
 * Flow:
 *   1) Run `go run . --json --art-only` at repo root to export JSON.
 *   2) Invoke renderVideo() with that JSON path.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";
import { spawnSync } from "node:child_process";

import { renderVideo } from "./render";

export interface RenderUserArgs {
  user: string | null;
  year: number | null;
  full: boolean;
  theme: "dark" | "light";
  resolution: "4k" | "1080p";
  out: string | null;
  maxDurationSeconds: number;
  jsonOut: string | null;
  keepJson: boolean;
}

class ExitOk extends Error {
  readonly isExitOk = true;
}

/**
 * Parse wrapper CLI args.
 */
export function parseRenderUserArgs(argv: string[]): RenderUserArgs {
  const out: RenderUserArgs = {
    user: null,
    year: null,
    full: false,
    theme: "dark",
    resolution: "4k",
    out: null,
    maxDurationSeconds: 180,
    jsonOut: null,
    keepJson: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--user") {
      const v = argv[++i];
      if (!v) throw new Error("--user requires a value");
      out.user = v.replace(/^@/, "");
    } else if (a === "--year") {
      const v = argv[++i];
      const n = Number(v);
      if (!Number.isInteger(n) || n < 2005 || n > 2100) {
        throw new Error("--year must be a 4-digit year in [2005, 2100]");
      }
      out.year = n;
    } else if (a === "--full") {
      out.full = true;
    } else if (a === "--theme") {
      const v = argv[++i];
      if (v !== "dark" && v !== "light") {
        throw new Error("--theme must be one of: dark, light");
      }
      out.theme = v;
    } else if (a === "--resolution") {
      const v = argv[++i];
      if (v !== "4k" && v !== "1080p") {
        throw new Error("--resolution must be one of: 4k, 1080p");
      }
      out.resolution = v;
    } else if (a === "--out") {
      const v = argv[++i];
      if (!v) throw new Error("--out requires a path");
      out.out = v;
    } else if (a === "--max-duration") {
      const v = argv[++i];
      const n = Number(v);
      if (!Number.isFinite(n) || n <= 0) {
        throw new Error("--max-duration must be a positive number");
      }
      out.maxDurationSeconds = n;
    } else if (a === "--json-out") {
      const v = argv[++i];
      if (!v) throw new Error("--json-out requires a path");
      out.jsonOut = v;
    } else if (a === "--keep-json") {
      out.keepJson = true;
    } else if (a === "--help" || a === "-h") {
      printHelp();
      throw new ExitOk();
    } else {
      throw new Error(`unknown flag: ${a}`);
    }
  }
  if (!out.user) throw new Error("--user is required");
  if (out.full && out.year !== null) {
    throw new Error("use exactly one of --year or --full");
  }
  if (!out.full && out.year === null) {
    throw new Error("use exactly one of --year or --full");
  }
  return out;
}

/**
 * Build default temporary JSON path for wrapper mode.
 */
export function defaultJsonOutPath(args: RenderUserArgs): string {
  const scope = args.full ? "full" : String(args.year);
  const stamp = Date.now();
  return path.join(os.tmpdir(), `gh-skyline-${args.user}-${scope}-${stamp}.json`);
}

/**
 * Build `go run` argv for JSON export.
 */
export function buildGoArgs(args: RenderUserArgs, jsonOutPath: string): string[] {
  const out = ["run", ".", "--user", args.user ?? "", "--json", "--art-only"];
  if (args.full) out.push("--full");
  else out.push("--year", String(args.year));
  out.push("--output", jsonOutPath);
  return out;
}

/**
 * Execute the one-command flow.
 */
export async function runRenderUser(args: RenderUserArgs): Promise<void> {
  const scriptDir = path.dirname(url.fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(scriptDir, "..", "..");
  const jsonOutPath = path.resolve(args.jsonOut ?? defaultJsonOutPath(args));
  const deleteTempJson = args.jsonOut === null && !args.keepJson;
  fs.mkdirSync(path.dirname(jsonOutPath), { recursive: true });

  const goArgs = buildGoArgs(args, jsonOutPath);
  console.log(`exporting skyline JSON: go ${goArgs.join(" ")}`);
  const goResult = spawnSync("go", goArgs, {
    cwd: repoRoot,
    stdio: "inherit",
  });
  if (goResult.status !== 0) {
    throw new Error(`go export failed with exit code ${goResult.status ?? "unknown"}`);
  }

  try {
    await renderVideo({
      input: jsonOutPath,
      theme: args.theme,
      resolution: args.resolution,
      out: args.out,
      maxDurationSeconds: args.maxDurationSeconds,
    });
  } finally {
    if (deleteTempJson && fs.existsSync(jsonOutPath)) {
      fs.unlinkSync(jsonOutPath);
    }
  }
}

function printHelp(): void {
  console.log(
    [
      "Usage: tsx scripts/render-user.ts --user <login> (--year <YYYY> | --full) [options]",
      "",
      "Options:",
      "  --theme dark|light          Colour theme (default: dark)",
      "  --resolution 4k|1080p       Output resolution (default: 4k)",
      "  --out <path>                Output MP4 path",
      "  --max-duration <seconds>    SkylineFull cap (default: 180)",
      "  --json-out <path>           Persist JSON export at this path",
      "  --keep-json                 Keep temp JSON export when --json-out is omitted",
      "  -h, --help                  Show this help",
    ].join("\n"),
  );
}

async function main(): Promise<void> {
  let parsed: RenderUserArgs;
  try {
    parsed = parseRenderUserArgs(process.argv.slice(2));
  } catch (e) {
    if (e instanceof ExitOk) return;
    console.error(`error: ${(e as Error).message}`);
    printHelp();
    process.exit(2);
    return;
  }
  await runRenderUser(parsed);
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === url.fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

