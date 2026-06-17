package skyline

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/github/gh-skyline/internal/github"
	"github.com/github/gh-skyline/internal/testutil/fixtures"
	"github.com/github/gh-skyline/internal/testutil/mocks"
)

func TestGenerateSkyline(t *testing.T) {
	// Save original initializer
	originalInit := github.InitializeGitHubClient
	defer func() {
		github.InitializeGitHubClient = originalInit
	}()

	tests := []struct {
		name       string
		startYear  int
		endYear    int
		targetUser string
		full       bool
		artOnly    bool
		jsonExport bool
		wantSTL    bool
		wantJSON   bool
		mockClient *mocks.MockGitHubClient
		wantErr    bool
	}{
		{
			name:       "single year",
			startYear:  2024,
			endYear:    2024,
			targetUser: "testuser",
			wantSTL:    true,
			mockClient: &mocks.MockGitHubClient{
				Username: "testuser",
				JoinYear: 2020,
				MockData: fixtures.GenerateContributionsResponse("testuser", 2024),
			},
		},
		{
			name:       "year range",
			startYear:  2020,
			endYear:    2024,
			targetUser: "testuser",
			wantSTL:    true,
			mockClient: &mocks.MockGitHubClient{
				Username: "testuser",
				JoinYear: 2020,
				MockData: fixtures.GenerateContributionsResponse("testuser", 2024),
			},
		},
		{
			name:       "full range",
			startYear:  2008,
			endYear:    2024,
			targetUser: "testuser",
			full:       true,
			wantSTL:    true,
			mockClient: &mocks.MockGitHubClient{
				Username: "testuser",
				JoinYear: 2008,
				MockData: fixtures.GenerateContributionsResponse("testuser", 2024),
			},
		},
		{
			name:       "single year with JSON export",
			startYear:  2024,
			endYear:    2024,
			targetUser: "testuser",
			jsonExport: true,
			wantSTL:    true,
			wantJSON:   true,
			mockClient: &mocks.MockGitHubClient{
				Username: "testuser",
				JoinYear: 2020,
				MockData: fixtures.GenerateContributionsResponse("testuser", 2024),
			},
		},
		{
			name:       "art-only with JSON export produces only JSON",
			startYear:  2024,
			endYear:    2024,
			targetUser: "testuser",
			artOnly:    true,
			jsonExport: true,
			wantSTL:    false,
			wantJSON:   true,
			mockClient: &mocks.MockGitHubClient{
				Username: "testuser",
				JoinYear: 2020,
				MockData: fixtures.GenerateContributionsResponse("testuser", 2024),
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Run each case in an isolated temp dir so generated files
			// don't pollute the working tree and can be asserted on.
			origDir, err := os.Getwd()
			if err != nil {
				t.Fatalf("Getwd: %v", err)
			}
			dir := t.TempDir()
			if err := os.Chdir(dir); err != nil {
				t.Fatalf("Chdir: %v", err)
			}
			t.Cleanup(func() { _ = os.Chdir(origDir) })

			// Create a closure that returns our mock client
			github.InitializeGitHubClient = func() (*github.Client, error) {
				return github.NewClient(tt.mockClient), nil
			}

			err = GenerateSkyline(tt.startYear, tt.endYear, tt.targetUser, tt.full, "", tt.artOnly, tt.jsonExport)
			if (err != nil) != tt.wantErr {
				t.Errorf("GenerateSkyline() error = %v, wantErr %v", err, tt.wantErr)
			}

			stlMatches, _ := filepath.Glob(filepath.Join(dir, "*.stl"))
			jsonMatches, _ := filepath.Glob(filepath.Join(dir, "*.json"))

			if tt.wantSTL && len(stlMatches) == 0 {
				t.Errorf("expected an .stl file, found none")
			}
			if !tt.wantSTL && len(stlMatches) > 0 {
				t.Errorf("expected no .stl file, found %v", stlMatches)
			}
			if tt.wantJSON {
				if len(jsonMatches) == 0 {
					t.Fatalf("expected a .json file, found none")
				}
				// Verify the JSON is well-formed.
				data, err := os.ReadFile(jsonMatches[0])
				if err != nil {
					t.Fatalf("read json: %v", err)
				}
				var doc map[string]interface{}
				if err := json.Unmarshal(data, &doc); err != nil {
					t.Errorf("json is invalid: %v", err)
				}
				if v, ok := doc["schemaVersion"].(float64); !ok || v != 1 {
					t.Errorf("schemaVersion = %v, want 1", doc["schemaVersion"])
				}
			}
			if !tt.wantJSON && len(jsonMatches) > 0 {
				t.Errorf("expected no .json file, found %v", jsonMatches)
			}
		})
	}
}
