package workorder

import (
	"context"
	"fmt"
	"strings"
	"testing"
)

func TestProjectBaselineReportsMissingRepositoriesWithoutBlockingConfiguredModules(t *testing.T) {
	module := Module{Key: "main", RepoURL: "https://git.example/ecm.git", Ref: "legacy"}
	versions := map[string]Version{
		"ecm6": {ID: "ecm6", ProductID: "ecm", ProductName: "ECM", ProductSlug: "ecm", Name: "v6.0.0.0",
			Config: Config{Modules: []Module{module}, Dependencies: []string{"base6"}}},
		"base6": {ID: "base6", ProductID: "base", ProductName: "Low code", Name: "v6.0.0.0",
			Config: Config{Dependencies: []string{"lib3"}}},
		"lib3": {ID: "lib3", ProductID: "lib", ProductName: "Library", ProductSlug: "lib", Name: "v3",
			Config: Config{Modules: []Module{module}}},
	}
	load := func(_ context.Context, id string) (Version, error) { return versions[id], nil }
	plan, err := ResolveProjectBaseline(context.Background(), "ecm6", load)
	if err != nil || len(plan.Repos) != 2 || len(plan.MissingVersions) != 1 {
		t.Fatalf("partial baseline = %+v, %v", plan, err)
	}
	missing := plan.MissingVersions[0]
	if missing.VersionID != "base6" || missing.ProductID != "base" || missing.ProductName != "Low code" || missing.VersionName != "v6.0.0.0" {
		t.Fatalf("missing dependency identity lost: %+v", missing)
	}
	if _, err := Resolve(context.Background(), "ecm6", "", nil, nil, load); err == nil ||
		!strings.Contains(err.Error(), "Low code / 版本 v6.0.0.0") {
		t.Fatalf("execution should identify the missing dependency product: %v", err)
	}
	v := versions["base6"]
	v.Config.Dependencies = []string{"ecm6"}
	versions["base6"] = v
	plan, err = ResolveProjectBaseline(context.Background(), "ecm6", load)
	if err != nil || len(plan.Repos) != 1 || len(plan.MissingVersions) != 1 {
		t.Fatalf("partial baseline should visit each cyclic dependency once: %+v, %v", plan, err)
	}
	v.Config.Dependencies = nil
	v.ProductID = "ecm"
	versions["base6"] = v
	if _, err := ResolveProjectBaseline(context.Background(), "ecm6", load); err == nil {
		t.Fatal("partial baseline accepted conflicting product versions")
	}
}

func TestResolve(t *testing.T) {
	module := Module{Key: "api", RepoURL: "https://git.example/ecm.git", Ref: "v6", Remark: "Use the legacy CI without changing its build entrypoint."}
	base := Version{ID: "v1", ProductID: "ecm", ProductSlug: "ecm", Name: "V6", Config: Config{Modules: []Module{module}}}
	for _, tc := range []struct {
		name               string
		versions           map[string]Version
		overrides, project map[string]string
		wantRef            string
		wantError          bool
	}{
		{name: "baseline", wantRef: "v6"},
		{name: "project", project: map[string]string{"v1/api": "customer"}, wantRef: "customer"},
		{name: "ticket wins", project: map[string]string{"v1/api": "customer"}, overrides: map[string]string{"v1/api": "fix"}, wantRef: "fix"},
		{name: "missing project ref", project: map[string]string{"v1/api": ""}, wantError: true},
		{name: "unknown override", overrides: map[string]string{"v1/missing": "fix"}, wantError: true},
		{name: "cycle", versions: map[string]Version{"v1": {ID: "v1", ProductID: "ecm", ProductSlug: "ecm", Name: "V6", Config: Config{Modules: []Module{module}, Dependencies: []string{"v1"}}}}, wantRef: "v6"},
		{name: "missing dependency", versions: map[string]Version{"v1": {ID: "v1", ProductID: "ecm", ProductSlug: "ecm", Name: "V6", Config: Config{Modules: []Module{module}, Dependencies: []string{"missing"}}}}, wantError: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			versions := tc.versions
			if versions == nil {
				versions = map[string]Version{"v1": base}
			}
			plan, err := Resolve(context.Background(), "v1", "root", tc.overrides, tc.project, func(_ context.Context, id string) (Version, error) {
				if v, ok := versions[id]; ok {
					return v, nil
				}
				return Version{}, fmt.Errorf("not found")
			})
			if (err != nil) != tc.wantError {
				t.Fatalf("error = %v", err)
			}
			if err == nil && plan.Repos[0].Ref != tc.wantRef {
				t.Fatalf("ref = %s", plan.Repos[0].Ref)
			}
			if err == nil && plan.Repos[0].Remark != module.Remark {
				t.Fatalf("module remark lost from execution plan: %+v", plan.Repos[0])
			}
		})
	}
}

