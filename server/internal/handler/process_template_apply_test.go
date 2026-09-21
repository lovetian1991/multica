package handler

import (
	"testing"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/processtemplate"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

func TestFindMatchingAgentsByDisplayNameAndKey(t *testing.T) {
	t.Parallel()
	agents := []db.Agent{
		{Name: "后台开发专家"},
		{Name: "architect"},
		{Name: "Designer"},
	}
	matches := findMatchingAgents(agents, processtemplate.Agent{
		Key:         "backend-developer",
		DisplayName: "后台开发专家",
	})
	if len(matches) != 1 || matches[0].Name != "后台开发专家" {
		t.Fatalf("display name matches = %+v", matches)
	}
	matches = findMatchingAgents(agents, processtemplate.Agent{
		Key:         "architect",
		DisplayName: "技术架构师",
	})
	if len(matches) != 1 || matches[0].Name != "architect" {
		t.Fatalf("key matches = %+v", matches)
	}
	matches = findMatchingAgents(agents, processtemplate.Agent{
		Key:         "designer",
		DisplayName: "UI/UE设计师",
	})
	if len(matches) != 1 || matches[0].Name != "Designer" {
		t.Fatalf("case-insensitive key matches = %+v", matches)
	}
}

func TestFindMatchingSquadsByDisplayNameAndKey(t *testing.T) {
	t.Parallel()
	squads := []db.Squad{
		{Name: "开发小队"},
		{Name: "bug-fix"},
	}
	matches := findMatchingSquads(squads, processtemplate.Squad{
		Key:         "development",
		DisplayName: "开发小队",
	})
	if len(matches) != 1 || matches[0].Name != "开发小队" {
		t.Fatalf("display name matches = %+v", matches)
	}
	matches = findMatchingSquads(squads, processtemplate.Squad{
		Key:         "bug-fix",
		DisplayName: "Bug 修复小队",
	})
	if len(matches) != 1 || matches[0].Name != "bug-fix" {
		t.Fatalf("key matches = %+v", matches)
	}
}

func TestLookupTemplateSkillID(t *testing.T) {
	t.Parallel()
	implementation := mustScanUUID(t, "11111111-1111-1111-1111-111111111111")
	ocBug := mustScanUUID(t, "22222222-2222-2222-2222-222222222222")
	ids := map[string]pgtype.UUID{
		"multica-implementation": implementation,
		"oc-bug":                 ocBug,
	}
	got, ok := lookupTemplateSkillID(ids, "implementation")
	if !ok || got != implementation {
		t.Fatalf("implementation lookup = %v %v", got, ok)
	}
	got, ok = lookupTemplateSkillID(ids, "multica-implementation")
	if !ok || got != implementation {
		t.Fatalf("prefixed implementation lookup = %v %v", got, ok)
	}
	got, ok = lookupTemplateSkillID(ids, "oc-bug")
	if !ok || got != ocBug {
		t.Fatalf("oc-bug lookup = %v %v", got, ok)
	}
	if _, ok = lookupTemplateSkillID(ids, "missing"); ok {
		t.Fatal("missing skill should not resolve")
	}
}

func mustScanUUID(t *testing.T, raw string) pgtype.UUID {
	t.Helper()
	var id pgtype.UUID
	if err := id.Scan(raw); err != nil {
		t.Fatal(err)
	}
	return id
}
