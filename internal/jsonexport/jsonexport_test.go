package jsonexport

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/github/gh-skyline/internal/types"
)

// makeResponse constructs a *ContributionsResponse with the given total
// and a weeks/days grid built from a flat list of (date, count) pairs
// grouped into weeks of 7 days. dateCount entries should be ordered
// chronologically.
func makeResponse(total int, weeks [][]types.ContributionDay) *types.ContributionsResponse {
	resp := &types.ContributionsResponse{}
	resp.User.Login = "testuser"
	resp.User.ContributionsCollection.ContributionCalendar.TotalContributions = total
	w := make([]struct {
		ContributionDays []types.ContributionDay `json:"contributionDays"`
	}, len(weeks))
	for i, wk := range weeks {
		w[i].ContributionDays = wk
	}
	resp.User.ContributionsCollection.ContributionCalendar.Weeks = w
	return resp
}

// makeYearWeeks builds a full year of weeks (each 7 days) for `year`
// starting on the Sunday on or before Jan 1. countFn picks the count
// per date. Adjacent-year padding days are included verbatim.
func makeYearWeeks(year int, countFn func(d time.Time) int) [][]types.ContributionDay {
	// Find Sunday on or before Jan 1 (GitHub-style week alignment).
	start := time.Date(year, 1, 1, 0, 0, 0, 0, time.UTC)
	for start.Weekday() != time.Sunday {
		start = start.AddDate(0, 0, -1)
	}
	// Find Saturday on or after Dec 31.
	end := time.Date(year, 12, 31, 0, 0, 0, 0, time.UTC)
	for end.Weekday() != time.Saturday {
		end = end.AddDate(0, 0, 1)
	}
	var weeks [][]types.ContributionDay
	for cur := start; !cur.After(end); {
		days := make([]types.ContributionDay, 0, 7)
		for i := 0; i < 7; i++ {
			d := cur.AddDate(0, 0, i)
			days = append(days, types.ContributionDay{
				Date:              d.Format("2006-01-02"),
				ContributionCount: countFn(d),
			})
		}
		weeks = append(weeks, days)
		cur = cur.AddDate(0, 0, 7)
	}
	return weeks
}

func TestBuildSingleYearHappyPath(t *testing.T) {
	weeks := makeYearWeeks(2025, func(d time.Time) int {
		if d.Year() != 2025 {
			return 0
		}
		if d.Month() == time.March && d.Day() == 14 {
			return 42
		}
		if d.Month() == time.January && d.Day() >= 3 && d.Day() <= 5 {
			return 2
		}
		return 0
	})
	resp := makeResponse(46, weeks)

	now := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	doc, err := Build([]*types.ContributionsResponse{resp}, []int{2025}, "testuser", now)
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}
	if doc.SchemaVersion != 1 {
		t.Errorf("SchemaVersion = %d, want 1", doc.SchemaVersion)
	}
	if doc.Username != "testuser" {
		t.Errorf("Username = %q, want testuser", doc.Username)
	}
	if !doc.GeneratedAt.Equal(now) {
		t.Errorf("GeneratedAt = %v, want %v", doc.GeneratedAt, now)
	}
	if len(doc.Years) != 1 {
		t.Fatalf("len(Years) = %d, want 1", len(doc.Years))
	}
	y := doc.Years[0]
	if y.Year != 2025 || y.TotalContributions != 46 {
		t.Errorf("Year=%d Total=%d, want 2025/46", y.Year, y.TotalContributions)
	}
	if y.Stats == nil || y.Stats.PeakDay == nil {
		t.Fatalf("expected stats with peak day")
	}
	if y.Stats.PeakDay.Date != "2025-03-14" || y.Stats.PeakDay.Count != 42 {
		t.Errorf("PeakDay = %+v, want 2025-03-14/42", y.Stats.PeakDay)
	}
	if y.Stats.FirstContribution.Date != "2025-01-03" {
		t.Errorf("FirstContribution = %+v", y.Stats.FirstContribution)
	}
	if y.Stats.LastContribution.Date != "2025-03-14" {
		t.Errorf("LastContribution = %+v", y.Stats.LastContribution)
	}
	if y.Stats.LongestStreak == nil || y.Stats.LongestStreak.Length != 3 {
		t.Errorf("LongestStreak = %+v, want length 3 (Jan 3-5)", y.Stats.LongestStreak)
	}
	if y.Stats.LongestStreak.Start != "2025-01-03" || y.Stats.LongestStreak.End != "2025-01-05" {
		t.Errorf("LongestStreak dates = %+v", y.Stats.LongestStreak)
	}

	// Spot-check weekday: Jan 1 2025 is a Wednesday (3).
	for _, w := range y.Weeks {
		for _, d := range w.Days {
			if d.Date == "2025-01-01" && d.Weekday != int(time.Wednesday) {
				t.Errorf("2025-01-01 weekday = %d, want %d", d.Weekday, int(time.Wednesday))
			}
		}
	}
}

