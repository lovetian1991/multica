package workorder

import (
	"context"
	"fmt"
	"net/url"
	"path"
	"regexp"
	"strings"
)

type Image struct {
	Service string `json:"service"`
	Image   string `json:"image"`
	CIURL   string `json:"ci_url"`
}

type Module struct {
	Key       string  `json:"key"`
	Name      string  `json:"name"`
	RepoURL   string  `json:"repo_url"`
	Ref       string  `json:"ref"`
	Directory string  `json:"directory"`
	Subpath   string  `json:"subpath"`
	Remark    string  `json:"remark"`
	Images    []Image `json:"images"`
}

type Config struct {
	Modules      []Module `json:"modules"`
	Dependencies []string `json:"dependencies"`
	Compose      string   `json:"compose"`
}

type Version struct {
	ID          string
	ProductID   string
	ProductName string
	ProductSlug string
	Name        string
	Config      Config
}

type Checkout struct {
	VersionID   string `json:"version_id"`
	ProductID   string `json:"product_id"`
	ModuleKey   string `json:"module_key"`
	Name        string `json:"name"`
	VersionName string `json:"version_name"`
	RepoURL     string `json:"repo_url"`
	Ref         string `json:"ref"`
	// BaseRef remains the upstream version baseline, never a personal branch.
	BaseRef   string  `json:"base_ref"`
	Subpath   string  `json:"subpath"`
	Remark    string  `json:"remark"`
	Directory string  `json:"directory"`
	KBPath    string  `json:"kb_path"`
	RefSource string  `json:"ref_source"`
	Images    []Image `json:"images"`
}

type Plan struct {
	PersonalFork    bool             `json:"personal_fork,omitempty"`
	VersionID       string           `json:"version_id"`
	KBRootID        string           `json:"kb_root_id"`
	Repos           []Checkout       `json:"repos"`
	Compose         string           `json:"compose"`
	MissingVersions []MissingVersion `json:"missing_versions,omitempty"`
}

type MissingVersion struct {
	VersionID   string `json:"version_id"`
	ProductID   string `json:"product_id"`
	ProductName string `json:"product_name"`
	VersionName string `json:"version_name"`
}

var moduleKey = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$`)
var scpRepo = regexp.MustCompile(`^[a-zA-Z0-9_.-]+@[a-zA-Z0-9][a-zA-Z0-9.-]*:[^/].+$`)
var productSlug = regexp.MustCompile(`^[a-z][a-z0-9_-]{0,63}$`)
var directoryPart = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$`)

func reservedDirectory(s string) bool {
	base := strings.ToLower(strings.SplitN(s, ".", 2)[0])
	return base == "con" || base == "prn" || base == "aux" || base == "nul" ||
		(len(base) == 4 && (strings.HasPrefix(base, "com") || strings.HasPrefix(base, "lpt")) && base[3] >= '1' && base[3] <= '9')
}

func ValidProductSlug(s string) bool {
	return productSlug.MatchString(s) && !reservedDirectory(s)
}

func ValidModuleDirectory(s string) bool {
	if s == "" || len(s) > 256 {
		return false
	}
	for _, part := range strings.Split(s, "/") {
		if !directoryPart.MatchString(part) || strings.HasSuffix(part, ".") || reservedDirectory(part) {
			return false
		}
	}
	return true
}

// VersionDirectory preserves display names while making each version one portable path segment.
func VersionDirectory(name string) (string, error) {
	value := strings.Trim(strings.Map(func(r rune) rune {
		if r < 32 || r == 127 || strings.ContainsRune(`<>:"/\|?*`, r) {
			return '-'
		}
		return r
	}, name), " .")
	if value == "" || len(value) > 180 {
		return "", fmt.Errorf("版本名称无法用作目录")
	}
	if reservedDirectory(value) {
		value = "_" + value
	}
	return value, nil
}

func ValidateRef(ref string) bool {
	if ref == "" || ref == "@" || len(ref) > 256 || strings.HasPrefix(ref, "-") ||
		strings.ContainsAny(ref, "\\~^:?*[") || strings.Contains(ref, "..") ||
		strings.Contains(ref, "@{") || strings.HasSuffix(ref, ".") {
		return false
	}
	for _, r := range ref {
		if r <= ' ' || r == 127 {
			return false
		}
	}
	for _, part := range strings.Split(ref, "/") {
		if part == "" || strings.HasPrefix(part, ".") || strings.HasSuffix(part, ".lock") {
			return false
		}
	}
	return true
}

