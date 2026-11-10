import { beforeEach, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api, ApiError } from "@multica/core/api";
import type { Delivery } from "@multica/core/vcs";
import { renderWithI18n } from "../../test/i18n";
import { IssueDeliveriesSection } from "./issue-deliveries-section";

vi.mock("@multica/core/hooks", () => ({ useWorkspaceId: () => "ws" }));
vi.mock("@multica/core/api", async (original) => ({
  ...await original<typeof import("@multica/core/api")>(),
  api: { listIssueDeliveries: vi.fn(), listDeliveryProjects: vi.fn(), registerDelivery: vi.fn(), resumeDelivery: vi.fn() },
}));

const delivery: Delivery = {
  id: "delivery", projectConfigId: "config", projectPath: "team/app",
  sha: "a".repeat(40), ref: "feature", status: "deployed", terminal: true,
  createdAt: "", updatedAt: "",
  result: { pipelineId: 1, pipelineStatus: "success", pipelineUrl: "https://git.test/pipeline/1",
    jobId: 2, jobStatus: "success", jobUrl: "https://git.test/job/2",
    deploymentUrl: "https://app.test/feature", urlSource: "job_trace", reason: "" },
};
function renderSection() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  return renderWithI18n(<QueryClientProvider client={qc}><IssueDeliveriesSection issueId="issue" /></QueryClientProvider>);
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.listIssueDeliveries).mockResolvedValue({ available: true, deliveries: [delivery] });
  vi.mocked(api.listDeliveryProjects).mockResolvedValue({ projects: [{
    id: "config", connectionId: "connection", instanceUrl: "https://git.test", projectId: 7, projectPath: "team/app",
    rules: { deploymentJob: "deploy", pipelineSource: "push", urlPrefix: "MULTICA_DEPLOY_URL=", allowedHosts: ["app.test"], timeoutMinutes: 120 },
  }] });
  vi.mocked(api.resumeDelivery).mockResolvedValue(delivery);
  vi.mocked(api.registerDelivery).mockResolvedValue(delivery);
});

it("shows evidence-backed links separately from user acceptance", async () => {
  renderSection();
  expect(await screen.findByText("Awaiting user acceptance")).toBeVisible();
  expect(screen.getByRole("link", { name: "Open environment" })).toHaveAttribute("href", delivery.result.deploymentUrl);
  expect(screen.getByRole("link", { name: "Pipeline" })).toHaveAttribute("href", delivery.result.pipelineUrl);
  expect(screen.getByText("Source: deployment job output")).toBeVisible();
  expect(api.resumeDelivery).not.toHaveBeenCalled();
});

it("resumes only when explicitly clicked, without rerunning the squad", async () => {
  const user = userEvent.setup();
  renderSection();
  await user.click(await screen.findByRole("button", { name: "Resume tracking" }));
  await waitFor(() => expect(api.resumeDelivery).toHaveBeenCalledWith("issue", "delivery"));
  expect(api.registerDelivery).not.toHaveBeenCalled();
});

it("registers exact project, SHA and ref from the dialog", async () => {
  const user = userEvent.setup();
  renderSection();
  await screen.findByText("team/app");
  await user.click(screen.getByRole("button", { name: "Track pushed commit" }));
  const dialog = await screen.findByRole("dialog");
  await user.type(within(dialog).getByLabelText("Full commit SHA"), delivery.sha);
  await user.type(within(dialog).getByLabelText("Branch or tag"), "feature");
  await user.click(within(dialog).getByRole("button", { name: "Track pushed commit" }));
  await waitFor(() => expect(api.registerDelivery).toHaveBeenCalledWith("issue", {
    projectConfigId: "config", sha: delivery.sha, ref: "feature",
  }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
});

it("does not present a fetch failure as an empty delivery list", async () => {
  vi.mocked(api.listIssueDeliveries).mockRejectedValue(new Error("network"));
  renderSection();
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not load delivery data");
  expect(screen.queryByText("No registered deliveries")).not.toBeInTheDocument();
});

it("hides the section against a backend without this feature", async () => {
  vi.mocked(api.listIssueDeliveries).mockRejectedValue(new ApiError("not found", 404, "Not Found"));
  const view = renderSection();
  await waitFor(() => expect(view.container).toBeEmptyDOMElement());
});
