// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IssueWorkflow } from "../types";
import { useProjectWithWorkflow } from "./hooks";

const api = vi.hoisted(() => ({
  listIssueWorkflows: vi.fn(),
  listProjects: vi.fn(),
}));
vi.mock("../api", () => ({ api }));

const workspaceDefault: IssueWorkflow = {
  id: "default", workspace_id: "ws", name: "Default", description: "",
  is_default: true, owner_id: null, project_ids: [], created_at: "", updated_at: "",
  steps: [{ status_key: "todo", handler: { type: "squad", id: "design" }, instructions: "Design first." }],
};
const override: IssueWorkflow = { ...workspaceDefault, id: "override", is_default: false, name: "Custom" };

function renderWorkflow(projectId: string | null | undefined) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return renderHook(() => useProjectWithWorkflow("ws", projectId), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
}

beforeEach(() => {
  api.listIssueWorkflows.mockResolvedValue({ workflows: [workspaceDefault, override] });
  api.listProjects.mockResolvedValue({ projects: [
    { id: "inherited", workflow_id: null },
    { id: "custom", workflow_id: override.id },
  ] });
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe("workspace workflow inheritance", () => {
  it("loads Default and its handoffs without loading projects for an unassociated issue", async () => {
    const { result } = renderWorkflow(null);
    await waitFor(() => expect(result.current.workflow).toEqual(workspaceDefault));
    expect(result.current.project).toBeNull();
    expect(result.current.workflow?.steps[0]?.handler.id).toBe("design");
    expect(api.listProjects).not.toHaveBeenCalled();
  });

  it("does not apply a single workflow to a surface spanning projects", async () => {
    const { result } = renderWorkflow(undefined);
    await waitFor(() => expect(result.current.defaultWorkflow).toEqual(workspaceDefault));
    expect(result.current.workflow).toBeNull();
    expect(api.listProjects).not.toHaveBeenCalled();
  });

  it.each([["inherited", workspaceDefault], ["custom", override]] as const)(
    "resolves the %s project's workflow",
    async (projectId, expected) => {
      const { result } = renderWorkflow(projectId);
      await waitFor(() => expect(result.current.workflow).toEqual(expected));
      expect(result.current.project?.id).toBe(projectId);
    },
  );

  it("waits for the project before applying its workflow", async () => {
    api.listProjects.mockReturnValue(new Promise(() => {}));
    const { result } = renderWorkflow("custom");
    await waitFor(() => expect(result.current.defaultWorkflow).toEqual(workspaceDefault));
    expect(result.current.workflow).toBeNull();
  });
});