func validRepoURL(raw string) bool {
	if len(raw) > 2048 || strings.ContainsAny(raw, " \t\r\n\x00") {
		return false
	}
	if !strings.Contains(raw, "://") {
		return scpRepo.MatchString(raw) && !strings.ContainsAny(raw, "\\?#")
	}
	u, err := url.Parse(raw)
	if err != nil || u.Hostname() == "" || u.Path == "" || u.Path == "/" || u.RawQuery != "" || u.Fragment != "" {
		return false
	}
	if u.Scheme == "ssh" {
		if u.User != nil {
			_, password := u.User.Password()
			return u.User.Username() != "" && !password
		}
		return true
	}
	return (u.Scheme == "https" || u.Scheme == "http") && u.User == nil
}

func Validate(c Config) error {
	if len(c.Modules) > 100 || len(c.Dependencies) > 100 || len(c.Compose) > 128*1024 {
		return fmt.Errorf("version configuration is too large")
	}
	keys := map[string]bool{}
	directories := []string{}
	for _, m := range c.Modules {
		if !moduleKey.MatchString(m.Key) || keys[strings.ToLower(m.Key)] {
			return fmt.Errorf("module key must be unique and contain only letters, digits, underscores or hyphens")
		}
		keys[strings.ToLower(m.Key)] = true
		directory := m.Directory
		if directory == "" {
			directory = m.Key
		}
		if !ValidModuleDirectory(directory) {
			return fmt.Errorf("模块 %s 的落盘目录无效，请使用相对目录，如 backend 或 services/api", m.Key)
		}
		lower := strings.ToLower(directory)
		for _, previous := range directories {
			if lower == previous || strings.HasPrefix(lower, previous+"/") || strings.HasPrefix(previous, lower+"/") {
				return fmt.Errorf("模块落盘目录不能重复或互相嵌套：%s", directory)
			}
		}
		directories = append(directories, lower)
		if !validRepoURL(m.RepoURL) {
			return fmt.Errorf("module %s requires an HTTP(S) or SSH repository URL without embedded passwords or tokens", m.Key)
		}
		if !ValidateRef(m.Ref) {
			return fmt.Errorf("module %s requires an explicit valid branch, tag or SHA", m.Key)
		}
		if m.Subpath != "" && (path.IsAbs(m.Subpath) || path.Clean(m.Subpath) != m.Subpath || m.Subpath == ".." || strings.HasPrefix(m.Subpath, "../") || strings.ContainsAny(m.Subpath, "\\:\x00")) {
			return fmt.Errorf("module %s has an unsafe relative subpath", m.Key)
		}
		if len(m.Name) > 256 || len(m.Remark) > 4000 || len(m.Images) > 50 {
			return fmt.Errorf("module %s is too large", m.Key)
		}
		services := map[string]bool{}
		for _, image := range m.Images {
			if !moduleKey.MatchString(image.Service) || services[image.Service] || len(image.Image) > 2048 || strings.ContainsAny(image.Image, " \t\r\n") {
				return fmt.Errorf("module %s has an invalid or duplicate image service", m.Key)
			}
			services[image.Service] = true
		}
	}
	return nil
}

type LoadVersion func(context.Context, string) (Version, error)

func ValidateDependencies(ctx context.Context, root string, load LoadVersion) error {
	visited := map[string]bool{}
	products := map[string]string{}
	var visit func(string) error
	visit = func(id string) error {
		if visited[id] {
			return nil
		}
		v, err := load(ctx, id)
		if err != nil {
			return err
		}
		if previous, exists := products[v.ProductID]; exists && previous != id {
			return fmt.Errorf("同一产品不能同时依赖多个版本")
		}
		products[v.ProductID] = id
		visited[id] = true
		direct := map[string]bool{}
		for _, dependency := range v.Config.Dependencies {
			if direct[dependency] {
				return fmt.Errorf("不能重复添加同一依赖版本")
			}
			direct[dependency] = true
			if err := visit(dependency); err != nil {
				return err
			}
		}
		return nil
	}
	return visit(root)
}

