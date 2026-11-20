package workorder

import (
	"regexp"
	"strings"
	"unicode"

	"github.com/mozillazg/go-pinyin"
)

var branchSeparators = regexp.MustCompile(`[-._]{2,}`)

func branchSegment(value string) string {
	args := pinyin.NewArgs()
	args.Style = pinyin.Normal
	var result strings.Builder
	for _, r := range strings.ToLower(value) {
		if unicode.Is(unicode.Han, r) {
			parts := pinyin.SinglePinyin(r, args)
			if len(parts) > 0 {
				if result.Len() > 0 {
					result.WriteByte('-')
				}
				result.WriteString(strings.ReplaceAll(parts[0], "\u00fc", "v"))
				result.WriteByte('-')
				continue
			}
		}
		if r >= 'a' && r <= 'z' || r >= '0' && r <= '9' || strings.ContainsRune("._-", r) {
			result.WriteRune(r)
		} else {
			result.WriteByte('-')
		}
	}
	slug := strings.Trim(branchSeparators.ReplaceAllString(result.String(), "-"), "-._")
	if slug == "" {
		return "x"
	}
	return slug
}

func ProjectBranchName(project, version string) string {
	branch := "proj-" + branchSegment(project) + "-" + branchSegment(version)
	if len(branch) > 200 {
		branch = branch[:200]
	}
	return strings.TrimRight(branch, "-._")
}
