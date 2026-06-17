package cmd

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestValidateVideoOptions(t *testing.T) {
	t.Parallel()

	ok := videoOptions{theme: "dark", resolution: "4k"}
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

	badUser := ok
	badUser.user = "../../evil"
	if err := validateVideoOptions(badUser); err == nil {
		t.Fatal("validateVideoOptions() expected error for invalid user")
	}
}

func TestBuildRenderArgs(t *testing.T) {
	t.Parallel()

	opts := videoOptions{
		theme:      "light",
		resolution: "1080p",
		output:     "video/out/custom.mp4",
	}
	args := buildRenderArgs("/tmp/input.json", opts)
	want := []string{
		"run", "render", "--",
		"/tmp/input.json",
		"--theme", "light",
		"--resolution", "1080p",
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

func TestValidateSingleYearSelection(t *testing.T) {
	t.Parallel()

	if err := validateSingleYearSelection(2025, 2025); err != nil {
		t.Fatalf("validateSingleYearSelection() unexpected error: %v", err)
	}
	if err := validateSingleYearSelection(2024, 2025); err == nil {
		t.Fatal("validateSingleYearSelection() expected error for year range")
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

func TestNeedsNPMInstall(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	install, err := needsNPMInstall(dir)
	if err != nil {
		t.Fatalf("needsNPMInstall() unexpected error: %v", err)
	}
	if !install {
		t.Fatal("needsNPMInstall() expected true when node_modules is missing")
	}

	nodeModulesDir := filepath.Join(dir, "node_modules")
	if err := os.Mkdir(nodeModulesDir, 0o755); err != nil {
		t.Fatalf("Mkdir(node_modules) unexpected error: %v", err)
	}
	install, err = needsNPMInstall(dir)
	if err != nil {
		t.Fatalf("needsNPMInstall() unexpected error: %v", err)
	}
	if install {
		t.Fatal("needsNPMInstall() expected false when node_modules exists")
	}
}

func TestBuildNPMInstallArgs(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	args, err := buildNPMInstallArgs(dir)
	if err != nil {
		t.Fatalf("buildNPMInstallArgs() unexpected error: %v", err)
	}
	wantInstall := []string{"install", "--no-audit", "--no-fund"}
	for i := range wantInstall {
		if args[i] != wantInstall[i] {
			t.Fatalf("buildNPMInstallArgs()[%d] = %q, want %q", i, args[i], wantInstall[i])
		}
	}

	lockPath := filepath.Join(dir, "package-lock.json")
	if err := os.WriteFile(lockPath, []byte("{}"), 0o644); err != nil {
		t.Fatalf("WriteFile(package-lock.json) unexpected error: %v", err)
	}
	args, err = buildNPMInstallArgs(dir)
	if err != nil {
		t.Fatalf("buildNPMInstallArgs() unexpected error: %v", err)
	}
	wantCI := []string{"ci", "--no-audit", "--no-fund"}
	for i := range wantCI {
		if args[i] != wantCI[i] {
			t.Fatalf("buildNPMInstallArgs()[%d] = %q, want %q", i, args[i], wantCI[i])
		}
	}
}

func TestParseInstallApproval(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name   string
		input  string
		expect bool
	}{
		{name: "lowercase y", input: "y\n", expect: true},
		{name: "uppercase yes", input: "YES\n", expect: true},
		{name: "whitespace no", input: "  n  \n", expect: false},
		{name: "blank defaults no", input: "\n", expect: false},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got := parseInstallApproval(tt.input)
			if got != tt.expect {
				t.Fatalf("parseInstallApproval(%q) = %v, want %v", tt.input, got, tt.expect)
			}
		})
	}
}

func TestRequestInstallApproval(t *testing.T) {
	t.Parallel()

	videoDir := "/tmp/video"
	installArgs := []string{"ci", "--no-audit", "--no-fund"}

	var prompt bytes.Buffer
	approved, err := requestInstallApproval(strings.NewReader("n\n"), &prompt, videoDir, installArgs)
	if err != nil {
		t.Fatalf("requestInstallApproval() unexpected error: %v", err)
	}
	if approved {
		t.Fatal("requestInstallApproval() expected false for declined input")
	}

	output := prompt.String()
	if !strings.Contains(output, "npm ci --no-audit --no-fund") {
		t.Fatalf("prompt missing install command: %q", output)
	}
	if !strings.Contains(output, filepath.Join(videoDir, "node_modules")) {
		t.Fatalf("prompt missing install location: %q", output)
	}
	if !strings.Contains(output, "Proceed? [y/N]:") {
		t.Fatalf("prompt missing confirmation text: %q", output)
	}
}
