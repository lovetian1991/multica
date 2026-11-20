package handler

import (
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/processtemplate"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

func TestProcessTemplateSquadBindings(t *testing.T) {
	t.Parallel()
	id := mustScanUUID(t, "11111111-1111-4111-8111-111111111111")
	archive := processtemplate.Archive{Squads: []processtemplate.Squad{
		{Key: "designer", DisplayName: "Product design"},
	}}
	for _, tc := range []struct {
		name   string
		squads []db.Squad
		wantID string
	}{
		{"display name", []db.Squad{{ID: id, Name: "Product design"}}, uuidToString(id)},
		{"key", []db.Squad{{ID: id, Name: "Designer"}}, uuidToString(id)},
		{"missing", nil, ""},
		{"ambiguous", []db.Squad{{ID: id, Name: "designer"}, {ID: id, Name: "Product design"}}, ""},
		{"archived", []db.Squad{{ID: id, Name: "designer", ArchivedAt: pgtype.Timestamptz{Time: time.Now(), Valid: true}}}, ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := processTemplateSquadBindings(archive, tc.squads)
			if len(got) != 1 || got[0].Key != "designer" || got[0].Name != "Product design" || got[0].ID != tc.wantID {
				t.Fatalf("squad bindings = %+v, want ID %q", got, tc.wantID)
			}
		})
	}
}

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

func TestFindMatchingSquadsPrefersActiveOrMostRecentlyArchived(t *testing.T) {
	t.Parallel()
	tmpl := processtemplate.Squad{Key: "development", DisplayName: "Development"}
	old := db.Squad{
		ID: mustScanUUID(t, "11111111-1111-4111-8111-111111111111"), Name: "development",
		ArchivedAt: pgtype.Timestamptz{Time: time.Unix(10, 0), Valid: true},
	}
	recent := db.Squad{
		ID: mustScanUUID(t, "22222222-2222-4222-8222-222222222222"), Name: "Development",
		ArchivedAt: pgtype.Timestamptz{Time: time.Unix(20, 0), Valid: true},
	}
	active := recent
	active.ArchivedAt = pgtype.Timestamptz{}
	for _, tc := range []struct {
		name   string
		squads []db.Squad
		want   pgtype.UUID
	}{
		{"active", []db.Squad{old, active}, active.ID},
		{"latest archive", []db.Squad{old, recent}, recent.ID},
		{"reverse order", []db.Squad{recent, old}, recent.ID},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := findMatchingSquads(tc.squads, tmpl)
			if len(got) != 1 || got[0].ID != tc.want {
				t.Fatalf("matches = %+v, want %v", got, tc.want)
			}
		})
	}
	if got := findMatchingSquads([]db.Squad{active, active}, tmpl); len(got) != 2 {
		t.Fatalf("ambiguous active squads must not be silently selected: %+v", got)
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
