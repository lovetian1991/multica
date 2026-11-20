package repocache

import (
	"context"
	"encoding/base64"
	"os/exec"
	"strconv"
	"strings"
)

type gitCredentialKey struct{}

type gitCredential struct {
	config []string
	token  string
	basic  string
}

// WithGitLabCredential scopes authentication and URL translation to daemon Git
// subprocesses. Neither the credential nor the translation is written to disk.
func WithGitLabCredential(ctx context.Context, instance, token, upstream, upstreamHTTP string) context.Context {
	basic := base64.StdEncoding.EncodeToString([]byte("oauth2:" + token))
	config := []string{
		"safe.directory", "*",
		"http." + strings.TrimRight(instance, "/") + "/.extraHeader", "Authorization: Basic " + basic,
		"http.followRedirects", "false",
		"credential.helper", "",
	}
	if upstream != "" && upstream != upstreamHTTP {
		config = append(config, "url."+upstreamHTTP+".insteadOf", upstream)
	}
	return context.WithValue(ctx, gitCredentialKey{}, gitCredential{config: config, token: token, basic: basic})
}

func applyGitCredential(ctx context.Context, cmd *exec.Cmd) {
	credential, ok := ctx.Value(gitCredentialKey{}).(gitCredential)
	if !ok {
		return
	}
	env := make([]string, 0, len(cmd.Env)+len(credential.config))
	for _, entry := range cmd.Env {
		key := strings.ToUpper(strings.SplitN(entry, "=", 2)[0])
		if !strings.HasPrefix(key, "GIT_CONFIG_") {
			env = append(env, entry)
		}
	}
	env = append(env, "GIT_CONFIG_COUNT="+strconv.Itoa(len(credential.config)/2), "GIT_TERMINAL_PROMPT=0")
	for i := 0; i < len(credential.config); i += 2 {
		n := strconv.Itoa(i / 2)
		env = append(env, "GIT_CONFIG_KEY_"+n+"="+credential.config[i], "GIT_CONFIG_VALUE_"+n+"="+credential.config[i+1])
	}
	cmd.Env = env
}

func redactGitCredential(ctx context.Context, output []byte) []byte {
	if c, ok := ctx.Value(gitCredentialKey{}).(gitCredential); ok {
		text := strings.ReplaceAll(string(output), c.basic, "[REDACTED]")
		if c.token != "" {
			text = strings.ReplaceAll(text, c.token, "[REDACTED]")
		}
		return []byte(text)
	}
	return output
}

// GitOutput is used by deterministic probe workflows, never agent processes.
func GitOutput(ctx context.Context, args ...string) ([]byte, error) {
	return runGitCombinedOutputContext(ctx, args...)
}
