// Package utils are utility functions for the GitHub Skyline project
package utils //nolint:revive // package name is appropriate for this internal module

import (
	"fmt"
	"strconv"
	"strings"
	"time"
)

// Constants for GitHub launch year and default output file format
const (
	githubLaunchYear     = 2008
	outputFileFormat     = "%s-%s-github-skyline.stl"
	outputJSONFileFormat = "%s-%s-github-skyline.json"
)

// ParseYearRange parses whether a year is a single year or a range of years.
func ParseYearRange(yearRange string) (startYear, endYear int, err error) {
	if strings.Contains(yearRange, "-") {
		parts := strings.Split(yearRange, "-")
		if len(parts) != 2 {
			return 0, 0, fmt.Errorf("invalid year range format")
		}
		startYear, err = strconv.Atoi(parts[0])
		if err != nil {
			return 0, 0, err
		}
		endYear, err = strconv.Atoi(parts[1])
		if err != nil {
			return 0, 0, err
		}
	} else {
		year, err := strconv.Atoi(yearRange)
		if err != nil {
			return 0, 0, err
		}
		startYear, endYear = year, year
	}
	return startYear, endYear, validateYearRange(startYear, endYear)
}

// validateYearRange checks if the years are within the range
// of GitHub's launch year to the current year and if
// the start year is not greater than the end year.
func validateYearRange(startYear, endYear int) error {
	currentYear := time.Now().Year()
	if startYear < githubLaunchYear || endYear > currentYear {
		return fmt.Errorf("years must be between %d and %d", githubLaunchYear, currentYear)
	}
	if startYear > endYear {
		return fmt.Errorf("start year cannot be after end year")
	}
	return nil
}

// FormatYearRange returns a formatted string representation of the year range
func FormatYearRange(startYear, endYear int) string {
	if startYear == endYear {
		return fmt.Sprintf("%d", startYear)
	}
	// Use YYYY-YY format for multi-year ranges
	return fmt.Sprintf("%04d-%02d", startYear, endYear%100)
}

// GenerateOutputFilename creates a consistent filename for the STL output
func GenerateOutputFilename(user string, startYear, endYear int, output string) string {
	if output != "" {
		// Ensure the filename ends with .stl
		if !strings.HasSuffix(strings.ToLower(output), ".stl") {
			return output + ".stl"
		}
		return output
	}
	yearStr := FormatYearRange(startYear, endYear)
	return fmt.Sprintf(outputFileFormat, user, yearStr)
}

// GenerateJSONFilename creates a consistent filename for the JSON export.
//
// Behavior:
//   - If output is empty, returns "{user}-{yearRange}-github-skyline.json".
//   - If output already ends with ".json" (case-insensitive), returns it
//     unchanged (idempotent).
//   - If output ends with ".stl" (case-insensitive), replaces that suffix
//     with ".json" so an `--output foo.stl` produces a sibling `foo.json`.
//   - Otherwise appends ".json" verbatim (e.g. `foo` → `foo.json`,
//     `foo.bar` → `foo.bar.json`).
func GenerateJSONFilename(user string, startYear, endYear int, output string) string {
	if output == "" {
		yearStr := FormatYearRange(startYear, endYear)
		return fmt.Sprintf(outputJSONFileFormat, user, yearStr)
	}
	lower := strings.ToLower(output)
	switch {
	case strings.HasSuffix(lower, ".json"):
		return output
	case strings.HasSuffix(lower, ".stl"):
		return output[:len(output)-len(".stl")] + ".json"
	default:
		return output + ".json"
	}
}
