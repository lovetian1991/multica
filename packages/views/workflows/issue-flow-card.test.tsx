import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { buildIssueStatusCatalog } from "@multica/core/issue-statuses";
import { renderWithI18n } from "../test/i18n";
import { IssueFlowCard } from "./issue-flow-card";

vi.mock("@multica/core/hooks", () => ({ useWorkspaceId: () => "ws" }));
vi.mock("@multica/core/paths", () => ({ useWorkspacePaths: () => ({ settings: () => "/ws/settings" }) }));
vi.mock("@multica/core/issue-workflows", () => ({
  useProjectWithWorkflow: () => ({
    project: null,
    workflow: {
      name: "Default",
      steps: [
        { status_key: "todo", handler: { type: "squad", id: "design" }, instructions: "" },
        { status_key: "in_progress", handler: { type: "squad", id: "development" }, instructions: "" },
      ],
    },
  }),
}));
vi.mock("@multica/core/issue-statuses/hooks", () => ({
  useIssueStatuses: () => buildIssueStatusCatalog([]),
}));
vi.mock("@multica/core/workspace/hooks", () => ({
  useActorName: () => ({ getActorName: (_type: string, id: string) => id === "design" ? "Design squad" : "Development squad" }),
}));
vi.mock("../issues/utils/status-label", () => ({ useStatusLabel: () => (key: string) => key }));
vi.mock("../navigation", () => ({ useNavigation: () => ({ push: vi.fn() }) }));
vi.mock("./permissions", () => ({ useWorkflowPermissions: () => ({ canCreateWorkflow: false }) }));
vi.mock("../common/actor-avatar", () => ({
  ActorAvatar: ({ actorId }: { actorId: string }) => <span data-testid={`avatar-${actorId}`} />,
}));

afterEach(cleanup);

it("shows the workspace workflow and its squad handoffs for an issue without a project", async () => {
  renderWithI18n(<IssueFlowCard projectId={null} currentStatus="todo" />);
  fireEvent.click(screen.getByRole("button", { name: /Default.*Workspace default/ }));
  expect(await screen.findByText("Design squad")).toBeTruthy();
  expect(screen.getByText("Development squad")).toBeTruthy();
  expect(screen.getByText("todo").closest("li")?.getAttribute("aria-current")).toBe("step");
});