func TestBuildMultiYearAscendingOrder(t *testing.T) {
	r2024 := makeResponse(1, makeYearWeeks(2024, func(d time.Time) int {
		if d.Year() == 2024 && d.Month() == time.June && d.Day() == 1 {
			return 5
		}
		return 0
	}))
	r2025 := makeResponse(2, makeYearWeeks(2025, func(d time.Time) int {
		if d.Year() == 2025 && d.Month() == time.June && d.Day() == 1 {
			return 7
		}
		return 0
	}))
	// Provide them in reverse order to confirm Build sorts ascending.
	doc, err := Build([]*types.ContributionsResponse{r2025, r2024}, []int{2025, 2024}, "u", time.Now())
	if err != nil {
		t.Fatalf("Build error: %v", err)
	}
	if len(doc.Years) != 2 || doc.Years[0].Year != 2024 || doc.Years[1].Year != 2025 {
		t.Errorf("years out of order: got %d,%d", doc.Years[0].Year, doc.Years[1].Year)
	}
}

func TestBuildLeapYear(t *testing.T) {
	weeks := makeYearWeeks(2024, func(_ time.Time) int { return 0 })
	resp := makeResponse(0, weeks)
	doc, err := Build([]*types.ContributionsResponse{resp}, []int{2024}, "u", time.Now())
	if err != nil {
		t.Fatalf("Build error: %v", err)
	}
	found := false
	for _, w := range doc.Years[0].Weeks {
		for _, d := range w.Days {
			if d.Date == "2024-02-29" {
				found = true
				// Feb 29 2024 is a Thursday (4).
				if d.Weekday != int(time.Thursday) {
					t.Errorf("2024-02-29 weekday = %d, want 4", d.Weekday)
				}
			}
		}
	}
	if !found {
		t.Errorf("expected 2024-02-29 in days")
	}
}

func TestBuildEmptyYearStatsNull(t *testing.T) {
	weeks := makeYearWeeks(2025, func(_ time.Time) int { return 0 })
	resp := makeResponse(0, weeks)
	doc, err := Build([]*types.ContributionsResponse{resp}, []int{2025}, "u", time.Now())
	if err != nil {
		t.Fatalf("Build error: %v", err)
	}
	if doc.Years[0].Stats != nil {
		t.Errorf("expected nil stats for all-zero year, got %+v", doc.Years[0].Stats)
	}
	// Marshal and assert "stats": null is present in JSON.
	b, err := json.Marshal(doc)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if !containsString(string(b), `"stats":null`) {
		t.Errorf("expected \"stats\":null in JSON output, got: %s", string(b))
	}
}

