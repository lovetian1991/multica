package handler

import (
	"net/http"
	"testing"

	"github.com/multica-ai/multica/server/internal/testutil"
)

func TestTodoToInProgressTriggersIdleAssignee(t *testing.T) {
	agentID := seededReadyAgentID(t)
	squadID := dbfx.Squad(t, "Start trigger squad", agentID)
	for _, assigneeType := range []string{"agent", "squad"} {
		t.Run(assigneeType, func(t *testing.T) {
			assigneeID := agentID
			if assigneeType == "squad" {
				assigneeID = squadID
			}
			for _, state := range []string{"none", "queued", "dispatched", "running", "waiting_local_directory", "completed", "failed"} {
				t.Run(state, func(t *testing.T) {
					issueID := dbfx.Issue(t, "Start assigned work", testutil.Cols{
						"assignee_type": assigneeType, "assignee_id": assigneeID,
					})
					before := 0
					if state != "none" {
						dbfx.Task(t, agentID, testutil.Cols{
							"issue_id": issueID, "status": state, "runtime_id": testRuntimeID,
						})
						before = 1
					}
					wantNew := state == "none" || state == "completed" || state == "failed"
					pv := previewIssueTrigger(t, map[string]any{
						"issue_ids": []string{issueID}, "status": "in_progress",
					})
					if (pv.TotalCount == 1) != wantNew {
						t.Fatalf("preview total_count=%d, want new run=%v", pv.TotalCount, wantNew)
					}
					req := withURLParam(newRequest("PUT", "/api/issues/"+issueID, map[string]any{
						"status": "in_progress",
					}), "id", issueID)
					testutil.Call(t, testHandler.UpdateIssue, req).Want(http.StatusOK)
					wantCount := before
					if wantNew {
						wantCount++
					}
					if got := taskCountFor(t, issueID, agentID); got != wantCount {
						t.Fatalf("task count=%d, want %d", got, wantCount)
					}
				})
			}
		})
	}
}

func TestTodoToInProgressHonorsSuppressRun(t *testing.T) {
	agentID := seededReadyAgentID(t)
	issueID := dbfx.Issue(t, "Start suppressed", testutil.Cols{
		"assignee_type": "agent", "assignee_id": agentID,
	})
	req := withURLParam(newRequest("PUT", "/api/issues/"+issueID, map[string]any{
		"status": "in_progress", "suppress_run": true,
	}), "id", issueID)
	testutil.Call(t, testHandler.UpdateIssue, req).Want(http.StatusOK)
	if got := taskCountFor(t, issueID, agentID); got != 0 {
		t.Fatalf("suppressed start queued %d tasks", got)
	}
}

func TestTodoToInProgressBatchStartsSquad(t *testing.T) {
	agentID := seededReadyAgentID(t)
	squadID := dbfx.Squad(t, "Batch start squad", agentID)
	issueID := dbfx.Issue(t, "Batch start", testutil.Cols{
		"assignee_type": "squad", "assignee_id": squadID,
	})
	req := newRequest("POST", "/api/issues/batch-update", map[string]any{
		"issue_ids": []string{issueID},
		"updates":   map[string]any{"status": "in_progress"},
	})
	testutil.Call(t, testHandler.BatchUpdateIssues, req).Want(http.StatusOK)
	if got := taskCountFor(t, issueID, agentID); got != 1 {
		t.Fatalf("batch start queued %d tasks, want 1", got)
	}
}

func TestTodoToInProgressDoesNotBroadenOtherTransitions(t *testing.T) {
	agentID := seededReadyAgentID(t)
	for _, transition := range [][2]string{
		{"todo", "todo"}, {"todo", "in_review"}, {"todo", "blocked"},
		{"todo", "done"}, {"todo", "cancelled"}, {"in_review", "in_progress"},
	} {
		t.Run(transition[0]+"_"+transition[1], func(t *testing.T) {
			issueID := dbfx.Issue(t, "No implicit restart", testutil.Cols{
				"status": transition[0], "assignee_type": "agent", "assignee_id": agentID,
			})
			pv := previewIssueTrigger(t, map[string]any{
				"issue_ids": []string{issueID}, "status": transition[1],
			})
			if pv.TotalCount != 0 {
				t.Fatalf("unrelated transition previews %d runs", pv.TotalCount)
			}
			req := withURLParam(newRequest("PUT", "/api/issues/"+issueID, map[string]any{
				"status": transition[1],
			}), "id", issueID)
			testutil.Call(t, testHandler.UpdateIssue, req).Want(http.StatusOK)
			if got := taskCountFor(t, issueID, agentID); got != 0 {
				t.Fatalf("unrelated transition queued %d tasks", got)
			}
		})
	}
}
