package migrations

import (
	"fmt"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"testing"
)

func TestMigrationNumericPrefixesAreUnique(t *testing.T) {
	files := migrationFilesForLint(t, "*.up.sql")

	// Migrations through 128 contain historical duplicate numeric prefixes.
	// From 129 onward, keep the numeric sequence unique so release tooling and
	// operators can identify one schema change unambiguously by its number.
	const firstUniqueMigrationNumber = 129
	stemByNumber := make(map[int]string)
	for _, file := range files {
		stem, _, ok := splitMigrationFilename(filepath.Base(file))
		if !ok {
			continue
		}
		prefix, _, ok := strings.Cut(stem, "_")
		if !ok {
			continue
		}
		number, err := strconv.Atoi(prefix)
		if err != nil || number < firstUniqueMigrationNumber {
			continue
		}
		if previous, exists := stemByNumber[number]; exists && !historicalPrefixOverlap(previous, stem) {
			t.Errorf("migrations %s and %s share numeric prefix %s", previous, stem, prefix)
			continue
		}
		stemByNumber[number] = stem
	}
}

// These full versions were shipped independently by upstream and this
// distribution. The runner records full stems, so renaming them would replay
// deployed migrations. Keep this exception closed to newly introduced stems.
func historicalPrefixOverlap(first, second string) bool {
	reviewed := map[string]bool{
		"450_drop_comment_delegated_failure_pending_index": true,
		"450_products":                          true,
		"451_agent_task_comment_thread":         true,
		"451_products_global":                   true,
		"452_agent_task_pending_thread_unique":  true,
		"452_issue_product_id":                  true,
		"453_drop_pending_issue_agent_unique":   true,
		"453_product_versions":                  true,
		"453_system_settings":                   true,
		"454_drop_comment_content_bigm_index":   true,
		"454_product_version_index":             true,
		"455_drop_comment_content_trgm_index":   true,
		"455_issue_product_version":             true,
		"456_cancel_comment_assignee_fallbacks": true,
		"456_product_remove_version_fields":     true,
		"457_product_version_folder_id":         true,
		"457_task_message_output_truncated":     true,
		"458_agent_task_cancellation_actor":     true,
		"458_issue_kb_folder_id":                true,
		"458_product_version_enabled":           true,
		"500_product_description":               true,
		"500_task_message_call_id":              true,
		"501_project_product_version":           true,
		"501_runtime_profile_runtime_type":      true,
		"502_channel_reply_delivery":            true,
		"502_process_templates":                 true,
	}
	firstPrefix, _, _ := strings.Cut(first, "_")
	secondPrefix, _, _ := strings.Cut(second, "_")
	return first != second && firstPrefix == secondPrefix && reviewed[first] && reviewed[second]
}

func TestHistoricalPrefixOverlap(t *testing.T) {
	for _, tt := range []struct {
		first, second string
		want          bool
	}{
		{"450_products", "450_drop_comment_delegated_failure_pending_index", true},
		{"453_system_settings", "453_product_versions", true},
		{"450_products", "450_new_migration", false},
		{"450_new_migration", "450_products", false},
		{"450_products", "450_products", false},
		{"450_products", "451_products_global", false},
	} {
		if got := historicalPrefixOverlap(tt.first, tt.second); got != tt.want {
			t.Errorf("historicalPrefixOverlap(%q, %q) = %v, want %v", tt.first, tt.second, got, tt.want)
		}
	}
	if ExtractVersion("450_products.up.sql") == ExtractVersion("450_drop_comment_delegated_failure_pending_index.up.sql") {
		t.Fatal("migration tracking must retain the full version stem")
	}
}

func TestMigrationFilesHaveMatchingDirections(t *testing.T) {
	files := migrationFilesForLint(t, "*.sql")

	directionsByStem := make(map[string]map[string]bool)
	for _, file := range files {
		stem, direction, ok := splitMigrationFilename(filepath.Base(file))
		if !ok {
			continue
		}
		if directionsByStem[stem] == nil {
			directionsByStem[stem] = make(map[string]bool)
		}
		directionsByStem[stem][direction] = true
	}

	for stem, directions := range directionsByStem {
		if !directions["up"] || !directions["down"] {
			t.Errorf("migration %s must have both .up.sql and .down.sql files", stem)
		}
	}
}

func migrationFilesForLint(t *testing.T, pattern string) []string {
	t.Helper()

	dir := realMigrationsDir(t)
	files, err := filepath.Glob(filepath.Join(dir, pattern))
	if err != nil {
		t.Fatal(err)
	}
	if len(files) == 0 {
		t.Fatalf("no migration files matched %s in %s", pattern, dir)
	}
	sort.Strings(files)
	return files
}

func realMigrationsDir(t *testing.T) string {
	t.Helper()

	// Relative to the package directory go test runs in; runtime.Caller
	// would return a module path under -trimpath.
	dir, err := filepath.Abs(filepath.Join("..", "..", "migrations"))
	if err != nil {
		t.Fatalf("resolve migrations dir: %v", err)
	}
	return dir
}

func splitMigrationFilename(name string) (stem, direction string, ok bool) {
	for _, candidateDirection := range []string{"up", "down"} {
		suffix := fmt.Sprintf(".%s.sql", candidateDirection)
		if strings.HasSuffix(name, suffix) {
			return strings.TrimSuffix(name, suffix), candidateDirection, true
		}
	}
	return "", "", false
}