func TestValidate(t *testing.T) {
	for _, subpath := range []string{"../outside", "/outside", `C:\outside`, "a/../b", `a\b`} {
		err := Validate(Config{Modules: []Module{{Key: "api", RepoURL: "https://git.example/repo.git", Ref: "v6", Subpath: subpath}}})
		if err == nil {
			t.Errorf("accepted unsafe subpath %q", subpath)
		}
	}
	for _, ref := range []string{"", "-x", "a..b", "a\nb", "a:b", "a@{b", "x.lock", "x.", ".hidden", "a//b", "/a", "@", "a\x00b"} {
		if ValidateRef(ref) {
			t.Errorf("accepted invalid ref %q", ref)
		}
	}
}

func TestWorkOrderRepositoryURLs(t *testing.T) {
	for _, raw := range []string{"https://git.test/team/api.git", "ssh://git@git.test:2222/team/api.git", "git@git.test:team/api.git"} {
		if err := Validate(Config{Modules: []Module{{Key: "api", RepoURL: raw, Ref: "legacy/v6"}}}); err != nil {
			t.Errorf("rejected repository %q: %v", raw, err)
		}
	}
	for _, raw := range []string{"https://token@git.test/a", "ssh://git:password@git.test/a", "https://git.test/a?token=x", "file:///tmp/repo", "C:\\repo", "-host:a", "git@git.test:a\nb"} {
		if err := Validate(Config{Modules: []Module{{Key: "api", RepoURL: raw, Ref: "v6"}}}); err == nil {
			t.Errorf("accepted unsafe repository %q", raw)
		}
	}
}

func TestResolveIndependentCheckoutsAndVersionConflict(t *testing.T) {
	module := Module{Key: "api", RepoURL: "https://git.example/repo.git", Ref: "v9"}
	versions := map[string]Version{
		"v1": {ID: "v1", ProductID: "one", ProductSlug: "ecm", Name: "V6", Config: Config{Modules: []Module{module}, Dependencies: []string{"v2"}}},
		"v2": {ID: "v2", ProductID: "two", ProductSlug: "inbiz", Name: "V3", Config: Config{Modules: []Module{module}}},
	}
	load := func(_ context.Context, id string) (Version, error) { return versions[id], nil }
	plan, err := Resolve(context.Background(), "v1", "", nil, nil, load)
	if err != nil || len(plan.Repos) != 2 || plan.Repos[0].Directory != "code/ecm/V6/api" || plan.Repos[1].Directory != "code/inbiz/V3/api" {
		t.Fatalf("independent checkouts = %+v, %v", plan, err)
	}
	v := versions["v2"]
	v.Config.Modules = []Module{{Key: "api", RepoURL: module.RepoURL, Ref: "v8"}}
	versions["v2"] = v
	if plan, err = Resolve(context.Background(), "v1", "", nil, nil, load); err != nil || plan.Repos[1].Ref != "v8" {
		t.Fatalf("independent directories must support different refs: %+v %v", plan, err)
	}
	v.ProductID = "one"
	versions["v2"] = v
	if _, err = Resolve(context.Background(), "v1", "", nil, nil, load); err == nil {
		t.Fatal("accepted conflicting product versions")
	}
}

