# gh-skyline video

Remotion + React Three Fiber fly-through video renderer for the JSON export
produced by [`gh skyline --json`](../README.md#json-export).

Two compositions are registered:

| Composition    | Input                | Default duration | When picked                          |
| -------------- | -------------------- | ---------------- | ------------------------------------ |
| `SkylineYear`  | One `YearData`       | 30 s @ 30 fps    | JSON document with `years.length === 1` |
| `SkylineFull`  | Full `SkylineDocument` | up to 180 s @ 30 fps | JSON document with `years.length >= 2`  |

> `gh skyline video` currently supports single-year renders only. Use `npm run render` directly for multi-year `SkylineFull` experiments.
> The native command auto-installs `video` npm dependencies on first run.

Both default to 4 K (3840×2160). Switch with `--resolution 1080p` for faster
iteration.

## Prerequisites

- Node.js 20 or newer
- Roughly 250 MB of disk space for `node_modules`
- macOS / Linux / Windows. On first render Remotion downloads a Chrome
  Headless Shell (~95 MB) into the global cache.

## Setup

```sh
cd video
npm install
```

## Producing input JSON

Build and run `gh skyline` from the repo root to emit the JSON your video
consumes:

```sh
# Single year:
go run . --user <login> --year 2025 --json --art-only --output /tmp/skyline.json

# Full history (uses your join year through the current year):
go run . --user <login> --full --json --art-only --output /tmp/skyline-full.json
```

If you don't have Go set up, use the bundled fixtures under `video/fixtures/`
for development.

## Open the studio

```sh
npm run studio
```

The studio loads both compositions with the sample fixture JSON. Twiddle the
`theme` (`dark` / `light`), `resolution` (`4k` / `1080p`), and (for `SkylineFull`)
`maxDurationSeconds` props in the right-hand panel.

## Render an MP4

```sh
# Defaults to 4K, dark theme. Auto-picks SkylineYear vs SkylineFull.
npm run render -- /path/to/skyline.json

# Faster iteration at 1080p with a light theme:
npm run render -- /path/to/skyline.json --resolution 1080p --theme light

# Override the SkylineFull duration cap (seconds):
npm run render -- /path/to/skyline-full.json --max-duration 90

# Pick an explicit output path:
npm run render -- /path/to/skyline.json --out out/me-2025-flythrough.mp4
```

Defaults: outputs go to `video/out/{username}-{year-or-range}-flythrough.mp4`.
`out/` is gitignored.

### Native command wrapper

From the repository root:

```sh
gh skyline video --user <login> --year 2025 --resolution 1080p
```

This command orchestrates JSON export + Remotion render and bootstraps `video/node_modules` automatically when missing.

### CLI options

| Flag             | Values            | Default |
| ---------------- | ----------------- | ------- |
| `--theme`        | `dark`, `light`   | `dark`  |
| `--resolution`   | `4k`, `1080p`     | `4k`    |
| `--out`          | path to `.mp4`    | `out/{username}-{range}-flythrough.mp4` |
| `--max-duration` | positive seconds  | `180`   |
| `-h`, `--help`   | —                 | —       |

## Customising the experience

- **Palette / theme**: edit `src/scene/theme.ts`. Both palettes (`dark` and
  `light`) mirror GitHub's contribution graph; bar bucketing is computed per
  year from the in-year peak so quiet years still show variation.
- **Bar shape & geometry**: tweak constants in `src/utils/grid.ts`
  (`DEFAULT_CELL`, `DEFAULT_GAP`, `BAR_*`).
- **Per-year duration in `SkylineFull`**: change `DEFAULT_TIMING` in
  `src/utils/timing.ts`. The allocator is pure and well-covered by tests, so
  it's safe to retune.
- **Camera path**: keyframes are built in `src/compositions/SkylineYear.tsx`
  and `src/compositions/fullLayout.ts`. Frames are absolute within each
  composition.

## Tests

```sh
npm test          # vitest, pure helpers
npm run typecheck # tsc --noEmit
```

The unit tests cover the pure helpers (theme bucketing, timing allocation,
schema parsing, grid layout, CLI argument parsing, composition selection)
and do not require a render to run. Render verification is a manual step
because actual frame rendering is heavy.

## Troubleshooting

- **`Could not initialize OpenGL`** during render: try
  `Config.setChromiumOpenGlRenderer('swangle')` in `remotion.config.ts`.
  Some macOS configurations prefer SwiftShader-backed ANGLE for stability.
- **Slow / hangs on first render**: Remotion's first run downloads a Chrome
  Headless Shell (~95 MB). Subsequent renders reuse the cache.
- **`@remotion/three` peer warnings**: keep `three`, `@react-three/fiber`,
  `@react-three/drei`, and the Remotion family at their installed versions —
  bumping them piecemeal can break the WebGL bridge.

## Third-party assets

- `public/fonts/monasans-regular.ttf`
- `public/fonts/monasans-medium.ttf`

These are from [github/mona-sans](https://github.com/github/mona-sans), licensed under the SIL Open Font License v1.1. See [`public/fonts/OFL.txt`](./public/fonts/OFL.txt).

## Layout

```
video/
├── fixtures/        # Hand-authored sample JSON for dev
├── out/             # Rendered MP4s (gitignored)
├── scripts/
│   └── render.ts    # CLI wrapper around @remotion/bundler + renderMedia
└── src/
    ├── Root.tsx     # Composition registry
    ├── index.ts     # Remotion entrypoint
    ├── schema.ts    # Zod schemas mirroring the Phase 1 Go types
    ├── compositions/
    │   ├── SkylineYear.tsx
    │   └── SkylineFull.tsx
    ├── scene/       # R3F scene primitives (theme, mesh, camera, lighting, captions, highlights)
    ├── utils/       # Pure helpers (grid layout, timing allocator)
    └── __tests__/   # vitest unit tests
```
