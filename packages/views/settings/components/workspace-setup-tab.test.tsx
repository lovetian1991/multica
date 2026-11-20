import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api, ApiError } from "@multica/core/api";
import type { AgentRuntime, IssueWorkflow, MemberWithUser, ProcessTemplate, Project, Squad } from "@multica/core/types";
import { renderWithI18n } from "../../test/i18n";
import { WorkspaceSetupTab } from "./workspace-setup-tab";

const permissions = vi.hoisted(() => ({ role: "owner" }));
vi.mock("@multica/core/paths", () => ({ useCurrentWorkspace: () => ({ id: "ws", name: "Team" }) }));
vi.mock("@multica/core/permissions", () => ({ useCurrentMember: () => ({ role: permissions.role, userId: "member" }) }));
vi.mock("@multica/core/api", async (original) => ({
  ...await original<typeof import("@multica/core/api")>(),
  api: {
    listWorkspaceProcessTemplates: vi.fn(), listRuntimes: vi.fn(),
    listVCSConnections: vi.fn(), getDeliveryDefaults: vi.fn(),
    getSystemSettings: vi.fn(), updateSystemSettings: vi.fn(),
    connectVCS: vi.fn(), saveDeliveryDefaults: vi.fn(), applyWorkspaceProcessTemplate: vi.fn(),
    listProjects: vi.fn(), listMembers: vi.fn(), listSquads: vi.fn(), listIssueWorkflows: vi.fn(),
    listIssueStatuses: vi.fn(), createIssueWorkflow: vi.fn(), updateIssueWorkflow: vi.fn(), dryRunProjectWorkflow: vi.fn(), setProjectWorkflow: vi.fn(), createProject: vi.fn(),
  },
}));
const template: ProcessTemplate = {
  id: "dev", slug: "dev", name: "Development squad", description: "",
  created_at: "", updated_at: "", can_upgrade: false,
  latest_version: { id: "v1", version: 1, checksum: "", file_name: "", file_size: 0, created_at: "" },
};
const defaults = { enabled: false, rules: { autoDiscover: false, deploymentJob: "", pipelineSource: "push",
  urlPrefix: "DEPLOY=", allowedHosts: [], timeoutMinutes: 120 } };
