// Package jsonexport builds and writes a versioned JSON document
// describing a user's GitHub contribution history for downstream
// consumers (e.g. video/visualisation tools).
//
// The document preserves the GitHub API's week/day grid verbatim
// (including padding days from adjacent years that the API returns
// to keep each week 7 days long) but derives stats only from days
// whose parsed year matches the requested year. This keeps the
// stats aligned with totalContributions (which is itself
// Jan 1 – Dec 31) and prevents streaks from accidentally spanning
// year boundaries via padding days.
package jsonexport

import (
	"fmt"
	"sort"
	"time"

	"github.com/github/gh-skyline/internal/types"
)

// SchemaVersion is the current version of the JSON export schema.
// Bump this whenever the structure changes in a way that could break
// existing consumers.
const SchemaVersion = 1

// Document is the top-level JSON export structure.
type Document struct {
	SchemaVersion int       `json:"schemaVersion"`
	Username      string    `json:"username"`
	GeneratedAt   time.Time `json:"generatedAt"`
	Years         []Year    `json:"years"`
}

// Year holds a single year's contribution grid and derived stats.
// Stats is a pointer (without omitempty) so an empty year marshals
// as "stats": null.
type Year struct {
	Year               int    `json:"year"`
	TotalContributions int    `json:"totalContributions"`
	Weeks              []Week `json:"weeks"`
	Stats              *Stats `json:"stats"`
}

// Week describes a single column in the contribution grid.
type Week struct {
	WeekIndex int    `json:"weekIndex"`
	StartDate string `json:"startDate"`
	Days      []Day  `json:"days"`
}

// Day is a single day in the contribution grid.
// Weekday matches GitHub's convention: Sun=0..Sat=6.
type Day struct {
	Date    string `json:"date"`
	Count   int    `json:"count"`
	Weekday int    `json:"weekday"`
}

// Stats holds the derived per-year statistics. Each field is a pointer
// so missing values (e.g. peakDay for an all-zero year) can be
// represented unambiguously.
type Stats struct {
	PeakDay           *DayStat    `json:"peakDay"`
	PeakWeek          *WeekStat   `json:"peakWeek"`
	LongestStreak     *StreakStat `json:"longestStreak"`
	FirstContribution *DayStat    `json:"firstContribution"`
	LastContribution  *DayStat    `json:"lastContribution"`
}

// DayStat is a date+count pair used for peak/first/last day stats.
type DayStat struct {
	Date  string `json:"date"`
	Count int    `json:"count"`
}

// WeekStat is the peak week stat: the week's start date and total count.
type WeekStat struct {
	StartDate string `json:"startDate"`
	Total     int    `json:"total"`
}

// StreakStat describes a contiguous run of days with count > 0.
type StreakStat struct {
	Start  string `json:"start"`
	End    string `json:"end"`
	Length int    `json:"length"`
}

// Build assembles a Document from a slice of *ContributionsResponse,
// one per year, alongside the matching requested years (so we can
// correctly filter adjacent-year padding days when computing stats).
// Years emerge in ascending order regardless of input ordering.
//
// The now parameter is injected for deterministic tests; callers in
// production should pass time.Now().UTC().
func Build(responses []*types.ContributionsResponse, years []int, username string, now time.Time) (Document, error) {
	if len(responses) != len(years) {
		return Document{}, fmt.Errorf("jsonexport: responses (%d) and years (%d) length mismatch", len(responses), len(years))
	}

	doc := Document{
		SchemaVersion: SchemaVersion,
		Username:      username,
		GeneratedAt:   now,
		Years:         make([]Year, 0, len(responses)),
	}

	order := make([]int, len(years))
	for i := range order {
		order[i] = i
	}
	sort.SliceStable(order, func(i, j int) bool { return years[order[i]] < years[order[j]] })

	for _, idx := range order {
		y, err := buildYear(responses[idx], years[idx])
		if err != nil {
			return Document{}, err
		}
		doc.Years = append(doc.Years, y)
	}
	return doc, nil
}

