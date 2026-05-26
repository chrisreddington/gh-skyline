package jsonexport

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

// Write marshals doc as indented JSON and writes it to path atomically:
// a temp file is created in the destination directory, the JSON is
// written and synced to it, and then it is renamed over the final path.
// On any error before the rename, the temp file is removed.
func Write(doc Document, path string) error {
	data, err := json.MarshalIndent(doc, "", "  ")
	if err != nil {
		return fmt.Errorf("jsonexport: marshal: %w", err)
	}

	dir := filepath.Dir(path)
	if dir == "" {
		dir = "."
	}
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return fmt.Errorf("jsonexport: create output dir: %w", err)
	}

	tmp, err := os.CreateTemp(dir, ".skyline-json-*")
	if err != nil {
		return fmt.Errorf("jsonexport: create temp file: %w", err)
	}
	tmpName := tmp.Name()
	// Best-effort cleanup if anything below fails before the rename.
	cleaned := false
	defer func() {
		if !cleaned {
			_ = os.Remove(tmpName)
		}
	}()

	if _, err := tmp.Write(data); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("jsonexport: write temp file: %w", err)
	}
	if err := tmp.Sync(); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("jsonexport: sync temp file: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("jsonexport: close temp file: %w", err)
	}
	if err := os.Rename(tmpName, path); err != nil {
		return fmt.Errorf("jsonexport: rename temp file: %w", err)
	}
	cleaned = true
	return nil
}
