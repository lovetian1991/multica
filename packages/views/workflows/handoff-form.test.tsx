// @vitest-environment jsdom

import { cleanup, fireEvent, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildIssueStatusCatalog } from "@multica/core/issue-statuses";
import { agentListOptions, memberListOptions, squadListOptions } from "@multica/core/workspace/queries";
import { projectListOptions } from "@multica/core/projects/queries";
import type { IssueWorkflow, IssueWorkflowStep } from "@multica/core/types";
import { renderWithI18n } from "../test/i18n";
import { HandoffFields, WorkflowHandoffForm } from "./handoff-form";

const { mutateAsync } = vi.hoisted(() => ({ mutateAsync: vi.fn() }));

vi.mock("@multica/core/api", () => ({ api: {}, clientErrorMessage: () => null }));
vi.mock("@multica/core/issue-workflows", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@multica/core/issue-workflows")>()),
  useSetWorkflowHandoff: () => ({ mutateAsync, isPending: false }),
}));
vi.mock("@multica/core/hooks", () => ({ useWorkspaceId: () => "ws-1" }));
vi.mock("@multica/core/issue-statuses/hooks", () => ({ useIssueStatuses: () => buildIssueStatusCatalog([]) }));
vi.mock("../common/actor-avatar", () => ({
  ActorAvatar: ({ actorId }: { actorId: string }) => <span data-testid={`avatar-${actorId}`} />,
}));

const WORKFLOW = {
  steps: ["todo", "in_progress", "in_review", "done"].map((status_key) => ({
    status_key,
    handler: { type: "none" as const },
    instructions: "",
  })),
};

function renderFields(step: IssueWorkflowStep, onPatch = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(agentListOptions("ws-1").queryKey, [{ id: "agent-1", name: "Builder", archived_at: null }] as never);
  qc.setQueryData(memberListOptions("ws-1").queryKey, [{ user_id: "user-1", name: "Ada" }] as never);
  qc.setQueryData(squadListOptions("ws-1").queryKey, [
    { id: "squad-1", name: "Development", archived_at: null },
    { id: "squad-old", name: "Retired squad", archived_at: "2026-01-01" },
  ] as never);
  renderWithI18n(
    <QueryClientProvider client={qc}>
      <HandoffFields step={step} workflow={WORKFLOW} canEdit onPatch={onPatch} />
    </QueryClientProvider>,
  );
  return onPatch;
}

afterEach(cleanup);