// buildYear converts a single response into a Year, computing stats
// over in-year days only.
func buildYear(resp *types.ContributionsResponse, year int) (Year, error) {
	if resp == nil {
		return Year{}, fmt.Errorf("jsonexport: nil response for year %d", year)
	}

	cal := resp.User.ContributionsCollection.ContributionCalendar
	weeks := make([]Week, 0, len(cal.Weeks))

	for wi, w := range cal.Weeks {
		days := make([]Day, 0, len(w.ContributionDays))
		var startDate string
		for di, d := range w.ContributionDays {
			parsed, err := time.Parse("2006-01-02", d.Date)
			if err != nil {
				return Year{}, fmt.Errorf("jsonexport: invalid date %q in year %d: %w", d.Date, year, err)
			}
			if di == 0 {
				startDate = d.Date
			}
			days = append(days, Day{
				Date:    d.Date,
				Count:   d.ContributionCount,
				Weekday: int(parsed.Weekday()),
			})
		}
		weeks = append(weeks, Week{
			WeekIndex: wi,
			StartDate: startDate,
			Days:      days,
		})
	}

	stats := buildStats(weeks, year)

	return Year{
		Year:               year,
		TotalContributions: cal.TotalContributions,
		Weeks:              weeks,
		Stats:              stats,
	}, nil
}

// BuildStats computes per-year stats over days whose date is within
// the requested year. Returns nil if the year has no in-year days or
// no in-year contributions (graceful empty-year handling).
func BuildStats(weeks []Week, year int) *Stats {
	return buildStats(weeks, year)
}

// buildStats is the internal implementation of BuildStats. See BuildStats
// for behavior. It is intentionally tolerant of malformed dates (skipped)
// because Build already validates them; callers that bypass Build are
// expected to provide parseable YYYY-MM-DD strings.
func buildStats(weeks []Week, year int) *Stats {
	type chronDay struct {
		date    time.Time
		dateStr string
		count   int
	}
	var days []chronDay
	for _, w := range weeks {
		for _, d := range w.Days {
			parsed, err := time.Parse("2006-01-02", d.Date)
			if err != nil {
				continue
			}
			if parsed.Year() != year {
				continue
			}
			days = append(days, chronDay{date: parsed, dateStr: d.Date, count: d.Count})
		}
	}
	if len(days) == 0 {
		return nil
	}
	sort.SliceStable(days, func(i, j int) bool { return days[i].date.Before(days[j].date) })

	hasContrib := false
	for _, d := range days {
		if d.count > 0 {
			hasContrib = true
			break
		}
	}
	if !hasContrib {
		return nil
	}

	stats := &Stats{}

	// peakDay: highest count; ties → earliest date.
	{
		peakIdx := -1
		for i, d := range days {
			if d.count <= 0 {
				continue
			}
			if peakIdx == -1 || d.count > days[peakIdx].count {
				peakIdx = i
			}
		}
		if peakIdx >= 0 {
			stats.PeakDay = &DayStat{Date: days[peakIdx].dateStr, Count: days[peakIdx].count}
		}
	}

	// first / last contribution.
	for _, d := range days {
		if d.count > 0 {
			stats.FirstContribution = &DayStat{Date: d.dateStr, Count: d.count}
			break
		}
	}
	for i := len(days) - 1; i >= 0; i-- {
		if days[i].count > 0 {
			stats.LastContribution = &DayStat{Date: days[i].dateStr, Count: days[i].count}
			break
		}
	}

	// peakWeek: highest sum of in-year days per week; ties → earliest week.
	{
		var bestTotal int
		var bestStart string
		bestSeen := false
		for _, w := range weeks {
			total := 0
			hasInYear := false
			var firstInYearDate string
			for _, d := range w.Days {
				parsed, err := time.Parse("2006-01-02", d.Date)
				if err != nil || parsed.Year() != year {
					continue
				}
				if !hasInYear {
					firstInYearDate = d.Date
					hasInYear = true
				}
				total += d.Count
			}
			if !hasInYear {
				continue
			}
			if !bestSeen || total > bestTotal {
				bestTotal = total
				bestStart = firstInYearDate
				bestSeen = true
			}
		}
		if bestSeen {
			stats.PeakWeek = &WeekStat{StartDate: bestStart, Total: bestTotal}
		}
	}

	// longestStreak: longest run of consecutive in-year dates with count > 0.
	{
		var bestLen int
		var bestStartStr, bestEndStr string
		var curLen int
		var curStartStr string
		var prev time.Time
		havePrev := false
		for _, d := range days {
			if d.count <= 0 {
				curLen = 0
				havePrev = false
				continue
			}
			if curLen > 0 && havePrev && d.date.Sub(prev) == 24*time.Hour {
				curLen++
			} else {
				curLen = 1
				curStartStr = d.dateStr
			}
			if curLen > bestLen {
				bestLen = curLen
				bestStartStr = curStartStr
				bestEndStr = d.dateStr
			}
			prev = d.date
			havePrev = true
		}
		if bestLen > 0 {
			stats.LongestStreak = &StreakStat{
				Start:  bestStartStr,
				End:    bestEndStr,
				Length: bestLen,
			}
		}
	}

	return stats
}
