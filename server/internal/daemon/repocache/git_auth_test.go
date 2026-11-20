package repocache

import (
	"context"
	"strings"
	"testing"
)

func TestGitLabCredentialIsTransientAndScoped(t *testing.T) {
	ctx := WithGitLabCredential(context.Background(), "https://git.test", "private-token",
		"git@git.test:team/app.git", "https://git.test/team/app.git")
	cmd := newGitCommand("fetch", "origin")
	cmd.Env = append(cmd.Env, "GIT_CONFIG_COUNT=1", "GIT_CONFIG_KEY_0=http.sslVerify", "GIT_CONFIG_VALUE_0=false")
	applyGitCredential(ctx, cmd)
	env := strings.Join(cmd.Env, "\n")
	if !strings.Contains(env, "http.https://git.test/.extraHeader") ||
		!strings.Contains(env, "=safe.directory") ||
		!strings.Contains(env, "url.https://git.test/team/app.git.insteadOf") ||
		strings.Contains(strings.Join(cmd.Args, " "), "private-token") ||
		strings.Contains(env, "sslVerify") {
		t.Fatalf("incorrect transient credential configuration")
	}
	if got := string(redactGitCredential(ctx, []byte("private-token"))); strings.Contains(got, "private-token") {
		t.Fatal("credential leaked through git diagnostics")
	}
	plain := newGitCommand("status")
	for _, entry := range plain.Env {
		if strings.Contains(entry, "private-token") || strings.Contains(entry, "Authorization: Basic") {
			t.Fatal("credential leaked outside daemon operation context")
		}
	}
}
