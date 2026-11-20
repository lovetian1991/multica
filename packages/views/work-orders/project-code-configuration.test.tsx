import { beforeEach, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api } from "@multica/core/api";
import { PlanSchema, type CustomerProject } from "@multica/core/work-orders";
import { renderWithI18n } from "../test/i18n";
import { ProjectCodeConfiguration } from "./project-code-configuration";

vi.mock("@multica/core/api", async (original) => ({
  ...await original<typeof import("@multica/core/api")>(),
  api: {
    getWorkOrderBranches: vi.fn(), getWorkOrderProjectBaseline: vi.fn(), saveWorkOrderProject: vi.fn(),
    saveVersionCode: vi.fn(),
  },
}));
vi.mock("./queries", () => ({
  useVersionChoices: () => ({ data: [
    { value: "v", label: "ECM / V6.0", version: { id: "v", name: "V6.0" } },
    { value: "dep-v", label: "Low code / V3", version: { id: "dep-v", name: "V3" } },
  ] }),
}));

const project: CustomerProject = { id: "p", name: "中石化", productId: "", productVersionId: "", purpose: "customer" };
const plan = PlanSchema.parse({
  version_id: "v", kb_root_id: "", repos: [
    { version_id: "v", version_name: "V6.0", product_id: "ecm", module_key: "api", name: "API",
      repo_url: "https://git.test/ecm", ref: "legacy/v6", base_ref: "legacy/v6", directory: "code/ecm/V6.0/backend",
      subpath: "src", remark: "Legacy CI", kb_path: "", ref_source: "baseline" },
    { version_id: "dep-v", version_name: "V3", product_id: "dep", module_key: "lib", name: "Library",
      repo_url: "https://git.test/lib", ref: "v3", directory: "code/dep/V3/lib", subpath: "", kb_path: "", ref_source: "baseline" },
  ],
  missing_versions: [{ version_id: "empty-v", product_id: "empty", product_name: "Low code", version_name: "V6.0" }],
});
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.getWorkOrderProjectBaseline).mockResolvedValue(plan);
  vi.mocked(api.getWorkOrderBranches).mockResolvedValue({ bindings: [], resources: [] });
  vi.mocked(api.saveWorkOrderProject).mockResolvedValue({ saved: true });
});
function renderConfiguration(value = project) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return renderWithI18n(<QueryClientProvider client={qc}>
    <ProjectCodeConfiguration project={value} versionId="v" />
  </QueryClientProvider>, { locale: "en" });
}

it("inherits repositories, generates project defaults on entry and saves configured modules despite missing dependencies", async () => {
  const user = userEvent.setup();
  renderConfiguration();
  const branch = await screen.findByRole("textbox", { name: "API / Customer branch" });
  expect(branch).toHaveValue("proj-zhong-shi-hua-v6.0");
  expect(screen.getByRole("textbox", { name: "Library / Customer branch" })).toHaveValue("proj-zhong-shi-hua-v3");
  expect(screen.getByDisplayValue("https://git.test/ecm")).toHaveAttribute("readonly");
  expect(screen.getByDisplayValue("code/ecm/V6.0/backend")).toHaveAttribute("readonly");
  expect(screen.getByDisplayValue("legacy/v6")).toHaveAttribute("readonly");
  expect(screen.getByText(/Low code \/ V6.0/)).toBeVisible();
  expect(within(screen.getByRole("region", { name: "ECM / V6.0" })).getByRole("textbox", { name: "API / Customer branch" })).toBeVisible();
  expect(within(screen.getByRole("region", { name: "Low code / V3" })).getByRole("textbox", { name: "Library / Customer branch" })).toBeVisible();
  expect(screen.getByRole("textbox", { name: "Low code / V6.0 / Customer branch" })).toHaveValue("proj-zhong-shi-hua-v6.0");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(api.saveWorkOrderProject).toHaveBeenCalledWith(null, "p", "v", {
    "v/api": "proj-zhong-shi-hua-v6.0", "dep-v/lib": "proj-zhong-shi-hua-v3",
  }));
  expect(api.saveVersionCode).not.toHaveBeenCalled();
});

it("preserves custom branches and defaults unbound dependencies in an existing project", async () => {
  const user = userEvent.setup();
  vi.mocked(api.getWorkOrderBranches).mockResolvedValue({
    bindings: [{ versionId: "v", moduleKey: "api", resourceId: "r" }],
    resources: [{ id: "r", repoUrl: "https://git.test/ecm", ref: "customer/custom" }],
  });
  renderConfiguration({ ...project, productVersionId: "v" });
  const branch = await screen.findByRole("textbox", { name: "API / Customer branch" });
  await waitFor(() => expect(branch).toHaveValue("customer/custom"));
  const dependency = screen.getByRole("textbox", { name: "Library / Customer branch" });
  expect(dependency).toHaveValue("proj-zhong-shi-hua-v3");
  await user.clear(dependency);
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Generate project branches" }));
  expect(dependency).toHaveValue("proj-zhong-shi-hua-v3");
  expect(branch).toHaveValue("customer/custom");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(api.saveWorkOrderProject).toHaveBeenCalledWith(null, "p", "v", {
    "v/api": "customer/custom", "dep-v/lib": "proj-zhong-shi-hua-v3",
  }));
});

it("keeps edited branches on a failed save", async () => {
  const user = userEvent.setup();
  vi.mocked(api.saveWorkOrderProject).mockRejectedValue(new Error("Save unavailable"));
  renderConfiguration();
  const branch = await screen.findByRole("textbox", { name: "API / Customer branch" });
  await user.clear(branch);
  await user.type(branch, "customer/fix");
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Save unavailable");
  expect(branch).toHaveValue("customer/fix");
});

it("lists every dependency module once and saves independent overrides", async () => {
  const user = userEvent.setup();
  vi.mocked(api.getWorkOrderProjectBaseline).mockResolvedValue({
    ...plan,
    repos: [...plan.repos, { ...plan.repos[1]!, moduleKey: "ui", name: "Dependency UI", repoUrl: "https://git.test/ui" }],
  });
  renderConfiguration({ ...project, productVersionId: "v" });
  const group = await screen.findByRole("region", { name: "Low code / V3" });
  const uiBranch = within(group).getByRole("textbox", { name: "Dependency UI / Customer branch" });
  expect(uiBranch).toHaveValue("proj-zhong-shi-hua-v3");
  expect(screen.getAllByRole("region", { name: "Low code / V3" })).toHaveLength(1);
  await user.clear(uiBranch);
  await user.type(uiBranch, "proj-custom-ui-v3");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(api.saveWorkOrderProject).toHaveBeenCalledWith(null, "p", "v", {
    "v/api": "proj-zhong-shi-hua-v6.0",
    "dep-v/lib": "proj-zhong-shi-hua-v3",
    "dep-v/ui": "proj-custom-ui-v3",
  }));
});
