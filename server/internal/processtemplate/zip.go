package processtemplate

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"path"
	"sort"
	"strings"
	"unicode"

	skillpkg "github.com/multica-ai/multica/server/internal/skill"
)

const (
	// MaxZipSize is the compressed upload cap for a process template. It is
	// independent of plugincontract.MaxBundleSize (2 MiB).
	MaxZipSize = 20 << 20

	maxEntrySize = 2 << 20
)

type File struct {
	Path    string
	Content string
}

type Agent struct {
	Key          string
	DisplayName  string
	Description  string
	Instructions string
	Skills       []string
}

type Squad struct {
	Key          string
	DisplayName  string
	Description  string
	Instructions string
	Leader       string
	Members      []string
}

type Skill struct {
	Name        string
	Description string
	Content     string
	Files       []File
}

type Archive struct {
	Agents []Agent
	Squads []Squad
	Skills []Skill
}

type Manifest struct {
	Agents []string `json:"agents"`
	Squads []string `json:"squads"`
	Skills []string `json:"skills"`
}

type mappingEntry struct {
	DisplayName string   `json:"displayName"`
	Description string   `json:"description"`
	Leader      string   `json:"leader"`
	Members     []string `json:"members"`
	Skills      []string `json:"skills"`
}

func (a Archive) Manifest() Manifest {
	m := Manifest{
		Agents: make([]string, 0, len(a.Agents)),
		Squads: make([]string, 0, len(a.Squads)),
		Skills: make([]string, 0, len(a.Skills)),
	}
	for _, agent := range a.Agents {
		m.Agents = append(m.Agents, agent.Key)
	}
	for _, squad := range a.Squads {
		m.Squads = append(m.Squads, squad.Key)
	}
	for _, skill := range a.Skills {
		m.Skills = append(m.Skills, skill.Name)
	}
	sort.Strings(m.Agents)
	sort.Strings(m.Squads)
	sort.Strings(m.Skills)
	return m
}

