/**
 * Render CLI: pure-ish wrapper around `@remotion/bundler` + `@remotion/renderer`.
 *
 * Usage:
 *   tsx scripts/render.ts <path-to-json> [--theme dark|light] [--resolution 4k|1080p]
 *                        [--out path.mp4] [--max-duration <seconds>]
 *
 * Composition selection:
 *   - years.length === 0 -> throws (nothing to render)
 *   - years.length === 1 -> SkylineYear (year[0] passed in)
 *   - years.length >= 2  -> SkylineFull (whole document)
 */
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";

import { documentSchema, type SkylineDocument } from "../src/schema";

interface CliOptions {
  input: string;
  theme: "dark" | "light";
  resolution: "4k" | "1080p";
  out: string | null;
  maxDurationSeconds: number;
}

export interface ParsedArgs {
  input: string | null;
  theme: "dark" | "light";
  resolution: "4k" | "1080p";
  out: string | null;
  maxDurationSeconds: number;
}

const VALID_THEMES = new Set(["dark", "light"]);
const VALID_RESOLUTIONS = new Set(["4k", "1080p"]);

/**
 * Parse argv (excluding node + script). Exported so unit tests can exercise
 * argument handling without spawning the CLI.
 */
export function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = {
    input: null,
    theme: "dark",
    resolution: "4k",
    out: null,
    maxDurationSeconds: 180,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--theme") {
      const v = argv[++i];
      if (!v || !VALID_THEMES.has(v)) {
        throw new Error(`--theme must be one of ${[...VALID_THEMES].join(", ")}`);
      }
      out.theme = v as "dark" | "light";
    } else if (a === "--resolution") {
      const v = argv[++i];
      if (!v || !VALID_RESOLUTIONS.has(v)) {
        throw new Error(
          `--resolution must be one of ${[...VALID_RESOLUTIONS].join(", ")}`,
        );
      }
      out.resolution = v as "4k" | "1080p";
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
    } else if (a === "--help" || a === "-h") {
      printHelp();
      throw new ExitOk();
    } else if (a && !a.startsWith("--")) {
      if (out.input !== null) {
        throw new Error(`unexpected positional argument: ${a}`);
      }
      out.input = a;
    } else {
      throw new Error(`unknown flag: ${a}`);
    }
  }
  return out;
}

class ExitOk extends Error {
  readonly isExitOk = true;
}

/** Pick the composition id for a parsed document. */
export function pickComposition(
  doc: SkylineDocument,
): "SkylineYear" | "SkylineFull" {
  if (doc.years.length === 0) {
    throw new Error("document has no years; nothing to render");
  }
  return doc.years.length === 1 ? "SkylineYear" : "SkylineFull";
}

/** Compute the default output path under out/{username}-{range}-flythrough.mp4. */
export function defaultOutputPath(doc: SkylineDocument, outDir = "out"): string {
  const ys = doc.years.map((y) => y.year).sort((a, b) => a - b);
  const range = ys.length === 1 ? String(ys[0]) : `${ys[0]}-${ys[ys.length - 1]}`;
  return path.join(outDir, `${doc.username}-${range}-flythrough.mp4`);
}

function readDocument(input: string): SkylineDocument {
  const abs = path.resolve(input);
  if (!fs.existsSync(abs)) {
    throw new Error(`input file not found: ${abs}`);
  }
  const raw = JSON.parse(fs.readFileSync(abs, "utf8"));
  return documentSchema.parse(raw);
}

async function run(opts: CliOptions): Promise<void> {
  const doc = readDocument(opts.input);
  const compositionId = pickComposition(doc);
  const outPath = opts.out
    ? path.resolve(opts.out)
    : path.resolve(defaultOutputPath(doc));
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  const projectRoot = path.resolve(
    path.dirname(url.fileURLToPath(import.meta.url)),
    "..",
  );
  const entryPoint = path.join(projectRoot, "src", "index.ts");

  console.log(`bundling Remotion entry: ${entryPoint}`);
  const serveUrl = await bundle({ entryPoint });

  const inputProps =
    compositionId === "SkylineYear"
      ? {
          data: doc.years[0],
          username: doc.username,
          theme: opts.theme,
          resolution: opts.resolution,
        }
      : {
          data: doc,
          theme: opts.theme,
          resolution: opts.resolution,
          maxDurationSeconds: opts.maxDurationSeconds,
        };

  console.log(`selecting composition: ${compositionId}`);
  const composition = await selectComposition({
    serveUrl,
    id: compositionId,
    inputProps,
  });

  console.log(
    `rendering ${composition.width}x${composition.height} @${composition.fps}fps, ` +
      `${composition.durationInFrames} frames -> ${outPath}`,
  );
  await renderMedia({
    composition,
    serveUrl,
    codec: "h264",
    outputLocation: outPath,
    inputProps,
    chromiumOptions: { gl: "angle" },
    crf: 18,
  });
  console.log(`done: ${outPath}`);
}

function printHelp(): void {
  console.log(
    [
      "Usage: tsx scripts/render.ts <path-to-json> [options]",
      "",
      "Options:",
      "  --theme dark|light          Colour theme (default: dark)",
      "  --resolution 4k|1080p       Output resolution (default: 4k)",
      "  --out <path>                Output MP4 path",
      "  --max-duration <seconds>    SkylineFull cap (default: 180)",
      "  -h, --help                  Show this help",
    ].join("\n"),
  );
}

async function main(): Promise<void> {
  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (e) {
    if (e instanceof ExitOk) return;
    console.error(`error: ${(e as Error).message}`);
    printHelp();
    process.exit(2);
  }
  if (!parsed.input) {
    console.error("error: missing input JSON path");
    printHelp();
    process.exit(2);
  }
  await run({
    input: parsed.input,
    theme: parsed.theme,
    resolution: parsed.resolution,
    out: parsed.out,
    maxDurationSeconds: parsed.maxDurationSeconds,
  });
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === url.fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
