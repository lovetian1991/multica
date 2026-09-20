package processtemplate

import (
	"archive/zip"
	"bytes"
	"strings"
	"testing"
)

func TestDetectContentRoot(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name  string
		files []string
		want  string
	}{
		{name: "root agents", files: []string{"agents/architect.md", "squad/bug-fix/squad.md"}, want: ""},
		{name: "zh_CN", files: []string{"zh_CN/agents/architect.md", "zh_CN/skills/oc-bug/SKILL.md"}, want: "zh_CN/"},
		{name: "templates zh_CN", files: []string{"templates/zh_CN/agents/architect.md", "templates/zh_CN/squad/development/squad.md"}, want: "templates/zh_CN/"},
		{name: "wrapper dir", files: []string{"bundle/agents/architect.md", "bundle/skills/oc-bug/SKILL.md"}, want: "bundle/"},
		{name: "shortest prefix wins", files: []string{"agents/a.md", "templates/zh_CN/agents/b.md"}, want: ""},
		{name: "skills only nested", files: []string{"zh_CN/skills/multica-verification/SKILL.md"}, want: "zh_CN/"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := detectContentRoot(tc.files)
			if got != tc.want {
				t.Fatalf("detectContentRoot(%v) = %q, want %q", tc.files, got, tc.want)
			}
		})
	}
}

func TestParseZipUsesMappingFenceAndFrontmatter(t *testing.T) {
	t.Parallel()
	archive, err := ParseZip(mustZip(t, map[string]string{
		"templates/zh_CN/agents/mapping.json": `{
  "architect": {
    "displayName": "Tech Architect",
    "description": "Architecture",
    "skills": ["technical-design", "oc-bug"]
  }
}`,
		"templates/zh_CN/agents/architect.md": "# Architect\n\n> copy me\n\n```text\nI am the architect.\n```\n",
		"templates/zh_CN/squad/mapping.json": `{
  "development": {
    "displayName": "Development Squad",
    "description": "Delivery",
    "leader": "architect",
    "members": ["architect"]
  }
}`,
		"templates/zh_CN/squad/development/squad.md":                   "```\nLead the squad.\n```\n",
		"templates/zh_CN/skills/multica-technical-design/SKILL.md":     "---\nname: technical-design\ndescription: Design the system\n---\n\nDo the design.\n",
		"templates/zh_CN/skills/multica-technical-design/notes.md":     "supporting notes",
		"templates/zh_CN/skills/multica-technical-design/.env.example": "TOKEN=example",
		"templates/zh_CN/skills/oc-bug/SKILL.md":                       "---\nname: oc-bug\ndescription: Bugs\n---\n\nFix bugs.\n",
	}))
	if err != nil {
		t.Fatalf("ParseZip: %v", err)
	}
	if len(archive.Agents) != 1 {
		t.Fatalf("agents = %d, want 1", len(archive.Agents))
	}
	agent := archive.Agents[0]
	if agent.Key != "architect" || agent.DisplayName != "Tech Architect" {
		t.Fatalf("agent identity = %+v", agent)
	}
	if agent.Instructions != "I am the architect." {
		t.Fatalf("instructions = %q", agent.Instructions)
	}
	if len(agent.Skills) != 2 || agent.Skills[0] != "technical-design" || agent.Skills[1] != "oc-bug" {
		t.Fatalf("skills = %#v", agent.Skills)
	}
	if len(archive.Squads) != 1 || archive.Squads[0].Key != "development" || archive.Squads[0].Leader != "architect" {
		t.Fatalf("squads = %+v", archive.Squads)
	}
	if archive.Squads[0].Instructions != "Lead the squad." {
		t.Fatalf("squad instructions = %q", archive.Squads[0].Instructions)
	}
	if len(archive.Skills) != 2 {
		t.Fatalf("skills = %+v", archive.Skills)
	}
	if archive.Skills[0].Name != "multica-technical-design" || archive.Skills[1].Name != "oc-bug" {
		t.Fatalf("skill names = %#v", []string{archive.Skills[0].Name, archive.Skills[1].Name})
	}
	skill := archive.Skills[0]
	if skill.Description != "Design the system" {
		t.Fatalf("skill description = %q", skill.Description)
	}
	if len(skill.Files) != 2 {
		t.Fatalf("skill files = %+v", skill.Files)
	}
	paths := skill.Files[0].Path + "," + skill.Files[1].Path
	if paths != ".env.example,notes.md" {
		t.Fatalf("skill files = %+v", skill.Files)
	}
}

func TestParseZipRootLevelAgents(t *testing.T) {
	t.Parallel()
	archive, err := ParseZip(mustZip(t, map[string]string{
		"agents/backend-developer.md": "```text\nbackend\n```",
		"agents/mapping.json":         `{"backend-developer":{"displayName":"Backend Developer"}}`,
	}))
	if err != nil {
		t.Fatalf("ParseZip: %v", err)
	}
	if len(archive.Agents) != 1 || archive.Agents[0].DisplayName != "Backend Developer" {
		t.Fatalf("agents = %+v", archive.Agents)
	}
}

func TestParseZipRejectsInvalidMapping(t *testing.T) {
	t.Parallel()
	_, err := ParseZip(mustZip(t, map[string]string{
		"agents/architect.md": "```\ninstructions\n```",
		"agents/mapping.json": `{"architect":`,
	}))
	if err == nil || !strings.Contains(err.Error(), "agents/mapping.json is invalid") {
		t.Fatalf("error = %v", err)
	}
}