func ParseZip(data []byte) (Archive, error) {
	if len(data) == 0 {
		return Archive{}, fmt.Errorf("zip archive is empty")
	}
	if len(data) > MaxZipSize {
		return Archive{}, fmt.Errorf("zip archive exceeds %d bytes", MaxZipSize)
	}
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return Archive{}, fmt.Errorf("uploaded file is not a valid zip archive")
	}

	files := make(map[string]string)
	var names []string
	for _, f := range zr.File {
		if f.FileInfo().IsDir() || strings.HasSuffix(f.Name, `\`) {
			continue
		}
		clean := cleanArchiveEntryName(f.Name)
		if isIgnoredArchiveEntry(clean) || !validateArchiveFilePath(clean) {
			continue
		}
		if previous, exists := files[clean]; exists {
			return Archive{}, fmt.Errorf("archive entries %q and %q resolve to the same path %q", previous, f.Name, clean)
		}
		content, err := readZipFile(f, maxEntrySize)
		if err != nil {
			return Archive{}, err
		}
		files[clean] = content
		names = append(names, clean)
	}
	if len(files) == 0 {
		return Archive{}, fmt.Errorf("zip archive does not contain any template files")
	}

	root := detectContentRoot(names)
	archive := Archive{}
	agentMapping, err := parseMapping("agents/mapping.json", files[root+"agents/mapping.json"])
	if err != nil {
		return Archive{}, err
	}
	squadMapping, err := parseMapping("squad/mapping.json", files[root+"squad/mapping.json"])
	if err != nil {
		return Archive{}, err
	}

	for name, content := range files {
		rel := strings.TrimPrefix(name, root)
		if rel == name && root != "" {
			continue
		}
		switch {
		case isAgentMarkdown(rel):
			key := strings.TrimSuffix(path.Base(rel), path.Ext(rel))
			if key == "mapping" {
				continue
			}
			entry := agentMapping[key]
			agent := Agent{
				Key:          key,
				DisplayName:  firstNonEmpty(entry.DisplayName, key),
				Description:  entry.Description,
				Instructions: firstFencedBlock(content),
			}
			if entry.Skills != nil {
				agent.Skills = append([]string{}, entry.Skills...)
			}
			archive.Agents = append(archive.Agents, agent)
		case strings.HasPrefix(rel, "squad/") && strings.EqualFold(path.Base(rel), "squad.md"):
			key := squadKeyFromPath(rel)
			if key == "" {
				continue
			}
			entry := squadMapping[key]
			archive.Squads = append(archive.Squads, Squad{
				Key:          key,
				DisplayName:  firstNonEmpty(entry.DisplayName, key),
				Description:  entry.Description,
				Instructions: firstFencedBlock(content),
				Leader:       strings.TrimSpace(entry.Leader),
				Members:      append([]string(nil), entry.Members...),
			})
		}
	}

	skillRoots := map[string]string{}
	for name := range files {
		rel := strings.TrimPrefix(name, root)
		if !strings.HasPrefix(rel, "skills/") {
			continue
		}
		if !strings.EqualFold(path.Base(rel), skillpkg.ContentFilename) {
			continue
		}
		prefix := archiveEntryPrefix(rel)
		if prefix == "skills/" {
			continue
		}
		skillRoots[prefix] = name
	}
	for prefix, skillMDPath := range skillRoots {
		content := files[skillMDPath]
		folderName := path.Base(strings.TrimSuffix(strings.TrimPrefix(prefix, "skills/"), "/"))
		if folderName == "" || folderName == "." {
			continue
		}
		_, description := skillpkg.ParseSkillFrontmatter(content)
		skill := Skill{
			Name:        folderName,
			Description: description,
			Content:     content,
		}
		for filePath, fileContent := range files {
			rel := strings.TrimPrefix(filePath, root)
			if !strings.HasPrefix(rel, prefix) {
				continue
			}
			inner := strings.TrimPrefix(rel, prefix)
			if inner == "" || strings.EqualFold(path.Base(inner), skillpkg.ContentFilename) {
				continue
			}
			if skillpkg.IsLikelyBinaryFilePath(inner) {
				continue
			}
			skill.Files = append(skill.Files, File{Path: inner, Content: fileContent})
		}
		sort.Slice(skill.Files, func(i, j int) bool { return skill.Files[i].Path < skill.Files[j].Path })
		archive.Skills = append(archive.Skills, skill)
	}

	sort.Slice(archive.Agents, func(i, j int) bool { return archive.Agents[i].Key < archive.Agents[j].Key })
	sort.Slice(archive.Squads, func(i, j int) bool { return archive.Squads[i].Key < archive.Squads[j].Key })
	sort.Slice(archive.Skills, func(i, j int) bool { return archive.Skills[i].Name < archive.Skills[j].Name })
	if len(archive.Agents) == 0 && len(archive.Squads) == 0 && len(archive.Skills) == 0 {
		return Archive{}, fmt.Errorf("zip archive does not contain agents, squads, or skills")
	}
	if err := archive.validate(); err != nil {
		return Archive{}, err
	}
	return archive, nil
}

func detectContentRoot(names []string) string {
	best := ""
	bestLen := -1
	for _, name := range names {
		parts := strings.Split(name, "/")
		for i, part := range parts {
			if part != "agents" && part != "squad" && part != "skills" {
				continue
			}
			prefix := ""
			if i > 0 {
				prefix = strings.Join(parts[:i], "/") + "/"
			}
			if bestLen < 0 || len(prefix) < bestLen {
				best = prefix
				bestLen = len(prefix)
			}
			break
		}
	}
	return best
}

func isAgentMarkdown(rel string) bool {
	if path.Dir(rel) != "agents" {
		return false
	}
	return strings.EqualFold(path.Ext(rel), ".md")
}

func squadKeyFromPath(rel string) string {
	// squad/<folder>/squad.md
	dir := path.Dir(rel)
	if path.Dir(dir) != "squad" {
		return ""
	}
	return path.Base(dir)
}

func (a Archive) validate() error {
	agentKeys := map[string]struct{}{}
	for _, agent := range a.Agents {
		agentKeys[strings.ToLower(agent.Key)] = struct{}{}
	}
	for _, squad := range a.Squads {
		leader := strings.TrimSpace(squad.Leader)
		if leader == "" {
			return fmt.Errorf("squad %q is missing a leader in mapping.json", squad.Key)
		}
		if _, ok := agentKeys[strings.ToLower(leader)]; !ok {
			return fmt.Errorf("squad %q leader %q was not found in agents", squad.Key, leader)
		}
		for _, member := range squad.Members {
			member = strings.TrimSpace(member)
			if member == "" {
				continue
			}
			if _, ok := agentKeys[strings.ToLower(member)]; !ok {
				return fmt.Errorf("squad %q member %q was not found in agents", squad.Key, member)
			}
		}
	}
	for _, agent := range a.Agents {
		if agent.Skills == nil {
			continue
		}
		for _, skillName := range agent.Skills {
			skillName = strings.TrimSpace(skillName)
			if skillName == "" {
				continue
			}
			if !a.hasSkill(skillName) {
				return fmt.Errorf("agent %q skill %q was not found in skills/", agent.Key, skillName)
			}
		}
	}
	return nil
}

func (a Archive) hasSkill(name string) bool {
	for _, skill := range a.Skills {
		if MatchesIdentity(skill.Name, SkillNameCandidates(name)...) {
			return true
		}
		if MatchesIdentity(name, SkillNameCandidates(skill.Name)...) {
			return true
		}
	}
	return false
}

func parseMapping(label, raw string) (map[string]mappingEntry, error) {
	out := map[string]mappingEntry{}
	if strings.TrimSpace(raw) == "" {
		return out, nil
	}
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		return nil, fmt.Errorf("%s is invalid: %w", label, err)
	}
	return out, nil
}

func firstFencedBlock(content string) string {
	start := strings.Index(content, "```")
	if start < 0 {
		return strings.TrimSpace(content)
	}
	lineEnd := strings.Index(content[start:], "\n")
	if lineEnd < 0 {
		return strings.TrimSpace(content)
	}
	bodyStart := start + lineEnd + 1
	end := strings.Index(content[bodyStart:], "```")
	if end < 0 {
		return strings.TrimSpace(content[bodyStart:])
	}
	return strings.TrimSpace(content[bodyStart : bodyStart+end])
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func cleanArchiveEntryName(name string) string {
	return path.Clean(strings.ReplaceAll(name, "\\", "/"))
}

func validateArchiveFilePath(p string) bool {
	if p == "" || strings.ContainsRune(p, '\x00') {
		return false
	}
	if len(p) >= 2 && isASCIIAlpha(p[0]) && p[1] == ':' {
		return false
	}
	if path.IsAbs(p) {
		return false
	}
	cleaned := path.Clean(p)
	if strings.HasPrefix(cleaned, "..") {
		return false
	}
	return true
}

func isASCIIAlpha(c byte) bool {
	return c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z'
}

func archiveEntryPrefix(cleanName string) string {
	dir := path.Dir(cleanName)
	if dir == "." || dir == "/" {
		return ""
	}
	return dir + "/"
}

func isIgnoredArchiveEntry(rel string) bool {
	for _, seg := range strings.Split(rel, "/") {
		if seg == "" || seg == "__MACOSX" {
			return true
		}
		switch strings.ToLower(seg) {
		case ".git", ".svn", ".ds_store", "thumbs.db", "desktop.ini":
			return true
		}
	}
	switch strings.ToLower(path.Base(rel)) {
	case "license", "license.md", "license.txt":
		return true
	}
	return false
}

func readZipFile(f *zip.File, maxSize int64) (string, error) {
	rc, err := f.Open()
	if err != nil {
		return "", err
	}
	defer rc.Close()
	data, err := io.ReadAll(io.LimitReader(rc, maxSize+1))
	if err != nil {
		return "", err
	}
	if int64(len(data)) > maxSize {
		return "", fmt.Errorf("file %q exceeds %d bytes", f.Name, maxSize)
	}
	return string(data), nil
}

func Slugify(raw string) string {
	var b strings.Builder
	prevHyphen := false
	for _, r := range strings.ToLower(strings.TrimSpace(raw)) {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			b.WriteRune(r)
			prevHyphen = false
		case unicode.IsSpace(r) || r == '_' || r == '-' || r == '.':
			if b.Len() > 0 && !prevHyphen {
				b.WriteByte('-')
				prevHyphen = true
			}
		}
	}
	return strings.Trim(b.String(), "-")
}

// ExpandSkillName turns a short mapping skill name into the workspace skill
// name used by the best-practices templates. diagnosing-bugs and oc-bug are
// stored without the multica- prefix.
func ExpandSkillName(name string) string {
	name = strings.TrimSpace(name)
	if name == "" {
		return name
	}
	switch name {
	case "diagnosing-bugs", "oc-bug":
		return name
	}
	if strings.HasPrefix(name, "multica-") {
		return name
	}
	return "multica-" + name
}

// SkillNameCandidates returns the names a workspace skill might already use
// for the given template skill identity.
func SkillNameCandidates(name string) []string {
	name = strings.TrimSpace(name)
	if name == "" {
		return nil
	}
	seen := map[string]struct{}{}
	var out []string
	add := func(value string) {
		value = strings.TrimSpace(value)
		if value == "" {
			return
		}
		if _, ok := seen[value]; ok {
			return
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	add(name)
	add(ExpandSkillName(name))
	if strings.HasPrefix(name, "multica-") {
		add(strings.TrimPrefix(name, "multica-"))
	}
	return out
}

// MatchesIdentity reports whether name equals any template identity.
func MatchesIdentity(name string, identities ...string) bool {
	name = strings.TrimSpace(name)
	for _, identity := range identities {
		if strings.EqualFold(name, strings.TrimSpace(identity)) {
			return true
		}
	}
	return false
}
