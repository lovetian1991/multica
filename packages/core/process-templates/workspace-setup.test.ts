// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import type { AgentRuntime, IssueWorkflow, IssueWorkflowStepInput, ProcessTemplate, Project, Squad, VCSConnection, MemberWithUser } from "../types";
import { initializeWorkspace, setupBaseUrl, WorkspaceSetupStepError } from "./workspace-setup";

vi.mock("../api", () => ({
  api: {
    listWorkspaceProcessTemplates: vi.fn(),
    listRuntimes: vi.fn(),
    listVCSConnections: vi.fn(),
    getDeliveryDefaults: vi.fn(),
    getSystemSettings: vi.fn(),
    updateSystemSettings: vi.fn(),
    connectVCS: vi.fn(),
    saveDeliveryDefaults: vi.fn(),
    applyWorkspaceProcessTemplate: vi.fn(),
    listProjects: vi.fn(), listMembers: vi.fn(), listSquads: vi.fn(),
    listIssueWorkflows: vi.fn(), listIssueStatuses: vi.fn(), createIssueWorkflow: vi.fn(), updateIssueWorkflow: vi.fn(),
    dryRunProjectWorkflow: vi.fn(), setProjectWorkflow: vi.fn(), createProject: vi.fn(),
  },
}));

const template: ProcessTemplate = {
  id: "dev", slug: "dev", name: "Development", description: "",
  created_at: "", updated_at: "", can_upgrade: false,
  latest_version: { id: "v1", version: 1, checksum: "", file_name: "", file_size: 0, created_at: "" },
};
const defaults = {
  enabled: false,
  rules: { autoDiscover: false, pipelineSource: "push", deploymentJob: "deploy",
    urlPrefix: "DEPLOY=", timeoutMinutes: 60, allowedHosts: ["old.test"] },
};
const input = {
  templateIds: ["dev"],
  gitlab: { instanceUrl: "http://gitlab.test/", accessToken: "git-secret", urlPrefix: "DEPLOY=" },
  kb: { environmentUrl: "https://kb.test", integrationKey: "kb-secret" },
};
const connection = { provider: "gitlab", instance_url: "http://gitlab.test" } as VCSConnection;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.listWorkspaceProcessTemplates).mockResolvedValue({ templates: [template], total: 1 });
  vi.mocked(api.listRuntimes).mockResolvedValue([{ status: "online" } as AgentRuntime]);
  vi.mocked(api.listVCSConnections).mockResolvedValue({ connections: [], available: true, configured: true, can_manage: true });
  vi.mocked(api.getDeliveryDefaults).mockResolvedValue(defaults);
  vi.mocked(api.getSystemSettings).mockResolvedValue({ kb_environment_url: "", kb_integration_key_configured: false, oc_integration_key_configured: false });
});

