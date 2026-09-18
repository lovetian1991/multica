package execenv

import (
	"strings"
	"testing"
)

func TestProductContextRenderedWhenSet(t *testing.T) {
	t.Parallel()
	ctx := TaskContextForEnv{
		IssueID:                   "11111111-2222-3333-4444-555555555555",
		ProductName:               "AgentProduct",
		ProductDescription:        "Repo lives at G:/aicode/multica. Watch auth middleware.",
		ProductVersionName:        "8.6.0.0",
		ProductVersionDescription: "Main line. Do not touch generated sqlc files.",
		ProductVersionDirectory:   "G:/aicode/multica",
	}
	out := buildMetaSkillContent("claude", ctx)
	if !strings.Contains(out, "## Product Context") {
		t.Fatal("expected ## Product Context heading")
	}
	for _, want := range []string{
		"The active product for this task is **AgentProduct**. Use it as optional code-path context, not as the ZenTao bug query scope.",
		"Product description:",
		"Repo lives at G:/aicode/multica. Watch auth middleware.",
		"Product version: **8.6.0.0**.",
		"Product version description:",
		"Main line. Do not touch generated sqlc files.",
		"Product version directory: `G:/aicode/multica`",
	} {
		if !strings.Contains(out, want) {
			t.Fatalf("missing %q\n%s", want, out)
		}
	}
}

func TestProductContextHeadingSkippedWhenEmpty(t *testing.T) {
	t.Parallel()
	out := buildMetaSkillContent("claude", TaskContextForEnv{
		IssueID: "11111111-2222-3333-4444-555555555555",
	})
	if strings.Contains(out, "## Product Context") {
		t.Fatal("empty product context must NOT emit the heading")
	}
}
