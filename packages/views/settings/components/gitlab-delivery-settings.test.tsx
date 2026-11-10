import { beforeEach, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api } from "@multica/core/api";
import { renderWithI18n } from "../../test/i18n";
import { GitLabDeliverySettings } from "./gitlab-delivery-settings";

vi.mock("@multica/core/hooks", () => ({ useWorkspaceId: () => "ws" }));
vi.mock("@multica/core/api", async (original) => ({
  ...await original<typeof import("@multica/core/api")>(),
  api: { listDeliveryProjects: vi.fn(), saveDeliveryProject: vi.fn(), deleteDeliveryProject: vi.fn() },
}));
function renderSettings(canManage = true) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  return renderWithI18n(<QueryClientProvider client={qc}><GitLabDeliverySettings canManage={canManage}
    connections={[{ id: "connection", workspace_id: "ws", provider: "gitlab", instance_url: "https://git.test",
      account_login: "reader", webhook_url: "", webhook_path: "", created_at: "" }]} /></QueryClientProvider>);
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.listDeliveryProjects).mockResolvedValue({ projects: [] });
});

it("saves project tracking rules without collecting another token", async () => {
  const user = userEvent.setup();
  renderSettings();
  await user.click(screen.getByRole("button", { name: "Configure projects" }));
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).queryByLabelText(/token/i)).not.toBeInTheDocument();
  await user.type(within(dialog).getByLabelText("Project ID"), "7");
  await user.type(within(dialog).getByLabelText("Deployment job"), "deploy");
  await user.type(within(dialog).getByLabelText("Allowed URL hosts"), "app.test, preview.test");
  await user.click(within(dialog).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(api.saveDeliveryProject).toHaveBeenCalledWith("ws", {
    connectionId: "connection", projectId: 7,
    rules: { deploymentJob: "deploy", pipelineSource: "push", allowedHosts: ["app.test", "preview.test"],
      urlPrefix: "MULTICA_DEPLOY_URL=", timeoutMinutes: 120 },
  }));
});

it("does not expose project mutations to non-admins", () => {
  renderSettings(false);
  expect(screen.queryByRole("button", { name: "Configure projects" })).not.toBeInTheDocument();
});

it("keeps a failed save open with the error visible", async () => {
  vi.mocked(api.saveDeliveryProject).mockRejectedValue(new Error("project access denied"));
  const user = userEvent.setup();
  renderSettings();
  await user.click(screen.getByRole("button", { name: "Configure projects" }));
  const dialog = await screen.findByRole("dialog");
  await user.type(within(dialog).getByLabelText("Project ID"), "7");
  await user.type(within(dialog).getByLabelText("Deployment job"), "deploy");
  await user.type(within(dialog).getByLabelText("Allowed URL hosts"), "app.test");
  await user.click(within(dialog).getByRole("button", { name: "Save" }));
  expect(await within(dialog).findByRole("alert")).toHaveTextContent("project access denied");
  expect(dialog).toBeVisible();
});
