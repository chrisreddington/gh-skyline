package cmd

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"time"

	"github.com/github/gh-skyline/cmd/skyline"
	"github.com/github/gh-skyline/internal/utils"
	"github.com/spf13/cobra"
)

var githubLoginPattern = regexp.MustCompile(`^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$`)

// videoOptions stores CLI flags for the `gh skyline video` subcommand.
type videoOptions struct {
	yearRange  string
	user       string
	theme      string
	resolution string
	output     string
	jsonOut    string
	keepJSON   bool
}

// initVideoCommand registers the `video` subcommand on the root command.
func initVideoCommand(root *cobra.Command) {
	opts := videoOptions{}
	cmd := &cobra.Command{
		Use:   "video",
		Short: "Generate a single-year skyline MP4 fly-through",
		Long: `Generate a skyline MP4 by exporting contribution data as JSON and then
rendering it via the Remotion project under ./video.

Currently, only single-year video renders are supported via this command.
Multi-year video support will follow.

Examples:
  gh skyline video --user mona --year 2025
  gh skyline video --user mona --year 2025 --output out/mona-2025.mp4`,
		RunE: func(_ *cobra.Command, _ []string) error {
			return runVideoCommand(opts)
		},
	}

	flags := cmd.Flags()
	flags.StringVarP(&opts.yearRange, "year", "y", fmt.Sprintf("%d", time.Now().Year()), "Year to render (single year only, e.g., 2025)")
	flags.StringVarP(&opts.user, "user", "u", "", "GitHub username (optional, defaults to authenticated user)")
	flags.StringVar(&opts.theme, "theme", "dark", "Video theme: dark|light")
	flags.StringVar(&opts.resolution, "resolution", "4k", "Video resolution: 4k|1080p")
	flags.StringVarP(&opts.output, "output", "o", "", "Output MP4 path (optional)")
	flags.StringVar(&opts.jsonOut, "json-out", "", "Persist intermediate JSON export at this path")
	flags.BoolVar(&opts.keepJSON, "keep-json", false, "Keep temp JSON export (when --json-out is omitted)")

	root.AddCommand(cmd)
}

// runVideoCommand executes the skyline video flow: JSON export then MP4 render.
func runVideoCommand(opts videoOptions) error {
	if err := validateVideoOptions(opts); err != nil {
		return err
	}

	startYear, endYear, err := utils.ParseYearRange(opts.yearRange)
	if err != nil {
		return fmt.Errorf("invalid year range: %w", err)
	}
	if err := validateSingleYearSelection(startYear, endYear); err != nil {
		return err
	}

	jsonPath, cleanup, err := resolveJSONExportPath(opts, startYear, endYear)
	if err != nil {
		return err
	}
	defer cleanup()

	if err := skyline.GenerateSkyline(startYear, endYear, opts.user, false, jsonPath, true, true); err != nil {
		return err
	}

	videoDir, err := findVideoDir()
	if err != nil {
		return err
	}

	if opts.output != "" {
		opts.output, err = resolveOutputPath(opts.output)
		if err != nil {
			return err
		}
	}

	renderArgs := buildRenderArgs(jsonPath, opts)
	cmd := exec.Command("npm", renderArgs...)
	cmd.Dir = videoDir
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("video render failed: %w (hint: run `cd %s && npm install`)", err, videoDir)
	}
	return nil
}

// validateSingleYearSelection enforces the current single-year-only video scope.
func validateSingleYearSelection(startYear, endYear int) error {
	if startYear != endYear {
		return fmt.Errorf("multi-year video is not supported yet; pass a single --year value")
	}
	return nil
}

// resolveOutputPath resolves --output to an absolute path.
func resolveOutputPath(path string) (string, error) {
	abs, err := filepath.Abs(path)
	if err != nil {
		return "", fmt.Errorf("resolve --output: %w", err)
	}
	return abs, nil
}

// validateVideoOptions validates flags for `gh skyline video`.
func validateVideoOptions(opts videoOptions) error {
	if opts.user != "" && !githubLoginPattern.MatchString(opts.user) {
		return fmt.Errorf("--user must be a valid GitHub login")
	}
	if opts.theme != "dark" && opts.theme != "light" {
		return fmt.Errorf("--theme must be one of: dark, light")
	}
	if opts.resolution != "4k" && opts.resolution != "1080p" {
		return fmt.Errorf("--resolution must be one of: 4k, 1080p")
	}
	return nil
}

// resolveJSONExportPath returns the JSON export path plus a cleanup callback.
func resolveJSONExportPath(opts videoOptions, startYear, endYear int) (string, func(), error) {
	if opts.jsonOut != "" {
		abs, err := filepath.Abs(opts.jsonOut)
		if err != nil {
			return "", nil, fmt.Errorf("resolve --json-out: %w", err)
		}
		return abs, func() {}, nil
	}

	user := opts.user
	if user == "" {
		user = "user"
	}
	pattern := fmt.Sprintf("gh-skyline-%s-%s-*.json", user, utils.FormatYearRange(startYear, endYear))
	f, err := os.CreateTemp("", pattern)
	if err != nil {
		return "", nil, fmt.Errorf("create temp json: %w", err)
	}
	path := f.Name()
	if err := f.Close(); err != nil {
		return "", nil, fmt.Errorf("close temp json: %w", err)
	}
	cleanup := func() {
		if !opts.keepJSON {
			_ = os.Remove(path)
		}
	}
	return path, cleanup, nil
}

// findVideoDir locates the `video/` project directory.
func findVideoDir() (string, error) {
	wd, err := os.Getwd()
	if err != nil {
		return "", fmt.Errorf("get working directory: %w", err)
	}
	candidate := filepath.Join(wd, "video")
	if st, err := os.Stat(candidate); err == nil && st.IsDir() {
		return candidate, nil
	}
	return "", fmt.Errorf("video directory not found at %s (run from repo root)", candidate)
}

// buildRenderArgs builds the npm args for `npm run render -- ...`.
func buildRenderArgs(jsonPath string, opts videoOptions) []string {
	args := []string{
		"run", "render", "--",
		jsonPath,
		"--theme", opts.theme,
		"--resolution", opts.resolution,
	}
	if opts.output != "" {
		args = append(args, "--out", opts.output)
	}
	return args
}
