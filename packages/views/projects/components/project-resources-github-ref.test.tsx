// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithI18n } from "../../test/i18n";

const repoUrl = "https://github.com/multica-ai/api";
const customRepoUrl = "git@gitlab.example.com:group/project.git";

const mocks = vi.hoisted(() => ({
  resources: [] as unknown[],
  createResource: vi.fn().mockResolvedValue({}),
  updateResource: vi.fn().mockResolvedValue({}),
  deleteResource: vi.fn().mockResolvedValue({}),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: { queryKey?: unknown[] }) => {
    const key = options?.queryKey?.[0];
    if (key === "project-resources") return { data: mocks.resources };
    return { data: [] };
  },
  queryOptions: (options: unknown) => options,
}));

vi.mock("@multica/core/projects", () => ({
  projectResourcesOptions: () => ({ queryKey: ["project-resources"], queryFn: vi.fn() }),
  useCreateProjectResource: () => ({ mutateAsync: mocks.createResource, isPending: false }),
  useUpdateProjectResource: () => ({ mutateAsync: mocks.updateResource }),
  useDeleteProjectResource: () => ({ mutateAsync: mocks.deleteResource }),
}));

vi.mock("@multica/core/hooks", () => ({ useWorkspaceId: () => "workspace-1" }));

vi.mock("@multica/core/paths", () => ({
  useCurrentWorkspace: () => ({
    id: "workspace-1",
    slug: "ws",
    repos: [{ url: repoUrl }],
  }),
}));

vi.mock("@multica/core/config", () => ({
  useConfigStore: (selector: (state: { localWorktreeSupported: boolean }) => unknown) =>
    selector({ localWorktreeSupported: true }),
}));

vi.mock("@multica/core/runtimes", () => ({
  runtimeListOptions: () => ({ queryKey: ["runtimes"], queryFn: vi.fn() }),
  runtimeAdvertisesLocalWorktree: () => true,
}));

vi.mock("../../platform", () => ({
  isDesktopShell: () => false,
  pickDirectory: vi.fn(),
  useLocalDaemonStatus: () => ({ daemonId: null, deviceName: null, running: false }),
  validateLocalDirectory: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { ProjectResourcesSection } from "./project-resources-section";

describe("ProjectResourcesSection Git repository refs", () => {
  beforeEach(() => {
    mocks.resources = [];
    mocks.createResource.mockClear();
    mocks.updateResource.mockClear();
    mocks.deleteResource.mockClear();
  });

  it("attaches a custom repository with a ref", async () => {
    const user = userEvent.setup();
    renderWithI18n(<ProjectResourcesSection projectId="project-1" />);

    await user.click(screen.getByRole("button", { name: "Add resource" }));
    await user.type(
      screen.getByPlaceholderText("https://github.com/owner/repo or git@github.com:owner/repo.git"),
      customRepoUrl,
    );
    await user.type(
      screen.getByRole("textbox", { name: "Branch/ref" }),
      " develop ",
    );
    await user.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect(mocks.createResource).toHaveBeenCalledTimes(1));
    expect(mocks.createResource).toHaveBeenCalledWith({
      resource_type: "github_repo",
      resource_ref: { url: customRepoUrl, ref: "develop" },
    });
  });

  it("shows a repository ref even when the resource has a custom label", () => {
    mocks.resources = [
      {
        id: "res-1",
        project_id: "project-1",
        workspace_id: "workspace-1",
        resource_type: "github_repo",
        resource_ref: { url: repoUrl, ref: "develop" },
        label: "API Repo",
        position: 0,
        created_at: "2026-08-26T00:00:00Z",
        created_by: "user-1",
      },
    ];

    renderWithI18n(<ProjectResourcesSection projectId="project-1" />);

    expect(screen.getByText("API Repo @ develop")).toBeInTheDocument();
  });

  it("removes ref from the resource_ref payload when the edit input is cleared", async () => {
    const user = userEvent.setup();
    mocks.resources = [
      {
        id: "res-1",
        project_id: "project-1",
        workspace_id: "workspace-1",
        resource_type: "github_repo",
        resource_ref: { url: repoUrl, ref: "develop", default_branch_hint: "main" },
        label: null,
        position: 0,
        created_at: "2026-08-26T00:00:00Z",
        created_by: "user-1",
      },
    ];

    renderWithI18n(<ProjectResourcesSection projectId="project-1" />);

    expect(screen.getByText("multica-ai/api @ develop")).toBeInTheDocument();
    await user.click(screen.getByTitle("Edit repository ref"));
    const input = screen.getByDisplayValue("develop");
    await user.clear(input);
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(mocks.updateResource).toHaveBeenCalledTimes(1));
    expect(mocks.updateResource).toHaveBeenCalledWith({
      resourceId: "res-1",
      data: {
        resource_ref: { url: repoUrl, default_branch_hint: "main" },
      },
    });
  });
});