describe("HandoffFields", () => {
  it("offers no handoff, an agent, a squad or a member", () => {
    const onPatch = renderFields({ status_key: "in_progress", handler: { type: "none" }, instructions: "" });

    const radios = screen.getAllByRole("radio");
    expect(radios.map((r) => r.textContent)).toEqual([
      expect.stringContaining("No handoff"),
      expect.stringContaining("Hand to an agent"),
      expect.stringContaining("Hand to a squad"),
      expect.stringContaining("Hand to a member"),
    ]);
    fireEvent.click(screen.getByRole("radio", { name: /Hand to an agent/ }));

    expect(onPatch).toHaveBeenCalledWith({ handler: { type: "agent" } });
  });

  it("selects an active squad and exposes its stage controls", async () => {
    const onPatch = renderFields({ status_key: "in_progress", handler: { type: "squad" }, instructions: "Use the design." });
    expect(screen.getByRole("textbox").textContent).toBe("Use the design.");
    expect(screen.getAllByRole("combobox")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Choose a squad" }));
    expect(screen.queryByText("Retired squad")).toBeNull();
    expect(screen.queryByText("Builder")).toBeNull();
    fireEvent.click(await screen.findByText("Development"));
    expect(onPatch).toHaveBeenCalledWith({ handler: { type: "squad", id: "squad-1" } });
  });

  it("lists only agents for an agent handoff", async () => {
    const onPatch = renderFields({ status_key: "in_progress", handler: { type: "agent" }, instructions: "" });

    fireEvent.click(screen.getByRole("button", { name: "Choose an agent" }));
    fireEvent.click(await screen.findByText("Builder"));
    expect(screen.queryByText("Ada")).toBeNull();
    expect(screen.queryByText("Project lead")).toBeNull();

    expect(onPatch).toHaveBeenCalledWith({ handler: { type: "agent", id: "agent-1" } });
  });

  it("lists the project lead and members for a member handoff, without instructions", async () => {
    const onPatch = renderFields({ status_key: "in_review", handler: { type: "member" }, instructions: "" });

    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Choose a member" }));
    expect(await screen.findByText("Project lead")).toBeTruthy();
    expect(screen.queryByText("Builder")).toBeNull();
    fireEvent.click(screen.getByText("Ada"));

    expect(onPatch).toHaveBeenCalledWith({ handler: { type: "member", id: "user-1" } });
  });

  it("shows next and back for an agent, next defaulting to the next column", () => {
    renderFields({ status_key: "in_progress", handler: { type: "agent", id: "agent-1" }, instructions: "" });

    expect(screen.getAllByRole("combobox").length).toBe(2);
    expect(screen.getByText(/In Review/)).toBeTruthy();
  });
});

describe("WorkflowHandoffForm", () => {
  const PROJECTS = [
    { id: "p-pay", title: "Payments" },
    { id: "p-orders", title: "Orders" },
  ];
  const workflow = (projectIds: string[]): IssueWorkflow =>
    ({
      id: "wf-1",
      workspace_id: "ws-1",
      name: "Delivery",
      description: "",
      is_default: false,
      steps: WORKFLOW.steps,
      project_ids: projectIds,
      created_at: "",
      updated_at: "",
    }) as IssueWorkflow;

  function renderForm(wf: IssueWorkflow, canCopyForProject = true) {
    mutateAsync.mockReset().mockResolvedValue({ ...wf, name: "Delivery (Payments)" });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(agentListOptions("ws-1").queryKey, [{ id: "agent-1", name: "Builder", archived_at: null }] as never);
    qc.setQueryData(memberListOptions("ws-1").queryKey, [] as never);
    qc.setQueryData(squadListOptions("ws-1").queryKey, [{ id: "squad-1", name: "Development", archived_at: null }] as never);
    qc.setQueryData(projectListOptions("ws-1").queryKey, { projects: PROJECTS } as never);
    renderWithI18n(
      <QueryClientProvider client={qc}>
        <WorkflowHandoffForm
          workflow={wf}
          statusKey="in_progress"
          canEdit
          canCopyForProject={canCopyForProject}
          project={PROJECTS[0]}
        />
      </QueryClientProvider>,
    );
  }

  async function handToBuilder() {
    fireEvent.click(screen.getByRole("radio", { name: /Hand to an agent/ }));
    fireEvent.click(screen.getByRole("button", { name: "Choose an agent" }));
    fireEvent.click(await screen.findByText("Builder"));
  }

  it("requires a squad and saves its instructions, next and back stages", async () => {
    const wf = workflow(["p-pay"]);
    wf.steps = wf.steps.map((step) => step.status_key === "in_progress"
      ? { ...step, instructions: "Use the approved design.", next_status_key: "in_review", back_status_key: "todo" }
      : step);
    renderForm(wf);
    fireEvent.click(screen.getByRole("radio", { name: /Hand to a squad/ }));
    expect(screen.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Choose a squad" }));
    fireEvent.click(await screen.findByText("Development"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await vi.waitFor(() => expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      handler: { type: "squad", id: "squad-1" },
      instructions: "Use the approved design.",
      next_status_key: "in_review",
      back_status_key: "todo",
    })));
  });

  it("saves for every project when the editor may not switch this project's workflow", async () => {
    renderForm(workflow(["p-pay", "p-orders"]), false);
    await handToBuilder();
    expect(screen.queryByText("Where should this change apply?")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await vi.waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    expect(mutateAsync.mock.calls[0]![0].copyForProjectId).toBeUndefined();
  });

  it("asks where a change to a shared workflow applies, and can keep it to this project", async () => {
    renderForm(workflow(["p-pay", "p-orders"]));
    expect(screen.queryByText("Where should this change apply?")).toBeNull();

    await handToBuilder();
    expect(screen.getByRole("radio", { name: /All 2 projects using Delivery/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: /Only Payments/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await vi.waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    expect(mutateAsync.mock.calls[0]![0]).toMatchObject({
      workflowId: "wf-1",
      handler: { type: "agent", id: "agent-1" },
      copyForProjectId: "p-pay",
    });
  });

  it("saves to the workflow directly when only this project uses it", async () => {
    renderForm(workflow(["p-pay"]));

    await handToBuilder();
    expect(screen.queryByText("Where should this change apply?")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await vi.waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    expect(mutateAsync.mock.calls[0]![0].copyForProjectId).toBeUndefined();
  });
});
