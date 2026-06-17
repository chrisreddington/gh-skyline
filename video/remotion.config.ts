import { Config } from "@remotion/cli/config";

// ANGLE is the recommended Chromium GL renderer for Three.js content per the
// Remotion docs; it gives consistent results across macOS / Linux / Windows.
// Some macOS configurations may need to switch to "swangle" for stability —
// see video/README.md.
Config.setChromiumOpenGlRenderer("angle");

Config.setVideoImageFormat("jpeg");
Config.setEntryPoint("src/index.ts");