func TestParseZipRejectsSquadWithoutLeader(t *testing.T) {
	t.Parallel()
	_, err := ParseZip(mustZip(t, map[string]string{
		"agents/architect.md":        "```\ninstructions\n```",
		"squad/development/squad.md": "```\nlead\n```",
		"squad/mapping.json":         `{"development":{"displayName":"Development Squad"}}`,
	}))
	if err == nil || !strings.Contains(err.Error(), "missing a leader") {
		t.Fatalf("error = %v", err)
	}
}

func TestParseZipRejectsUnknownSquadLeader(t *testing.T) {
	t.Parallel()
	_, err := ParseZip(mustZip(t, map[string]string{
		"agents/architect.md":        "```\ninstructions\n```",
		"squad/development/squad.md": "```\nlead\n```",
		"squad/mapping.json":         `{"development":{"displayName":"Development Squad","leader":"missing-agent"}}`,
	}))
	if err == nil || !strings.Contains(err.Error(), "was not found in agents") {
		t.Fatalf("error = %v", err)
	}
}

func TestExpandSkillName(t *testing.T) {
	t.Parallel()
	if got := ExpandSkillName("implementation"); got != "multica-implementation" {
		t.Fatalf("got %q", got)
	}
	if got := ExpandSkillName("oc-bug"); got != "oc-bug" {
		t.Fatalf("got %q", got)
	}
	if got := ExpandSkillName("diagnosing-bugs"); got != "diagnosing-bugs" {
		t.Fatalf("got %q", got)
	}
	if got := ExpandSkillName("multica-verification"); got != "multica-verification" {
		t.Fatalf("got %q", got)
	}
	got := SkillNameCandidates("implementation")
	if strings.Join(got, ",") != "implementation,multica-implementation" {
		t.Fatalf("candidates = %#v", got)
	}
}

func TestSlugify(t *testing.T) {
	t.Parallel()
	if got := Slugify("My Template 1"); got != "my-template-1" {
		t.Fatalf("got %q", got)
	}
	if got := Slugify("流程模板"); got != "" {
		t.Fatalf("chinese slug = %q, want empty", got)
	}
}

func TestMatchesIdentity(t *testing.T) {
	t.Parallel()
	if !MatchesIdentity("后台开发专家", "后台开发专家", "backend-developer") {
		t.Fatal("expected display name match")
	}
	if !MatchesIdentity("architect", "技术架构师", "architect") {
		t.Fatal("expected key match")
	}
	if !MatchesIdentity("Designer", "UI/UE设计师", "designer") {
		t.Fatal("expected case-insensitive key match")
	}
	if MatchesIdentity("frontend-developer", "后台开发专家", "backend-developer") {
		t.Fatal("unrelated name should not match")
	}
}

func TestParseZipRejectsUnknownMappedSkill(t *testing.T) {
	t.Parallel()
	_, err := ParseZip(mustZip(t, map[string]string{
		"agents/architect.md": "```\ninstructions\n```",
		"agents/mapping.json": `{"architect":{"displayName":"Architect","skills":["missing-skill"]}}`,
	}))
	if err == nil || !strings.Contains(err.Error(), "was not found in skills/") {
		t.Fatalf("error = %v", err)
	}
}

func TestParseZipRejectsUnknownSquadMember(t *testing.T) {
	t.Parallel()
	_, err := ParseZip(mustZip(t, map[string]string{
		"agents/architect.md":        "```\ninstructions\n```",
		"squad/development/squad.md": "```\nlead\n```",
		"squad/mapping.json":         `{"development":{"displayName":"Development Squad","leader":"architect","members":["ghost"]}}`,
	}))
	if err == nil || !strings.Contains(err.Error(), "member") {
		t.Fatalf("error = %v", err)
	}
}

func TestParseZipOmitsSkillsWhenMissing(t *testing.T) {
	t.Parallel()
	archive, err := ParseZip(mustZip(t, map[string]string{
		"agents/architect.md": "```\ninstructions\n```",
		"agents/mapping.json": `{"architect":{"displayName":"Architect"}}`,
	}))
	if err != nil {
		t.Fatalf("ParseZip: %v", err)
	}
	if len(archive.Agents) != 1 {
		t.Fatalf("agents = %d", len(archive.Agents))
	}
	if archive.Agents[0].Skills != nil {
		t.Fatalf("omitted skills should stay nil, got %#v", archive.Agents[0].Skills)
	}
}

func TestParseZipEmptySkillsArePresent(t *testing.T) {
	t.Parallel()
	archive, err := ParseZip(mustZip(t, map[string]string{
		"agents/architect.md": "```\ninstructions\n```",
		"agents/mapping.json": `{"architect":{"displayName":"Architect","skills":[]}}`,
	}))
	if err != nil {
		t.Fatalf("ParseZip: %v", err)
	}
	if archive.Agents[0].Skills == nil {
		t.Fatal("empty skills should be a non-nil empty slice")
	}
	if len(archive.Agents[0].Skills) != 0 {
		t.Fatalf("skills = %#v", archive.Agents[0].Skills)
	}
}

func mustZip(t *testing.T, files map[string]string) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for name, content := range files {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := w.Write([]byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}