func TestResolveMainAndRecursiveDependencyModules(t *testing.T) {
	main := Module{Key: "main", Name: "Main", RepoURL: "https://git.example/main.git", Ref: "legacy"}
	versions := map[string]Version{
		"ecm6": {ID: "ecm6", ProductID: "ecm-id", ProductSlug: "ecm", Name: "v6", Config: Config{
			Modules:      []Module{main, {Key: "api", Directory: "services/backend", RepoURL: "https://git.example/api.git", Ref: "v6", Subpath: "src"}},
			Dependencies: []string{"inbiz3", "search2"},
		}},
		"inbiz3":  {ID: "inbiz3", ProductID: "inbiz-id", ProductSlug: "inbiz", Name: "v3", Config: Config{Modules: []Module{main}, Dependencies: []string{"search2"}}},
		"search2": {ID: "search2", ProductID: "search-id", ProductSlug: "search", Name: "v2", Config: Config{Modules: []Module{main}}},
	}
	load := func(_ context.Context, id string) (Version, error) { return versions[id], nil }
	plan, err := Resolve(context.Background(), "ecm6", "root", nil, nil, load)
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"code/ecm/v6/main", "code/ecm/v6/services/backend", "code/inbiz/v3/main", "code/search/v2/main"}
	if len(plan.Repos) != len(want) {
		t.Fatalf("diamond dependency duplicated or omitted modules: %+v", plan.Repos)
	}
	for i, directory := range want {
		if plan.Repos[i].Directory != directory {
			t.Errorf("checkout %d = %q, want %q", i, plan.Repos[i].Directory, directory)
		}
	}
	if plan.Repos[1].Subpath != "src" || plan.Repos[0].KBPath != "ecm/v6/main/legacy" {
		t.Fatalf("source subpath or knowledge path lost: %+v", plan.Repos)
	}
	v := versions["ecm6"]
	v.ProductSlug = ""
	versions["ecm6"] = v
	if _, err := Resolve(context.Background(), "ecm6", "", nil, nil, load); err == nil {
		t.Fatal("missing product identifier must block preparation")
	}
}

func TestResolveCyclicDependenciesOnceFromEitherProduct(t *testing.T) {
	module := Module{Key: "main", RepoURL: "https://git.example/repo.git", Ref: "baseline"}
	versions := map[string]Version{
		"ecm6": {ID: "ecm6", ProductID: "ecm", ProductSlug: "ecm", Name: "v6",
			Config: Config{Modules: []Module{module}, Dependencies: []string{"inbiz3", "search2"}, Compose: "ecm compose"}},
		"inbiz3": {ID: "inbiz3", ProductID: "inbiz", ProductSlug: "inbiz", Name: "v3",
			Config: Config{Modules: []Module{module}, Dependencies: []string{"ecm6", "search2"}, Compose: "inbiz compose"}},
		"search2": {ID: "search2", ProductID: "search", ProductSlug: "search", Name: "v2",
			Config: Config{Modules: []Module{module}, Dependencies: []string{"inbiz3"}}},
	}
	for _, root := range []string{"ecm6", "inbiz3"} {
		t.Run(root, func(t *testing.T) {
			loads := map[string]int{}
			load := func(_ context.Context, id string) (Version, error) {
				loads[id]++
				if loads[id] > 1 {
					return Version{}, fmt.Errorf("version %s loaded more than once", id)
				}
				return versions[id], nil
			}
			plan, err := Resolve(context.Background(), root, "kb", map[string]string{"ecm6/main": "ticket"},
				map[string]string{"ecm6/main": "project", "inbiz3/main": "customer"}, load)
			if err != nil {
				t.Fatal(err)
			}
			if len(plan.Repos) != len(versions) || plan.Compose != versions[root].Config.Compose || plan.KBRootID != "kb" {
				t.Fatalf("cyclic plan = %+v", plan)
			}
			seen := map[string]bool{}
			for _, repo := range plan.Repos {
				if seen[repo.VersionID] || loads[repo.VersionID] != 1 {
					t.Fatalf("version not resolved exactly once: %+v, loads=%v", plan.Repos, loads)
				}
				seen[repo.VersionID] = true
				version := versions[repo.VersionID]
				if repo.Directory != "code/"+version.ProductSlug+"/"+version.Name+"/main" || repo.BaseRef != "baseline" {
					t.Fatalf("incorrect checkout: %+v", repo)
				}
				wantRef, wantSource := "baseline", "baseline"
				if repo.VersionID == "ecm6" {
					wantRef, wantSource = "ticket", "ticket"
				} else if repo.VersionID == "inbiz3" {
					wantRef, wantSource = "customer", "project"
				}
				if repo.Ref != wantRef || repo.RefSource != wantSource {
					t.Fatalf("branch override lost in cycle: %+v", repo)
				}
			}
		})
	}
	conflict := versions["ecm6"]
	conflict.ID, conflict.Name = "ecm7", "v7"
	conflict.Config.Dependencies = nil
	versions["ecm7"] = conflict
	search := versions["search2"]
	search.Config.Dependencies = append(search.Config.Dependencies, "ecm7")
	versions["search2"] = search
	load := func(_ context.Context, id string) (Version, error) { return versions[id], nil }
	if _, err := Resolve(context.Background(), "ecm6", "", nil, nil, load); err == nil ||
		!strings.Contains(err.Error(), "conflicting versions") {
		t.Fatalf("version conflict beyond a cycle should still fail: %v", err)
	}
}