// TestBuildAdjacentYearPaddingExcludedFromStats covers the critical
// correctness requirement that stats are computed only over in-year
// dates. We place a high-count padding day in late Dec of the prior
// year and assert it does NOT become peakDay/firstContribution and
// does NOT extend a streak into the new year.
func TestBuildAdjacentYearPaddingExcludedFromStats(t *testing.T) {
	// Build a 2025 grid where:
	//   - 2024-12-30 (padding) has count 100 (very high).
	//   - 2025-01-01 has count 5.
	//   - 2025-01-02 has count 5.
	//   - 2026-01-03 (padding from following year) has count 50.
	weeks := makeYearWeeks(2025, func(d time.Time) int {
		switch d.Format("2006-01-02") {
		case "2024-12-30":
			return 100
		case "2025-01-01":
			return 5
		case "2025-01-02":
			return 5
		case "2026-01-03":
			return 50
		}
		return 0
	})
	resp := makeResponse(10, weeks)
	doc, err := Build([]*types.ContributionsResponse{resp}, []int{2025}, "u", time.Now())
	if err != nil {
		t.Fatalf("Build error: %v", err)
	}
	st := doc.Years[0].Stats
	if st == nil {
		t.Fatal("expected non-nil stats")
	}
	if st.PeakDay.Date != "2025-01-01" && st.PeakDay.Date != "2025-01-02" {
		t.Errorf("PeakDay = %+v, expected an in-year date with count 5", st.PeakDay)
	}
	if st.PeakDay.Count != 5 {
		t.Errorf("PeakDay.Count = %d, want 5 (padding day with 100 must be excluded)", st.PeakDay.Count)
	}
	if st.FirstContribution.Date != "2025-01-01" {
		t.Errorf("FirstContribution = %+v, want 2025-01-01", st.FirstContribution)
	}
	if st.LastContribution.Date != "2025-01-02" {
		t.Errorf("LastContribution = %+v, want 2025-01-02", st.LastContribution)
	}
	if st.LongestStreak.Length != 2 {
		t.Errorf("LongestStreak.Length = %d, want 2 (padding day must not extend streak)", st.LongestStreak.Length)
	}
	if st.LongestStreak.Start != "2025-01-01" {
		t.Errorf("LongestStreak.Start = %q, want 2025-01-01", st.LongestStreak.Start)
	}

	// Verify padding days are still preserved in the grid.
	var sawPadding bool
	for _, w := range doc.Years[0].Weeks {
		for _, d := range w.Days {
			if d.Date == "2024-12-30" && d.Count == 100 {
				sawPadding = true
			}
		}
	}
	if !sawPadding {
		t.Errorf("expected padding day 2024-12-30 to be preserved in grid")
	}
}

func TestBuildStreakEndingDec31(t *testing.T) {
	weeks := makeYearWeeks(2025, func(d time.Time) int {
		if d.Year() != 2025 {
			return 0
		}
		// Streak Dec 28-31.
		if d.Month() == time.December && d.Day() >= 28 {
			return 1
		}
		return 0
	})
	resp := makeResponse(4, weeks)
	doc, err := Build([]*types.ContributionsResponse{resp}, []int{2025}, "u", time.Now())
	if err != nil {
		t.Fatalf("Build error: %v", err)
	}
	s := doc.Years[0].Stats.LongestStreak
	if s == nil || s.Length != 4 || s.Start != "2025-12-28" || s.End != "2025-12-31" {
		t.Errorf("streak = %+v, want 2025-12-28..2025-12-31 length 4", s)
	}
}

func TestBuildSingleDayStreak(t *testing.T) {
	weeks := makeYearWeeks(2025, func(d time.Time) int {
		if d.Year() == 2025 && d.Month() == time.July && d.Day() == 4 {
			return 1
		}
		return 0
	})
	resp := makeResponse(1, weeks)
	doc, err := Build([]*types.ContributionsResponse{resp}, []int{2025}, "u", time.Now())
	if err != nil {
		t.Fatalf("Build error: %v", err)
	}
	s := doc.Years[0].Stats.LongestStreak
	if s == nil || s.Length != 1 || s.Start != "2025-07-04" || s.End != "2025-07-04" {
		t.Errorf("streak = %+v, want single day 2025-07-04", s)
	}
}

func TestBuildAllZeroStatsNil(t *testing.T) {
	weeks := makeYearWeeks(2025, func(_ time.Time) int { return 0 })
	resp := makeResponse(0, weeks)
	doc, err := Build([]*types.ContributionsResponse{resp}, []int{2025}, "u", time.Now())
	if err != nil {
		t.Fatalf("Build error: %v", err)
	}
	if doc.Years[0].Stats != nil {
		t.Errorf("expected nil stats for all-zero year")
	}
}

