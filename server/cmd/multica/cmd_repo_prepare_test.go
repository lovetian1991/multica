package main

import (
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"testing"

	"github.com/multica-ai/multica/server/internal/cli"
	"github.com/spf13/cobra"
)

func TestRepoPrepareRejectsDaemonConnectedToDifferentServer(t *testing.T) {
	t.Chdir(t.TempDir())
	redirectTestHome(t, t.TempDir())
	const profile = "prepare-environment-test"
	if err := cli.SaveCLIConfigForProfile(cli.CLIConfig{
		Token: "mul_test", ServerURL: "http://localhost:18267",
		WorkspaceID: "3783fad5-02b4-43d3-8a1b-13e5e435ecc4",
	}, profile); err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/health" {
			t.Error("preparation was attempted against the wrong environment")
			http.Error(w, "unexpected preparation", http.StatusInternalServerError)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"status": "running", "profile": profile, "pid": os.Getpid(),
			"server_url": "http://production.example.test",
		})
	}))
	defer server.Close()
	_, portString, err := net.SplitHostPort(strings.TrimPrefix(server.URL, "http://"))
	if err != nil {
		t.Fatal(err)
	}
	port, err := strconv.Atoi(portString)
	if err != nil {
		t.Fatal(err)
	}
	if err := publishDaemonPort(profile, daemonPortRecord{Port: port, PID: os.Getpid()}); err != nil {
		t.Fatal(err)
	}
	cmd := &cobra.Command{Use: "prepare-product"}
	cmd.Flags().String("profile", profile, "")
	cmd.Flags().String("server-url", "", "")
	cmd.Flags().String("workspace-id", "", "")
	err = runRepoPrepareProduct(cmd, []string{"53853451-9617-4ad9-a5ee-4c81f6818732"})
	if err == nil || !strings.Contains(err.Error(), "daemon is connected to") {
		t.Fatalf("wrong environment was not rejected: %v", err)
	}
}