func TestPortableCheckoutDirectories(t *testing.T) {
	for _, slug := range []string{"ecm", "inbiz_v6", "product-2"} {
		if !ValidProductSlug(slug) {
			t.Errorf("rejected slug %q", slug)
		}
	}
	for _, slug := range []string{"", "ECM", "../ecm", "con", "lpt1", "ecm/test", "产品"} {
		if ValidProductSlug(slug) {
			t.Errorf("accepted slug %q", slug)
		}
	}
	module := func(key, directory string) Module {
		return Module{Key: key, Directory: directory, RepoURL: "https://git.example/repo.git", Ref: "v6"}
	}
	for _, directory := range []string{"../outside", "/outside", "a/../b", `a\b`, "a//b", "con", "aux.txt", "api.", ".git", "C:/repo"} {
		if err := Validate(Config{Modules: []Module{module("main", directory)}}); err == nil {
			t.Errorf("accepted unsafe checkout directory %q", directory)
		}
	}
	for _, directories := range [][2]string{{"api", "API"}, {"api", "api/web"}, {"api/web", "api"}, {"", "main"}} {
		if err := Validate(Config{Modules: []Module{module("main", directories[0]), module("web", directories[1])}}); err == nil {
			t.Errorf("accepted overlapping directories %q", directories)
		}
	}
	for _, tc := range []struct{ name, want string }{
		{"v6", "v6"}, {" release/v6:win ", "release-v6-win"}, {"CON", "_CON"}, {"版本6", "版本6"},
	} {
		got, err := VersionDirectory(tc.name)
		if err != nil || got != tc.want {
			t.Errorf("VersionDirectory(%q) = %q, %v", tc.name, got, err)
		}
	}
	if _, err := VersionDirectory("..."); err == nil {
		t.Fatal("accepted empty version path")
	}
}

func TestValidateDependencies(t *testing.T) {
	for _, tc := range []struct {
		name      string
		deps      map[string][]string
		wantError bool
	}{
		{"diamond", map[string][]string{"a": {"b", "c"}, "b": {"c"}}, false},
		{"cycle", map[string][]string{"a": {"b"}, "b": {"a"}}, false},
		{"long cycle", map[string][]string{"a": {"b", "c"}, "b": {"c"}, "c": {"a"}}, false},
		{"duplicate after cycle", map[string][]string{"a": {"b"}, "b": {"a", "c", "c"}}, true},
		{"conflict after cycle", map[string][]string{"a": {"b"}, "b": {"a", "b2"}}, true},
		{"missing after cycle", map[string][]string{"a": {"b"}, "b": {"a", "missing"}}, true},
		{"duplicate", map[string][]string{"a": {"b", "b"}}, true},
		{"different versions of one product", map[string][]string{"a": {"b", "b2"}}, true},
		{"missing", map[string][]string{"a": {"missing"}}, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			loads := map[string]int{}
			load := func(_ context.Context, id string) (Version, error) {
				loads[id]++
				if loads[id] > 1 {
					t.Fatalf("version %s loaded more than once", id)
				}
				product := id
				if id == "missing" {
					return Version{}, fmt.Errorf("not found")
				}
				if id == "b2" {
					product = "b"
				}
				return Version{ID: id, ProductID: product, Config: Config{Dependencies: tc.deps[id]}}, nil
			}
			if err := ValidateDependencies(context.Background(), "a", load); (err != nil) != tc.wantError {
				t.Fatalf("error = %v", err)
			}
		})
	}
}