// TestBuildStreakNoCrossYearSpanViaPadding asserts that an in-year
// streak immediately followed by zeros and then a padding day from
// the next year does not get extended into the padding day.
func TestBuildStreakNoCrossYearSpanViaPadding(t *testing.T) {
	weeks := makeYearWeeks(2025, func(d time.Time) int {
		s := d.Format("2006-01-02")
		// In-year streak ending Dec 31.
		if s == "2025-12-30" || s == "2025-12-31" {
			return 1
		}
		// Padding day immediately after.
		if s == "2026-01-01" {
			return 1
		}
		return 0
	})
	resp := makeResponse(3, weeks)
	doc, err := Build([]*types.ContributionsResponse{resp}, []int{2025}, "u", time.Now())
	if err != nil {
		t.Fatalf("Build error: %v", err)
	}
	s := doc.Years[0].Stats.LongestStreak
	if s == nil || s.Length != 2 {
		t.Errorf("streak length = %v, want 2 (must not extend into 2026 padding)", s)
	}
	if s.End != "2025-12-31" {
		t.Errorf("streak end = %q, want 2025-12-31", s.End)
	}
}

func TestBuildInvalidDateError(t *testing.T) {
	weeks := [][]types.ContributionDay{{
		{Date: "not-a-date", ContributionCount: 1},
	}}
	resp := makeResponse(1, weeks)
	_, err := Build([]*types.ContributionsResponse{resp}, []int{2025}, "u", time.Now())
	if err == nil {
		t.Fatal("expected error for invalid date string")
	}
}

func TestBuildMismatchedLengths(t *testing.T) {
	_, err := Build([]*types.ContributionsResponse{nil, nil}, []int{2024}, "u", time.Now())
	if err == nil {
		t.Fatal("expected error for mismatched lengths")
	}
}

func TestPeakWeekIgnoresPadding(t *testing.T) {
	// 2024-12-29 (padding, Sunday) has count 1000 inside the first
	// week of the 2025 grid. The in-year part of that week starts at
	// 2025-01-01 with smaller counts. A later week has higher in-year
	// total and should win.
	weeks := makeYearWeeks(2025, func(d time.Time) int {
		s := d.Format("2006-01-02")
		switch s {
		case "2024-12-29":
			return 1000
		case "2025-06-02", "2025-06-03", "2025-06-04":
			return 10
		}
		return 0
	})
	resp := makeResponse(30, weeks)
	doc, err := Build([]*types.ContributionsResponse{resp}, []int{2025}, "u", time.Now())
	if err != nil {
		t.Fatalf("Build error: %v", err)
	}
	pw := doc.Years[0].Stats.PeakWeek
	if pw == nil {
		t.Fatal("expected peak week")
	}
	if pw.Total != 30 {
		t.Errorf("PeakWeek.Total = %d, want 30 (padding day must not inflate)", pw.Total)
	}
}

func TestWriteRoundTrip(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "out", "skyline.json")
	doc := Document{
		SchemaVersion: 1,
		Username:      "u",
		GeneratedAt:   time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC),
		Years:         []Year{{Year: 2025, TotalContributions: 1, Weeks: []Week{}, Stats: nil}},
	}
	if err := Write(doc, path); err != nil {
		t.Fatalf("Write: %v", err)
	}
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile: %v", err)
	}
	var got Document
	if err := json.Unmarshal(b, &got); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}
	if got.Username != "u" || got.SchemaVersion != 1 {
		t.Errorf("round-trip mismatch: %+v", got)
	}

	// Overwrite case.
	doc.Username = "v"
	if err := Write(doc, path); err != nil {
		t.Fatalf("Write overwrite: %v", err)
	}
	b, _ = os.ReadFile(path)
	_ = json.Unmarshal(b, &got)
	if got.Username != "v" {
		t.Errorf("overwrite failed: %+v", got)
	}
}

// containsString avoids a strings import shadow; kept local for clarity.
func containsString(haystack, needle string) bool {
	for i := 0; i+len(needle) <= len(haystack); i++ {
		if haystack[i:i+len(needle)] == needle {
			return true
		}
	}
	return false
}