function renderSetup(locale: "en" | "zh-Hans" = "en") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  return renderWithI18n(<QueryClientProvider client={client}><WorkspaceSetupTab /></QueryClientProvider>, { locale });
}
async function disableWorkflow() {
  const toggle = screen.getByRole("switch", { name: "Configure design to development" });
  await waitFor(() => expect(toggle).not.toHaveAttribute("aria-disabled", "true"));
  fireEvent.click(toggle);
}
beforeEach(() => {
  vi.resetAllMocks();
  permissions.role = "owner";
  vi.mocked(api.listWorkspaceProcessTemplates).mockResolvedValue({ templates: [template], total: 1 });
  vi.mocked(api.listRuntimes).mockResolvedValue([{ status: "online" } as AgentRuntime]);
  vi.mocked(api.listVCSConnections).mockResolvedValue({ connections: [], configured: true, can_manage: true });
  vi.mocked(api.getDeliveryDefaults).mockResolvedValue(defaults);
  vi.mocked(api.getSystemSettings).mockResolvedValue({ kb_environment_url: "", kb_integration_key_configured: false, oc_integration_key_configured: false });
  vi.mocked(api.applyWorkspaceProcessTemplate).mockResolvedValue(template);
  vi.mocked(api.listProjects).mockResolvedValue({ projects: [{ id: "project", title: "Customer project" }] as Project[], total: 1 });
  vi.mocked(api.listMembers).mockResolvedValue([{ user_id: "member", name: "Owner" }] as MemberWithUser[]);
  vi.mocked(api.listSquads).mockResolvedValue([]);
  vi.mocked(api.listIssueWorkflows).mockResolvedValue({
    workflows: [{ id: "default", name: "Default", is_default: true, steps: [], project_ids: [] } as unknown as IssueWorkflow], total: 1,
  });
  vi.mocked(api.listIssueStatuses).mockResolvedValue({ statuses: [], categories: [], total: 0 });
  vi.mocked(api.createIssueWorkflow).mockResolvedValue({ id: "flow" } as IssueWorkflow);
  vi.mocked(api.dryRunProjectWorkflow).mockResolvedValue({
    dry_run: true, plan: { required: [], unchanged: [], total_issues: 0, affected_issues: 0 },
  });
});
it("submits one form, applies all selected configuration and clears tokens", async () => {
  renderSetup();
  await disableWorkflow();
  await waitFor(() => expect(screen.getByLabelText("GitLab URL")).toBeEnabled());
  fireEvent.change(screen.getByLabelText("GitLab URL"), { target: { value: "https://gitlab.test" } });
  fireEvent.change(screen.getByLabelText("Access token (api scope)"), { target: { value: "git-secret" } });
  fireEvent.change(screen.getByLabelText("Environment address"), { target: { value: "https://kb.test" } });
  fireEvent.change(screen.getByLabelText("Integration key"), { target: { value: "kb-secret" } });
  fireEvent.click(screen.getByRole("button", { name: "Initialize" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Selected configuration applied.");
  expect(api.connectVCS).toHaveBeenCalledWith("ws", expect.objectContaining({ access_token: "git-secret" }));
  expect(api.updateSystemSettings).toHaveBeenCalledWith(expect.objectContaining({ kb_integration_key: "kb-secret" }));
  expect(api.applyWorkspaceProcessTemplate).toHaveBeenCalledExactlyOnceWith("dev");
  expect(screen.getByLabelText("Access token (api scope)")).toHaveValue("");
  expect(screen.getByLabelText("Integration key")).toHaveValue("");
});
it("can initialize squads without optional integrations", async () => {
  renderSetup();
  await disableWorkflow();
  await waitFor(() => expect(screen.getByRole("switch", { name: "Configure GitLab and CI" })).not.toHaveAttribute("aria-disabled", "true"));
  fireEvent.click(screen.getByRole("switch", { name: "Configure GitLab and CI" }));
  fireEvent.click(screen.getByRole("switch", { name: "Configure knowledge base" }));
  fireEvent.click(screen.getByRole("button", { name: "Initialize" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Selected configuration applied.");
  expect(api.connectVCS).not.toHaveBeenCalled();
  expect(api.updateSystemSettings).not.toHaveBeenCalled();
});
it("does not automatically select another template after initialization refreshes the catalog", async () => {
  const bugTemplate = { ...template, id: "bug", name: "Bug squad" };
  vi.mocked(api.listWorkspaceProcessTemplates).mockResolvedValue({
    templates: [template, bugTemplate], total: 2,
  });
  vi.mocked(api.applyWorkspaceProcessTemplate).mockImplementation(async () => {
    vi.mocked(api.listWorkspaceProcessTemplates).mockResolvedValue({
      templates: [{ ...template, installed: true }, bugTemplate], total: 2,
    });
    return template;
  });
  renderSetup();
  await disableWorkflow();
  await waitFor(() => expect(screen.getByRole("switch", { name: "Configure GitLab and CI" })).not.toHaveAttribute("aria-disabled", "true"));
  fireEvent.click(screen.getByRole("switch", { name: "Configure GitLab and CI" }));
  fireEvent.click(screen.getByRole("switch", { name: "Configure knowledge base" }));
  fireEvent.click(screen.getByRole("button", { name: "Initialize" }));
  await screen.findByRole("status");
  expect(screen.getByRole("checkbox", { name: "Bug squad" })).not.toBeChecked();
  expect(screen.getByRole("checkbox", { name: /Development squad/ })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Initialize" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Initialize" })).toBeEnabled());
  expect(api.applyWorkspaceProcessTemplate).toHaveBeenCalledExactlyOnceWith("dev");
});
it("retains system-admin restrictions without blocking workspace setup", async () => {
  vi.mocked(api.getSystemSettings).mockRejectedValue(new ApiError("forbidden", 403, "Forbidden"));
  renderSetup();
  expect(await screen.findByText(/system administrator/i)).toBeVisible();
  expect(screen.queryByLabelText("Integration key")).not.toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole("button", { name: "Initialize" })).toBeEnabled());
});
it("does not expose mutations to workspace members", () => {
  permissions.role = "member";
  renderSetup();
  expect(screen.queryByRole("button", { name: "Initialize" })).not.toBeInTheDocument();
  expect(api.getSystemSettings).not.toHaveBeenCalled();
});
it("renders the Chinese settings entry", async () => {
  renderSetup("zh-Hans");
  expect(screen.getByRole("heading", { name: "一键初始化" })).toBeVisible();
  expect(await screen.findByText("小队模板")).toBeVisible();
  expect(screen.getByRole("switch", { name: "配置设计到开发流程" })).toBeChecked();
});

it("initializes design, approval and development together using the default squad choices and current member", async () => {
  vi.mocked(api.listWorkspaceProcessTemplates).mockResolvedValue({ templates: [], total: 0 });
  vi.mocked(api.listSquads).mockResolvedValue([
    { id: "design", name: "Product design squad" }, { id: "dev", name: "Development squad" },
  ] as Squad[]);
  renderSetup();
  const toggle = screen.getByRole("switch", { name: "Configure design to development" });
  await waitFor(() => expect(toggle).not.toHaveAttribute("aria-disabled", "true"));
  expect(toggle).toBeChecked();
  expect(screen.getByRole("combobox", { name: "Product design squad" })).toHaveTextContent("Product design squad");
  expect(screen.getByRole("combobox", { name: "Development squad" })).toHaveTextContent("Development squad");
  expect(screen.getByRole("combobox", { name: "Approver and reviewer" })).toHaveTextContent("Owner");
  expect(screen.getByRole("combobox", { name: "Workflow scope" })).toHaveTextContent("Workspace default");
  expect(screen.queryByRole("combobox", { name: "Apply to project" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("switch", { name: "Configure GitLab and CI" }));
  fireEvent.click(screen.getByRole("switch", { name: "Configure knowledge base" }));
  fireEvent.click(screen.getByRole("button", { name: "Initialize" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Selected configuration applied.");
  expect(api.updateIssueWorkflow).toHaveBeenCalledWith("default", expect.objectContaining({
    steps: expect.arrayContaining([
      expect.objectContaining({ status_key: "todo", handler: { type: "squad", id: "design" } }),
      expect.objectContaining({ new_status: { name: "Design approval", category: "started" }, handler: { type: "member", id: "member" } }),
      expect.objectContaining({ status_key: "in_progress", handler: { type: "squad", id: "dev" } }),
    ]),
  }));
  expect(api.listProjects).not.toHaveBeenCalled();
  expect(api.createIssueWorkflow).not.toHaveBeenCalled();
  expect(api.createProject).not.toHaveBeenCalled();
  expect(api.setProjectWorkflow).not.toHaveBeenCalled();
});

it("keeps template squad choices visible after installation refreshes the catalog", async () => {
  const squads = [
    { key: "designer", name: "Product design squad" }, { key: "developer", name: "Development squad" },
  ];
  vi.mocked(api.listWorkspaceProcessTemplates).mockResolvedValue({ templates: [{ ...template, squads }], total: 1 });
  vi.mocked(api.applyWorkspaceProcessTemplate).mockImplementation(async () => {
    vi.mocked(api.listSquads).mockResolvedValue(squads.map((item) => ({ id: item.key, name: item.name })) as Squad[]);
    vi.mocked(api.listWorkspaceProcessTemplates).mockResolvedValue({
      templates: [{ ...template, installed: true, squads: squads.map((item) => ({ ...item, id: item.key })) }], total: 1,
    });
    return template;
  });
  renderSetup();
  await waitFor(() => expect(screen.getByRole("switch", { name: "Configure GitLab and CI" })).not.toHaveAttribute("aria-disabled", "true"));
  expect(screen.getByRole("checkbox", { name: "Development squad" })).toBeChecked();
  fireEvent.click(screen.getByRole("switch", { name: "Configure GitLab and CI" }));
  fireEvent.click(screen.getByRole("switch", { name: "Configure knowledge base" }));
  fireEvent.click(screen.getByRole("button", { name: "Initialize" }));
  await screen.findByRole("status");
  await waitFor(() => expect(screen.getByRole("combobox", { name: "Product design squad" })).toHaveTextContent("Development squad / Product design squad"));
  expect(api.applyWorkspaceProcessTemplate).toHaveBeenCalledExactlyOnceWith("dev");
});

it("reinitializes deleted squads from an installed template without losing default choices", async () => {
  const squads = [
    { key: "designer", name: "Product design squad" }, { key: "developer", name: "Development squad" },
  ];
  vi.mocked(api.listWorkspaceProcessTemplates).mockResolvedValue({
    templates: [{ ...template, installed: true, squads }], total: 1,
  });
  vi.mocked(api.applyWorkspaceProcessTemplate).mockImplementation(async () => {
    vi.mocked(api.listSquads).mockResolvedValue(squads.map((item) => ({ id: item.key, name: item.name })) as Squad[]);
    vi.mocked(api.listWorkspaceProcessTemplates).mockResolvedValue({
      templates: [{ ...template, installed: true, squads: squads.map((item) => ({ ...item, id: item.key })) }], total: 1,
    });
    return template;
  });
  renderSetup();
  await waitFor(() => expect(screen.getByRole("switch", { name: "Configure GitLab and CI" })).not.toHaveAttribute("aria-disabled", "true"));
  expect(screen.getByRole("combobox", { name: "Product design squad" })).toHaveTextContent("Development squad / Product design squad");
  expect(screen.getByRole("combobox", { name: "Development squad" })).toHaveTextContent("Development squad / Development squad");
  fireEvent.click(screen.getByRole("switch", { name: "Configure GitLab and CI" }));
  fireEvent.click(screen.getByRole("switch", { name: "Configure knowledge base" }));
  fireEvent.click(screen.getByRole("button", { name: "Initialize" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Selected configuration applied.");
  expect(api.applyWorkspaceProcessTemplate).toHaveBeenCalledExactlyOnceWith("dev");
});

it("creates a named project in the same submission when the workspace has none", async () => {
  vi.mocked(api.listWorkspaceProcessTemplates).mockResolvedValue({ templates: [], total: 0 });
  vi.mocked(api.listProjects).mockResolvedValue({ projects: [], total: 0 });
  vi.mocked(api.listSquads).mockResolvedValue([
    { id: "design", name: "Product design squad" }, { id: "dev", name: "Development squad" },
  ] as Squad[]);
  vi.mocked(api.createProject).mockImplementation(async (request) => {
    const project = { id: "new-project", title: request.title, workflow_id: request.workflow_id } as Project;
    vi.mocked(api.listProjects).mockResolvedValue({ projects: [project], total: 1 });
    return project;
  });
  renderSetup();
  await waitFor(() => expect(screen.getByRole("button", { name: "Initialize" })).toBeEnabled());
  const user = userEvent.setup();
  await user.click(screen.getByRole("combobox", { name: "Workflow scope" }));
  await user.click(await screen.findByRole("option", { name: "Project override" }));
  await waitFor(() => expect(screen.getByLabelText("Project name")).toBeEnabled());
  expect(screen.getByLabelText("Project name")).toHaveValue("Product development");
  expect(screen.getByRole("combobox", { name: "Apply to project" })).toHaveTextContent("New project");
  fireEvent.change(screen.getByLabelText("Project name"), { target: { value: "Customer portal" } });
  fireEvent.click(screen.getByRole("switch", { name: "Configure GitLab and CI" }));
  fireEvent.click(screen.getByRole("switch", { name: "Configure knowledge base" }));
  fireEvent.click(screen.getByRole("button", { name: "Initialize" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Selected configuration applied.");
  expect(api.createProject).toHaveBeenCalledExactlyOnceWith({ title: "Customer portal", workflow_id: "flow" });
  expect(api.setProjectWorkflow).not.toHaveBeenCalled();
  expect(screen.getByRole("combobox", { name: "Apply to project" })).toHaveTextContent("Customer portal");
  expect(screen.queryByLabelText("Project name")).not.toBeInTheDocument();
});
