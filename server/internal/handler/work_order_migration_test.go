package handler

import (
	"context"
	"os"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func TestWorkOrderGlobalProjectMigration(t *testing.T) {
	ctx := context.Background()
	tx, err := testPool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	schema := "work_order_migration_" + uuid.NewString()
	exec := func(sql string) {
		t.Helper()
		if _, err := tx.Exec(ctx, sql); err != nil {
			t.Fatal(err)
		}
	}
	exec("CREATE SCHEMA " + pgx.Identifier{schema}.Sanitize())
	exec("SET LOCAL search_path TO " + pgx.Identifier{schema}.Sanitize() + ", public")
	exec(`
CREATE TABLE project (
    id uuid PRIMARY KEY, title text NOT NULL, workspace_id uuid NOT NULL,
    product_id uuid, product_version_id uuid,
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE project_resource (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL,
    workspace_id uuid NOT NULL, resource_type text NOT NULL, resource_ref jsonb NOT NULL,
    UNIQUE (project_id, resource_type, resource_ref)
);
CREATE TABLE work_order (customer_project_id uuid);
CREATE TABLE work_order_workspace (execution_project_id uuid);
CREATE TABLE work_order_project_branch (
    workspace_id uuid NOT NULL, project_id uuid NOT NULL, version_id uuid NOT NULL,
    module_key text NOT NULL, resource_id uuid NOT NULL,
    PRIMARY KEY (workspace_id, project_id, version_id, module_key)
);
INSERT INTO project (id, title, workspace_id, product_id, product_version_id) VALUES
('00000000-0000-0000-0000-000000000001', 'Configured customer', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001'),
('00000000-0000-0000-0000-000000000002', 'Referenced customer', '10000000-0000-0000-0000-000000000001', NULL, NULL),
('00000000-0000-0000-0000-000000000003', 'Execution only', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001'),
('00000000-0000-0000-0000-000000000004', 'Ordinary project', '10000000-0000-0000-0000-000000000001', NULL, NULL);
INSERT INTO work_order VALUES ('00000000-0000-0000-0000-000000000002');
INSERT INTO work_order_workspace VALUES ('00000000-0000-0000-0000-000000000003');
INSERT INTO project_resource (id, project_id, workspace_id, resource_type, resource_ref) VALUES
('40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'github_repo', '{"url":"https://git.example.test/main.git","ref":"customer/v1"}');
INSERT INTO work_order_project_branch VALUES
('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'main', '40000000-0000-0000-0000-000000000001');
`)
	up, err := os.ReadFile("../../migrations/626_global_customer_projects.up.sql")
	if err != nil {
		t.Fatal(err)
	}
	down, err := os.ReadFile("../../migrations/626_global_customer_projects.down.sql")
	if err != nil {
		t.Fatal(err)
	}
	exec(string(up))
	var count int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM customer_project`).Scan(&count); err != nil || count != 2 {
		t.Fatalf("expected only configured/referenced customer projects: count=%d err=%v", count, err)
	}
	var repo, ref, project string
	if err := tx.QueryRow(ctx, `SELECT project_id::text, repo_url, ref FROM work_order_project_branch`).Scan(&project, &repo, &ref); err != nil ||
		project != "00000000-0000-0000-0000-000000000001" || repo != "https://git.example.test/main.git" || ref != "customer/v1" {
		t.Fatalf("migration lost branch identity or Git ref: %s %s %s %v", project, repo, ref, err)
	}
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM project`).Scan(&count); err != nil || count != 4 {
		t.Fatalf("migration modified operational projects: count=%d err=%v", count, err)
	}
	exec(`UPDATE work_order_project_branch SET ref='customer/v2'`)
	exec(string(down))
	if err := tx.QueryRow(ctx, `SELECT r.resource_ref->>'ref' FROM work_order_project_branch b
		JOIN project_resource r ON r.id=b.resource_id AND r.workspace_id=b.workspace_id`).Scan(&ref); err != nil || ref != "customer/v2" {
		t.Fatalf("rollback did not preserve the updated branch: ref=%s err=%v", ref, err)
	}
	exec(string(up))
	exec(`INSERT INTO customer_project (name) VALUES ('Global only')`)
	exec("SAVEPOINT rollback_guard")
	if _, err := tx.Exec(ctx, string(down)); err == nil || !strings.Contains(err.Error(), "export and map") {
		t.Fatalf("rollback should refuse unmapped global projects: %v", err)
	}
	exec("ROLLBACK TO SAVEPOINT rollback_guard")
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM customer_project`).Scan(&count); err != nil || count != 3 {
		t.Fatalf("refused rollback changed customer projects: count=%d err=%v", count, err)
	}
}