describe("workspace initialization", () => {
  it("applies selected settings through existing APIs and preserves advanced CI rules", async () => {
    const onStep = vi.fn();
    await initializeWorkspace("ws", input, onStep);
    expect(api.updateSystemSettings).toHaveBeenCalledWith({
      kb_environment_url: "https://kb.test", kb_integration_key: "kb-secret",
    });
    expect(api.connectVCS).toHaveBeenCalledWith("ws", {
      provider: "gitlab", instance_url: "http://gitlab.test", access_token: "git-secret",
    });
    expect(api.saveDeliveryDefaults).toHaveBeenCalledWith("ws", {
      ...defaults, enabled: true, rules: { ...defaults.rules, autoDiscover: true, allowedHosts: [] },
    });
    expect(api.applyWorkspaceProcessTemplate).toHaveBeenCalledExactlyOnceWith("dev");
    expect(onStep.mock.calls.at(-1)).toEqual(["template:dev", "saved"]);
  });

  it("keeps installed templates and existing connections, including their webhook secrets", async () => {
    vi.mocked(api.listWorkspaceProcessTemplates).mockResolvedValue({ templates: [{ ...template, installed: true }], total: 1 });
    vi.mocked(api.listRuntimes).mockResolvedValue([]);
    vi.mocked(api.listVCSConnections).mockResolvedValue({ connections: [connection], configured: true, can_manage: true });
    vi.mocked(api.getSystemSettings).mockResolvedValue({ kb_environment_url: "https://kb.test", kb_integration_key_configured: true, oc_integration_key_configured: false });
    await initializeWorkspace("ws", {
      ...input, gitlab: { ...input.gitlab, accessToken: "" }, kb: { ...input.kb, integrationKey: "" },
    }, vi.fn());
    expect(api.applyWorkspaceProcessTemplate).not.toHaveBeenCalled();
    expect(api.connectVCS).not.toHaveBeenCalled();
    expect(api.updateSystemSettings).not.toHaveBeenCalled();
  });

  it("validates all required settings before writing anything", async () => {
    vi.mocked(api.listRuntimes).mockResolvedValue([]);
    await expect(initializeWorkspace("ws", input, vi.fn())).rejects.toMatchObject({ code: "runtime_required" });
    expect(api.updateSystemSettings).not.toHaveBeenCalled();
    expect(api.connectVCS).not.toHaveBeenCalled();
    expect(api.applyWorkspaceProcessTemplate).not.toHaveBeenCalled();
  });

  it("retries partial setup without reconnecting GitLab or reinstalling successful templates", async () => {
    vi.mocked(api.listWorkspaceProcessTemplates).mockResolvedValue({ templates: [template, { ...template, id: "bug" }], total: 2 });
    vi.mocked(api.applyWorkspaceProcessTemplate).mockResolvedValueOnce(template).mockRejectedValueOnce(new Error("secret"));
    const selected = { ...input, templateIds: ["dev", "bug"] };
    await expect(initializeWorkspace("ws", selected, vi.fn())).rejects.toMatchObject({ step: "template:bug" });
    vi.mocked(api.listWorkspaceProcessTemplates).mockResolvedValue({ templates: [{ ...template, installed: true }, { ...template, id: "bug" }], total: 2 });
    vi.mocked(api.listVCSConnections).mockResolvedValue({ connections: [connection], configured: true, can_manage: true });
    vi.mocked(api.applyWorkspaceProcessTemplate).mockClear().mockResolvedValue(template);
    await initializeWorkspace("ws", selected, vi.fn());
    expect(api.connectVCS).toHaveBeenCalledTimes(1);
    expect(api.applyWorkspaceProcessTemplate).toHaveBeenCalledExactlyOnceWith("bug");
  });

  it("does not expose upstream errors containing submitted secrets", async () => {
    vi.mocked(api.connectVCS).mockRejectedValue(new Error("git-secret"));
    const onStep = vi.fn();
    try {
      await initializeWorkspace("ws", input, onStep);
      expect.fail("expected a step failure");
    } catch (error) {
      expect(error).toBeInstanceOf(WorkspaceSetupStepError);
      expect(String(error)).not.toContain("git-secret");
    }
    expect(onStep).toHaveBeenCalledWith("gitlab", "failed");
    expect(api.applyWorkspaceProcessTemplate).not.toHaveBeenCalled();
  });

  it("only requests selected sections", async () => {
    await initializeWorkspace("ws", { templateIds: ["dev"] }, vi.fn());
    expect(api.listVCSConnections).not.toHaveBeenCalled();
    expect(api.getSystemSettings).not.toHaveBeenCalled();
    expect(api.getDeliveryDefaults).not.toHaveBeenCalled();
  });

  it("does not write without permission to configure GitLab", async () => {
    vi.mocked(api.listVCSConnections).mockResolvedValue({ connections: [], configured: true, can_manage: false });
    await expect(initializeWorkspace("ws", input, vi.fn())).rejects.toMatchObject({ code: "gitlab_unavailable" });
    expect(api.updateSystemSettings).not.toHaveBeenCalled();
  });

  it("requires a new KB secret when changing the server URL", async () => {
    vi.mocked(api.getSystemSettings).mockResolvedValue({ kb_environment_url: "https://old.test", kb_integration_key_configured: true, oc_integration_key_configured: false });
    await expect(initializeWorkspace("ws", { ...input, kb: { ...input.kb, integrationKey: "" } }, vi.fn()))
      .rejects.toMatchObject({ code: "kb_key_required" });
    expect(api.connectVCS).not.toHaveBeenCalled();
  });
});