// Resolve uses concrete dependency versions and rejects conflicting baselines.
func Resolve(ctx context.Context, root, kbRoot string, overrides, projectRefs map[string]string, load LoadVersion) (Plan, error) {
	return resolve(ctx, root, kbRoot, overrides, projectRefs, load, false)
}

// Project configuration can be saved before every dependency has repositories.
// Execution continues to use Resolve, which requires the complete code plan.
func ResolveProjectBaseline(ctx context.Context, root string, load LoadVersion) (Plan, error) {
	return resolve(ctx, root, "", nil, nil, load, true)
}

func resolve(ctx context.Context, root, kbRoot string, overrides, projectRefs map[string]string, load LoadVersion, allowMissing bool) (Plan, error) {
	plan := Plan{VersionID: root, KBRootID: kbRoot, Repos: []Checkout{}}
	visited := map[string]bool{}
	products, slugs, consumed := map[string]string{}, map[string]string{}, map[string]bool{}
	var visit func(string) error
	visit = func(id string) error {
		if visited[id] {
			return nil
		}
		v, err := load(ctx, id)
		if err != nil {
			return fmt.Errorf("load version %s: %w", id, err)
		}
		if err := Validate(v.Config); err != nil {
			return err
		}
		if len(v.Config.Modules) == 0 {
			if !allowMissing {
				return fmt.Errorf("产品 %s / 版本 %s 尚未配置模块仓库，请先维护代码配置", v.ProductName, v.Name)
			}
			plan.MissingVersions = append(plan.MissingVersions, MissingVersion{
				VersionID: id, ProductID: v.ProductID, ProductName: v.ProductName, VersionName: v.Name,
			})
		}
		if len(v.Config.Modules) > 0 && !ValidProductSlug(v.ProductSlug) {
			return fmt.Errorf("请先维护产品 %s 的英文标识", v.ProductID)
		}
		if previous, exists := slugs[v.ProductSlug]; v.ProductSlug != "" && exists && previous != v.ProductID {
			return fmt.Errorf("产品英文标识重复：%s", v.ProductSlug)
		}
		if v.ProductSlug != "" {
			slugs[v.ProductSlug] = v.ProductID
		}
		versionDirectory, err := VersionDirectory(v.Name)
		if err != nil {
			return err
		}
		if previous, exists := products[v.ProductID]; exists && previous != id {
			return fmt.Errorf("conflicting versions for product %s", v.ProductID)
		}
		products[v.ProductID] = id
		visited[id] = true
		if id == root {
			plan.Compose = v.Config.Compose
		}
		for _, m := range v.Config.Modules {
			key := id + "/" + m.Key
			ref, source := m.Ref, "baseline"
			if r, exists := projectRefs[key]; exists {
				if !ValidateRef(r) {
					return fmt.Errorf("project branch is missing for %s", key)
				}
				ref, source = r, "project"
			}
			if r, exists := overrides[key]; exists {
				if !ValidateRef(r) {
					return fmt.Errorf("invalid ticket branch for %s", key)
				}
				ref, source, consumed[key] = r, "ticket", true
			}
			directory := path.Join("code", v.ProductSlug, versionDirectory)
			moduleDirectory := m.Directory
			if moduleDirectory == "" {
				moduleDirectory = m.Key
			}
			directory = path.Join(directory, moduleDirectory)
			plan.Repos = append(plan.Repos, Checkout{
				VersionID: id, ProductID: v.ProductID, ModuleKey: m.Key, Name: m.Name,
				VersionName: v.Name, RepoURL: m.RepoURL, Ref: ref, BaseRef: m.Ref,
				Subpath: m.Subpath, Directory: directory,
				KBPath:    path.Join(v.ProductSlug, versionDirectory, m.Key, url.PathEscape(ref)),
				RefSource: source, Remark: m.Remark, Images: m.Images,
			})
		}
		for _, dependency := range v.Config.Dependencies {
			if err := visit(dependency); err != nil {
				return err
			}
		}
		return nil
	}
	if err := visit(root); err != nil {
		return Plan{}, err
	}
	for key := range overrides {
		if !consumed[key] {
			return Plan{}, fmt.Errorf("branch override references unknown module %s", key)
		}
	}
	return plan, nil
}
