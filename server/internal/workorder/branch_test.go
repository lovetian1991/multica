package workorder

import "testing"

func TestProjectBranchName(t *testing.T) {
	for _, tc := range []struct{ project, version, want string }{
		{"\u4e2d\u77f3\u5316", "V1.2", "proj-zhong-shi-hua-v1.2"},
		{"ECM", "\u6807\u51c6\u7248", "proj-ecm-biao-zhun-ban"},
		{"ACME / \u534e\u4e1c", "v 2.0", "proj-acme-hua-dong-v-2.0"},
	} {
		if got := ProjectBranchName(tc.project, tc.version); got != tc.want {
			t.Errorf("got %q want %q", got, tc.want)
		}
	}
}