describe("design, human approval and development setup", () => {
  const workflow = {
    scope: "project" as const,
    projectId: "project", reviewerId: "member",
    design: { squadId: "design" }, development: { squadId: "implementation" },
    labels: { name: "Design to development", approval: "Design approval",
      designInstructions: "Design and wait for approval.", developmentInstructions: "Implement approved design." },
  };
  const squads = [{ id: "design" }, { id: "implementation" }] as Squad[];
  const project = { id: "project", title: "Customer project", workflow_id: null } as Project;
  const approval = { key: "design_approval", name: "Design approval", is_system: false, archived_at: null };
  let saved: IssueWorkflow | undefined;
  beforeEach(() => {
    saved = undefined;
    vi.mocked(api.listProjects).mockResolvedValue({ projects: [project], total: 1 });
    vi.mocked(api.listMembers).mockResolvedValue([{ user_id: "member" }] as MemberWithUser[]);
    vi.mocked(api.listSquads).mockResolvedValue(squads);
    vi.mocked(api.listIssueWorkflows).mockImplementation(async () => ({ workflows: saved ? [saved] : [], total: saved ? 1 : 0 }));
    vi.mocked(api.listIssueStatuses).mockImplementation(async () => ({
      statuses: saved ? [{ ...approval, id: "status", workspace_id: "ws", description: "", category: "started",
        color: "#999999", position: 0, created_at: "", updated_at: "" }] : [],
      categories: [], total: saved ? 1 : 0,
    }));
    vi.mocked(api.createIssueWorkflow).mockImplementation(async (request) => {
      saved = {
        id: "flow", workspace_id: "ws", name: request.name ?? "", description: "", owner_id: "member",
        created_at: "", updated_at: "", is_default: false, project_ids: [],
        steps: (request.steps ?? []).map((step: IssueWorkflowStepInput) => ({
          status_key: "status_key" in step ? step.status_key : approval.key,
          handler: step.handler ?? { type: "none" }, instructions: step.instructions ?? "",
          next_status_key: step.next_status_key, back_status_key: step.back_status_key,
        })),
      };
      return saved;
    });
    vi.mocked(api.dryRunProjectWorkflow).mockResolvedValue({
      dry_run: true, plan: { required: [], unchanged: [], total_issues: 0, affected_issues: 0 },
    });
  });

  it("creates ordered stages with a member-only approval and binds only the selected project", async () => {
    await initializeWorkspace("ws", { templateIds: [], workflow }, vi.fn());
    expect(saved?.steps.map((step) => [step.status_key, step.handler])).toEqual([
      ["backlog", { type: "none" }], ["todo", { type: "squad", id: "design" }],
      ["design_approval", { type: "member", id: "member" }],
      ["in_progress", { type: "squad", id: "implementation" }],
      ["in_review", { type: "member", id: "member" }],
      ["blocked", { type: "none" }], ["done", { type: "none" }], ["cancelled", { type: "none" }],
    ]);
    expect(saved?.steps[1]?.next_status_key).toBeUndefined();
    expect(api.dryRunProjectWorkflow).toHaveBeenCalledWith("project", "flow");
    expect(api.setProjectWorkflow).toHaveBeenCalledExactlyOnceWith("project", { workflow_id: "flow" });
    expect(api.listRuntimes).not.toHaveBeenCalled();
  });

  it("configures the workspace default without requiring or binding any project and skips identical retries", async () => {
    const defaultWorkflow = {
      id: "default", is_default: true, name: "Default", steps: [], project_ids: ["inheriting"],
    } as unknown as IssueWorkflow;
    const custom = { id: "custom", name: "Custom", steps: [], project_ids: ["override"] } as unknown as IssueWorkflow;
    vi.mocked(api.listProjects).mockRejectedValue(new Error("projects must not be requested"));
    vi.mocked(api.listIssueWorkflows).mockImplementation(async () => ({
      workflows: [defaultWorkflow, custom], total: 2,
    }));
    vi.mocked(api.updateIssueWorkflow).mockImplementation(async (id, request) => {
      expect(id).toBe("default");
      defaultWorkflow.steps = (request.steps ?? []).map((step) => ({
        status_key: "status_key" in step ? step.status_key : approval.key,
        handler: step.handler ?? { type: "none" }, instructions: step.instructions ?? "",
        next_status_key: step.next_status_key, back_status_key: step.back_status_key,
      }));
      return defaultWorkflow;
    });
    const selected = { templateIds: [], workflow: { ...workflow, scope: "workspace" as const, projectId: undefined } };
    const onStep = vi.fn();
    expect(await initializeWorkspace("ws", selected, onStep)).toEqual({ projectId: undefined });
    vi.mocked(api.listIssueStatuses).mockResolvedValue({
      statuses: [{ ...approval, id: "status", workspace_id: "ws", description: "", category: "started",
        color: "#999999", position: 0, created_at: "", updated_at: "" }], categories: [], total: 1,
    });
    await initializeWorkspace("ws", selected, onStep);
    expect(api.updateIssueWorkflow).toHaveBeenCalledTimes(1);
    expect(defaultWorkflow.steps[2]?.handler).toEqual({ type: "member", id: "member" });
    expect(defaultWorkflow.steps[3]?.handler).toEqual({ type: "squad", id: "implementation" });
    expect(custom.steps).toEqual([]);
    expect(api.listProjects).not.toHaveBeenCalled();
    expect(api.createIssueWorkflow).not.toHaveBeenCalled();
    expect(api.createProject).not.toHaveBeenCalled();
    expect(api.setProjectWorkflow).not.toHaveBeenCalled();
    expect(onStep).not.toHaveBeenCalledWith("project", expect.anything());
  });

  it("reports a missing default without creating a project-scoped replacement", async () => {
    await expect(initializeWorkspace("ws", {
      templateIds: [], workflow: { ...workflow, scope: "workspace", projectId: undefined },
    }, vi.fn())).rejects.toMatchObject({ code: "workflow_conflict" });
    expect(api.createIssueWorkflow).not.toHaveBeenCalled();
    expect(api.createProject).not.toHaveBeenCalled();
  });

  it("creates a new project already bound to the workflow, then reuses both on retry", async () => {
    vi.mocked(api.listProjects).mockResolvedValue({ projects: [], total: 0 });
    vi.mocked(api.createProject).mockImplementation(async (request) => {
      const created = { ...project, title: request.title, workflow_id: request.workflow_id } as Project;
      saved!.project_ids = [created.id];
      vi.mocked(api.listProjects).mockResolvedValue({ projects: [created], total: 1 });
      return created;
    });
    const selected = { templateIds: [], workflow: { ...workflow, projectId: undefined, projectTitle: "New project" } };
    expect(await initializeWorkspace("ws", selected, vi.fn())).toEqual({ projectId: "project" });
    await initializeWorkspace("ws", selected, vi.fn());
    expect(api.createProject).toHaveBeenCalledExactlyOnceWith({ title: "New project", workflow_id: "flow" });
    expect(api.createIssueWorkflow).toHaveBeenCalledTimes(1);
    expect(api.setProjectWorkflow).not.toHaveBeenCalled();
  });

  it("does not adopt an unrelated existing project with the requested new name", async () => {
    await expect(initializeWorkspace("ws", {
      ...input, workflow: { ...workflow, projectId: undefined, projectTitle: project.title },
    }, vi.fn())).rejects.toMatchObject({ code: "project_conflict" });
    expect(api.updateSystemSettings).not.toHaveBeenCalled();
    expect(api.createIssueWorkflow).not.toHaveBeenCalled();
  });

  it("reuses the unbound workflow when creating the project fails and is retried", async () => {
    vi.mocked(api.listProjects).mockResolvedValue({ projects: [], total: 0 });
    vi.mocked(api.createProject).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(project);
    const selected = { templateIds: [], workflow: { ...workflow, projectId: undefined, projectTitle: "New project" } };
    await expect(initializeWorkspace("ws", selected, vi.fn())).rejects.toMatchObject({ step: "project" });
    await initializeWorkspace("ws", selected, vi.fn());
    expect(api.createIssueWorkflow).toHaveBeenCalledTimes(1);
    expect(api.createProject).toHaveBeenCalledTimes(2);
  });

  it("includes role-selected templates and resolves their installed squad IDs without fuzzy names", async () => {
    const source = { ...template, squads: [{ key: "designer", name: "Arbitrary name" }] };
    vi.mocked(api.listWorkspaceProcessTemplates).mockResolvedValue({ templates: [source], total: 1 });
    vi.mocked(api.applyWorkspaceProcessTemplate).mockImplementation(async () => {
      vi.mocked(api.listWorkspaceProcessTemplates).mockResolvedValue({
        templates: [{ ...source, installed: true, squads: [{ ...source.squads[0]!, id: "design" }] }], total: 1,
      });
      return source;
    });
    await initializeWorkspace("ws", {
      templateIds: [], workflow: { ...workflow, design: { templateId: "dev", squadKey: "designer" } },
    }, vi.fn());
    expect(api.applyWorkspaceProcessTemplate).toHaveBeenCalledExactlyOnceWith("dev");
    expect(saved?.steps[1]?.handler).toEqual({ type: "squad", id: "design" });
    expect(api.listWorkspaceProcessTemplates).toHaveBeenCalledWith(true);
  });

  it("reapplies an installed template with missing squads, then skips it on retry", async () => {
    const source = { ...template, installed: true, squads: [{ key: "designer", name: "Design" }] };
    vi.mocked(api.listWorkspaceProcessTemplates).mockResolvedValue({ templates: [source], total: 1 });
    vi.mocked(api.applyWorkspaceProcessTemplate).mockImplementation(async () => {
      vi.mocked(api.listWorkspaceProcessTemplates).mockResolvedValue({
        templates: [{ ...source, squads: [{ ...source.squads[0]!, id: "design" }] }], total: 1,
      });
      return source;
    });
    const selected = {
      templateIds: [], workflow: { ...workflow, design: { templateId: "dev", squadKey: "designer" } },
    };
    await initializeWorkspace("ws", selected, vi.fn());
    await initializeWorkspace("ws", selected, vi.fn());
    expect(api.applyWorkspaceProcessTemplate).toHaveBeenCalledExactlyOnceWith("dev");
    expect(api.createIssueWorkflow).toHaveBeenCalledTimes(1);
  });

  it("requires an online runtime before repairing an installed template", async () => {
    vi.mocked(api.listWorkspaceProcessTemplates).mockResolvedValue({
      templates: [{ ...template, installed: true, squads: [{ key: "designer", name: "Design" }] }], total: 1,
    });
    vi.mocked(api.listRuntimes).mockResolvedValue([]);
    await expect(initializeWorkspace("ws", {
      templateIds: [], workflow: { ...workflow, design: { templateId: "dev", squadKey: "designer" } },
    }, vi.fn())).rejects.toMatchObject({ code: "runtime_required" });
    expect(api.applyWorkspaceProcessTemplate).not.toHaveBeenCalled();
    expect(api.createIssueWorkflow).not.toHaveBeenCalled();
  });

  it.each([
    [{ projectId: "missing" }, "project_required"],
    [{ reviewerId: "missing" }, "reviewer_required"],
    [{ design: { squadId: "missing" } }, "squad_required"],
    [{ design: { templateId: "dev", squadKey: "missing" } }, "squad_required"],
  ])("rejects invalid workflow configuration before integration or template writes: %s", async (patch, code) => {
    await expect(initializeWorkspace("ws", { ...input, workflow: { ...workflow, ...patch } }, vi.fn()))
      .rejects.toMatchObject({ code });
    expect(api.updateSystemSettings).not.toHaveBeenCalled();
    expect(api.applyWorkspaceProcessTemplate).not.toHaveBeenCalled();
    expect(api.createIssueWorkflow).not.toHaveBeenCalled();
  });

  it("reuses the workflow after a failed project binding", async () => {
    vi.mocked(api.setProjectWorkflow).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce();
    const selection = { templateIds: [], workflow };
    await expect(initializeWorkspace("ws", selection, vi.fn())).rejects.toMatchObject({ step: "project" });
    await initializeWorkspace("ws", selection, vi.fn());
    expect(api.createIssueWorkflow).toHaveBeenCalledTimes(1);
    expect(api.setProjectWorkflow).toHaveBeenCalledTimes(2);
  });

  it("never overwrites a manually customized workflow", async () => {
    await initializeWorkspace("ws", { templateIds: [], workflow }, vi.fn());
    saved!.steps[1]!.instructions = "Custom instructions";
    vi.mocked(api.setProjectWorkflow).mockClear();
    await expect(initializeWorkspace("ws", { templateIds: [], workflow }, vi.fn()))
      .rejects.toMatchObject({ code: "workflow_conflict" });
    expect(api.createIssueWorkflow).toHaveBeenCalledTimes(1);
    expect(api.setProjectWorkflow).not.toHaveBeenCalled();
  });

  it("refuses silent status migration and keeps the workflow for retry", async () => {
    vi.mocked(api.dryRunProjectWorkflow).mockResolvedValue({
      dry_run: true, plan: { required: [{ status_key: "custom", issue_count: 1, suggested_status_key: "todo" }],
        unchanged: [], total_issues: 1, affected_issues: 1 },
    });
    await expect(initializeWorkspace("ws", { templateIds: [], workflow }, vi.fn()))
      .rejects.toMatchObject({ code: "status_mapping_required" });
    expect(api.setProjectWorkflow).not.toHaveBeenCalled();
    expect(api.createIssueWorkflow).toHaveBeenCalledTimes(1);
  });
});

it.each(["file:///etc/passwd", "https://user:secret@host.test", "https://host.test?token=secret", "https://host.test/#token"])("rejects unsafe base URLs: %s", (url) => {
  expect(() => setupBaseUrl(url)).toThrow("invalid_url");
});
