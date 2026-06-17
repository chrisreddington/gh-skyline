package cmd

import (
	"os"
	"path/filepath"
	"testing"
)

func TestValidateVideoOptions(t *testing.T) {
	t.Parallel()

	ok := videoOptions{theme: "dark", resolution: "4k", maxDurationSeconds: 180}
	if err := validateVideoOptions(ok); err != nil {
		t.Fatalf("validateVideoOptions() unexpected error: %v", err)
	}

	badTheme := ok
	badTheme.theme = "neon"
	if err := validateVideoOptions(badTheme); err == nil {
		t.Fatal("validateVideoOptions() expected error for invalid theme")
	}

	badRes := ok
	badRes.resolution = "8k"
	if err := validateVideoOptions(badRes); err == nil {
		t.Fatal("validateVideoOptions() expected error for invalid resolution")
	}

	badDuration := ok
	badDuration.maxDurationSeconds = 0
	if err := validateVideoOptions(badDuration); err == nil {
		t.Fatal("validateVideoOptions() expected error for non-positive max duration")
	}

	badUser := ok
	badUser.user = "../../evil"
	if err := validateVideoOptions(badUser); err == nil {
		t.Fatal("validateVideoOptions() expected error for invalid user")
	}
}

func TestBuildRenderArgs(t *testing.T) {
	t.Parallel()

	opts := videoOptions{
		theme:              "light",
		resolution:         "1080p",
		maxDurationSeconds: 90,
		output:             "video/out/custom.mp4",
	}
	args := buildRenderArgs("/tmp/input.json", opts)
	want := []string{
		"run", "render", "--",
		"/tmp/input.json",
		"--theme", "light",
		"--resolution", "1080p",
		"--max-duration", "90",
		"--out", "video/out/custom.mp4",
	}
	if len(args) != len(want) {
		t.Fatalf("buildRenderArgs() length = %d, want %d (%v)", len(args), len(want), args)
	}
	for i := range want {
		if args[i] != want[i] {
			t.Fatalf("buildRenderArgs()[%d] = %q, want %q", i, args[i], want[i])
		}
	}
}

func TestResolveJSONExportPath(t *testing.T) {
	t.Parallel()

	opts := videoOptions{
		user:     "octocat",
		keepJSON: false,
	}
	path, cleanup, err := resolveJSONExportPath(opts, 2025, 2025)
	if err != nil {
		t.Fatalf("resolveJSONExportPath() unexpected error: %v", err)
	}
	if filepath.Ext(path) != ".json" {
		t.Fatalf("resolveJSONExportPath() path %q does not end with .json", path)
	}
	cleanup()
}

func TestResolveOutputPath(t *testing.T) {
	t.Parallel()

	rel := filepath.Join("video", "out", "test.mp4")
	got, err := resolveOutputPath(rel)
	if err != nil {
		t.Fatalf("resolveOutputPath() unexpected error: %v", err)
	}

	wd, err := os.Getwd()
	if err != nil {
		t.Fatalf("Getwd() unexpected error: %v", err)
	}
	want := filepath.Join(wd, rel)
	if got != want {
		t.Fatalf("resolveOutputPath() = %q, want %q", got, want)
	}
}
