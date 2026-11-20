import { beforeEach, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api } from "@multica/core/api";
import { renderWithI18n } from "../../test/i18n";
import { GitLabDeliveryDefaults } from "./gitlab-delivery-defaults";

vi.mock("@multica/core/hooks", () => ({ useWorkspaceId: () => "ws" }));
vi.mock("@multica/core/api", async (original) => ({
  ...await original<typeof import("@multica/core/api")>(),
  api: { getDeliveryDefaults: vi.fn(), saveDeliveryDefaults: vi.fn() },
}));
const defaults = {
  enabled: true, rules: { autoDiscover: true, deploymentJob: "", pipelineSource: "push",
    urlPrefix: "MULTICA_DEPLOY_URL=", allowedHosts: [], timeoutMinutes: 120 },
};
function renderSettings(canManage = true) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  return renderWithI18n(<QueryClientProvider client={qc}><GitLabDeliveryDefaults canManage={canManage} /></QueryClientProvider>);
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.getDeliveryDefaults).mockResolvedValue(defaults);
  vi.mocked(api.saveDeliveryDefaults).mockResolvedValue(defaults);
});

it("saves token-only defaults with no project ID, job or hosts required", async () => {
  const user = userEvent.setup();
  renderSettings();
  const configure = screen.getByRole("button", { name: "Configure defaults" });
  await waitFor(() => expect(configure).toBeEnabled());
  await user.click(configure);
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).queryByLabelText(/token|Project ID|hosts/i)).not.toBeInTheDocument();
  await user.click(within(dialog).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(api.saveDeliveryDefaults).toHaveBeenCalledWith("ws", defaults));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
});

it("saves global deployment evidence rules and the enable switch", async () => {
  const user = userEvent.setup();
  renderSettings();
  const configure = screen.getByRole("button", { name: "Configure defaults" });
  await waitFor(() => expect(configure).toBeEnabled());
  await user.click(configure);
  const dialog = await screen.findByRole("dialog");
  await user.clear(within(dialog).getByLabelText("URL marker"));
  await user.type(within(dialog).getByLabelText("URL marker"), "DEPLOY_URL=");
  await user.click(within(dialog).getByRole("switch"));
  await user.click(within(dialog).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(api.saveDeliveryDefaults).toHaveBeenCalledWith("ws", {
    ...defaults, enabled: false,
    rules: { ...defaults.rules, urlPrefix: "DEPLOY_URL=" },
  }));
});

it("clears previous host restrictions when saving dynamic deployment defaults", async () => {
  vi.mocked(api.getDeliveryDefaults).mockResolvedValue({
    ...defaults, rules: { ...defaults.rules, allowedHosts: ["old-node.test"] },
  });
  const user = userEvent.setup();
  renderSettings();
  const configure = screen.getByRole("button", { name: "Configure defaults" });
  await waitFor(() => expect(configure).toBeEnabled());
  await user.click(configure);
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).queryByLabelText(/hosts/i)).not.toBeInTheDocument();
  await user.click(within(dialog).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(api.saveDeliveryDefaults).toHaveBeenCalledWith("ws", defaults));
});

it("keeps a failed defaults save open", async () => {
  vi.mocked(api.saveDeliveryDefaults).mockRejectedValue(new Error("save denied"));
  const user = userEvent.setup();
  renderSettings();
  const configure = screen.getByRole("button", { name: "Configure defaults" });
  await waitFor(() => expect(configure).toBeEnabled());
  await user.click(configure);
  const dialog = await screen.findByRole("dialog");
  await user.click(within(dialog).getByRole("button", { name: "Save" }));
  expect(await within(dialog).findByRole("alert")).toHaveTextContent("save denied");
  expect(dialog).toBeVisible();
});

it("does not expose workspace-default mutations to non-admins", () => {
  renderSettings(false);
  expect(screen.queryByRole("button", { name: "Configure defaults" })).not.toBeInTheDocument();
});
